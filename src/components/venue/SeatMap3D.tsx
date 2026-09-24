"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SeatParseResult } from "@/lib/seat-parse";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";
import { layoutOf, resolveSeatGeometry, THEATRE_HEDGE } from "@/lib/venue-seatmap/geometry";
import { configForVenue } from "@/lib/venue-seatmap/registry";
import { APPROXIMATE_BOWL, buildBowl3D, type Bowl3DModel } from "@/lib/venue-seatmap/bowl3d";
import {
  buildSeatLayout3D,
  describeSeat,
  nearestSeatInBlock,
  SEAT_DENSITY,
  SEAT_LAYOUT_HEDGE,
  type SeatLayout3D,
} from "@/lib/venue-seatmap/seats3d";
import { Button } from "@/components/ui/button";
import { NIGHT_PALETTE, buildVenueScene, seatColorFor, type VenueScene } from "@/components/venue/seat-map-3d-scene";

/** Loaded lazily inside the effect — `three` must never be statically imported so the module
 * graph keeps it out of the main chunk (see the dynamic() wrapper in EventModal.tsx). This
 * type-only alias is erased at build time, so it does NOT count as a static import. */
type ThreeNS = typeof import("three");

/**
 * Lazy-loaded 3D venue viewer with a "view from your seat" camera. Sibling to SeatMap (the
 * 2D-SVG plan view) — same props, same graceful-degradation contract: an unmatched venue or an
 * unresolvable block renders the same muted hint SeatMap renders, never a guessed scene.
 * `three` itself is only pulled in once this component actually mounts and its effect runs:
 *
 *   const SeatMap3D = dynamic(() => import("@/components/venue/SeatMap3D").then((m) => m.SeatMap3D));
 *
 * The canvas is always a night-time concert scene (seats as instanced rows coloured by level,
 * an optional lightstick crowd, a glowing stage with LED screens, block labels, bloom on capable
 * desktops); the chrome around it follows the app theme. Hover (mouse) or tap (touch) a block
 * for "Block 225 · Row ≈BB"; click/tap selects it.
 *
 * Camera has two modes, toggled by the buttons above the canvas: "Bowl view" (orbiting above
 * the far end, free look) and "From your seat" (a curved camera flight into the resolved seat's
 * eye position among the real rows, then free look-around from there; Escape flies back) — the
 * latter is disabled whenever `model.seat` is null (unconfirmed blocks, e.g. Kai Tak's 101-110,
 * never get a guessed eye position; see bowl3d.ts).
 */
export interface SeatMap3DProps {
  venue: string | null | undefined;
  seat: SeatParseResult | null | undefined;
  /** An explicit venue config (e.g. one drafted from an uploaded seating plan). When given it
   * is used instead of matching `venue` by name; `venue` stays the fallback. */
  config?: VenueSeatMapConfig | null;
  className?: string;
  /** Called once if WebGL isn't usable on this device/browser, so a caller (EventModal) can
   * fall back to the 2D SeatMap instead. */
  onUnavailable?: () => void;
}

type CameraMode = "bowl" | "seat";

/** Canvas aspect (width / height) — landscape, used whenever the container has no CSS height
 * of its own yet (and matches the container's own `aspectRatio` style below). */
const CANVAS_ASPECT = 16 / 10;
/** Kai Tak's outer-wall-to-pitch length ratio — the bowl camera's framing reference. */
const FOOTPRINT_TO_PITCH = APPROXIMATE_BOWL.planOuter.height / APPROXIMATE_BOWL.planInner.height;
/** How long the seat pulse / head sway keep animating after the last interaction before the
 * view settles back to pure render-on-demand. */
const AMBIENT_MS = 9000;
const HOVER_THROTTLE_MS = 70;
/** In seat mode the orbit target sits this close in front of the eye, so dragging looks around
 * from the seat instead of swinging the camera across the venue. */
const LOOK_TARGET_M = 0.6;
/** Bloom is skipped above this many device pixels (and on coarse-pointer / small screens). */
const BLOOM_MAX_DEVICE_PIXELS = 3_600_000;

/** Probes a throwaway canvas (never the one we'll actually render into) so a failed probe
 * never leaves the real canvas half-initialized with the wrong context type. */
function canWebGL(): boolean {
  try {
    const probe = document.createElement("canvas");
    return !!(probe.getContext("webgl2") || probe.getContext("webgl"));
  } catch {
    return false;
  }
}

function mediaMatches(query: string): boolean {
  return typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;
}

/** Phones/tablets and narrow containers get the low-density, no-bloom path. */
function isLowEndView(containerWidth: number): boolean {
  return mediaMatches("(pointer: coarse)") || containerWidth < 520;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

interface SelectedBlock {
  label: string;
  levelLabel: string;
}

export function SeatMap3D({ venue, seat, config, className, onUnavailable }: SeatMap3DProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<CameraMode>("bowl");
  const [unavailable, setUnavailable] = useState(false);
  const [crowdOn, setCrowdOn] = useState(true);
  const [selected, setSelected] = useState<SelectedBlock | null>(null);
  // Refs bridging the (async) three.js setup effect and the plain buttons below — avoids
  // re-running the whole scene-setup effect on every mode/crowd toggle.
  const applyModeRef = useRef<((mode: CameraMode, animate: boolean) => void) | null>(null);
  const setCrowdRef = useRef<((on: boolean) => void) | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Mirrors `mode`/`crowdOn` for the async setup effect to read once it finishes — a click can
  // land before the lazy three.js import resolves, and without this the scene would always
  // initialize into "bowl" regardless of what was clicked meanwhile.
  const modeRef = useRef<CameraMode>(mode);
  const crowdRef = useRef(crowdOn);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    crowdRef.current = crowdOn;
  }, [crowdOn]);

  // Mirrors SeatMap's resolution chain (config ?? matchVenueConfig -> resolveSeatGeometry)
  // then hands off to the pure bowl3d builder. Memoised on the raw inputs, not on `geometry`
  // itself, since resolveSeatGeometry returns a fresh object every call.
  const venueConfig = useMemo(() => configForVenue(venue, config), [venue, config]);
  const isTheatre = !!venueConfig && layoutOf(venueConfig) === "theatre";
  const resolved = useMemo(() => {
    if (!seat || seat.status === "unparseable") return null;
    // Theatre layouts aren't projected — rendered as a note below, never a guessed scene.
    if (!venueConfig || isTheatre) return null;
    const geometry = resolveSeatGeometry(venueConfig, seat.fields);
    return { config: venueConfig, geometry, model: buildBowl3D(venueConfig, geometry) };
  }, [venueConfig, isTheatre, seat]);
  const model: Bowl3DModel | null = resolved?.model ?? null;
  const ownRowLabel = seat && seat.status !== "unparseable" ? (seat.fields.row?.value ?? null) : null;

  // Legend entries: one colour per seated level, in config order.
  const legend = useMemo(() => {
    if (!resolved) return [];
    return resolved.config.levels
      .filter((level) => resolved.model.slabs.some((s) => s.levelId === level.id) || resolved.model.floorBlocks.some((b) => b.levelId === level.id))
      .map((level) => ({
        id: level.id,
        label: level.label,
        color: hex(seatColorFor(level.kind === "floor" ? "floor" : "stand", level.tier)),
      }));
  }, [resolved]);

  // Reset the camera mode / unavailable flag / selection whenever the resolved model changes so
  // a stale "seat" mode doesn't linger after switching to a seat with no resolvable eye position.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync camera mode when a different seat/venue model resolves
    setMode("bowl");
    setUnavailable(false);
    setSelected(null);
  }, [model]);

  // Escape in "From your seat" flies back to the bowl view. A native listener on our own root
  // (not React's delegated one) so stopPropagation keeps a surrounding dialog's document-level
  // Escape handler from closing it on the same key press.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || modeRef.current !== "seat") return;
      event.preventDefault();
      event.stopPropagation();
      modeRef.current = "bowl";
      setMode("bowl");
      applyModeRef.current?.("bowl", true);
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [model]);

  useEffect(() => {
    if (!resolved) return;
    const { config: cfg, geometry, model: bowl } = resolved;
    const container = containerRef.current;
    if (!container) return;

    if (!canWebGL()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reporting a capability probe's result, not synchronizing render state
      setUnavailable(true);
      onUnavailable?.();
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let rafId: number | null = null;

    const initialWidth = Math.max(container.clientWidth, 1);
    const lowEnd = isLowEndView(initialWidth);
    const dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
    const initialHeight = container.clientHeight > 0 ? container.clientHeight : Math.max(Math.round(initialWidth / CANVAS_ASPECT), 1);
    const useBloom = !lowEnd && initialWidth * initialHeight * dpr * dpr <= BLOOM_MAX_DEVICE_PIXELS;

    (async () => {
      const [THREE, { OrbitControls }, GeometryUtils, post] = await Promise.all([
        import("three"),
        import("three/addons/controls/OrbitControls.js"),
        import("three/addons/utils/BufferGeometryUtils.js"),
        useBloom
          ? Promise.all([
              import("three/addons/postprocessing/EffectComposer.js"),
              import("three/addons/postprocessing/RenderPass.js"),
              import("three/addons/postprocessing/UnrealBloomPass.js"),
              import("three/addons/postprocessing/OutputPass.js"),
            ])
          : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      // Block-level so the canvas doesn't add an inline line-box descender under itself: with
      // an inline canvas, container height = canvas height + a few px, which re-triggers the
      // ResizeObserver below every frame and grows the canvas without bound.
      canvas.style.display = "block";
      canvas.style.touchAction = "none";

      let localRenderer: InstanceType<ThreeNS["WebGLRenderer"]>;
      try {
        localRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
      } catch {
        if (!cancelled) {
          setUnavailable(true);
          onUnavailable?.();
        }
        return;
      }

      const layout: SeatLayout3D = buildSeatLayout3D(cfg, geometry, bowl, {
        maxSeats: lowEnd ? SEAT_DENSITY.mobile : SEAT_DENSITY.desktop,
      });

      // Framed on the outer footprint (normalised by Kai Tak's footprint-to-pitch ratio, so
      // Kai Tak frames as before) — a small arena's stands are proportionally deeper than a
      // stadium's, and framing on the floor alone would crop them.
      const span = Math.max(bowl.footprint.length, bowl.footprint.width) / FOOTPRINT_TO_PITCH;

      let venueScene: VenueScene;
      try {
        venueScene = buildVenueScene(THREE, GeometryUtils, bowl, layout, { span, pixelRatio: dpr });
      } catch {
        localRenderer.dispose();
        if (!cancelled) {
          setUnavailable(true);
          onUnavailable?.();
        }
        return;
      }
      const { scene } = venueScene;
      venueScene.setCrowdVisible(crowdRef.current);

      let width = initialWidth;
      let height = initialHeight;
      const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, span * 30);

      localRenderer.setPixelRatio(dpr);
      localRenderer.setSize(width, height);
      container.appendChild(canvas);

      // Bloom (desktop only): render → bloom → output (sRGB), all on the same on-demand path.
      let composer: InstanceType<(typeof import("three/addons/postprocessing/EffectComposer.js"))["EffectComposer"]> | null = null;
      const postDisposables: { dispose: () => void }[] = [];
      if (post) {
        const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = post;
        const target = new THREE.WebGLRenderTarget(width * dpr, height * dpr, { type: THREE.HalfFloatType, samples: 4 });
        composer = new EffectComposer(localRenderer, target);
        const renderPass = new RenderPass(scene, camera);
        const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.7, 0.5, 0.7);
        const output = new OutputPass();
        composer.addPass(renderPass);
        composer.addPass(bloom);
        composer.addPass(output);
        composer.setPixelRatio?.(dpr);
        composer.setSize(width, height);
        postDisposables.push(target, renderPass, bloom, output, composer);
      }

      const orbitControls = new OrbitControls(camera, localRenderer.domElement);
      orbitControls.enableDamping = true;
      orbitControls.maxPolarAngle = Math.PI * 0.49;

      // "Bowl" camera: an elevated 3/4 overview from above and beyond the far (non-stage) end,
      // slightly off-axis so the side stands' rake reads, looking towards the stage (-z per
      // Bowl3DModel's convention). Distance fits the outer footprint's half-diagonal.
      const radius = 0.5 * Math.hypot(bowl.footprint.width, bowl.footprint.length);
      const bowlDistance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.74;
      const bowlDir = new THREE.Vector3(0.24, 0.62, 0.75).normalize();
      const bowlTarget = new THREE.Vector3(0, 0, -span * 0.04);
      const bowlEye = bowlTarget.clone().addScaledVector(bowlDir, bowlDistance);
      camera.position.copy(bowlEye);
      orbitControls.target.copy(bowlTarget);
      camera.lookAt(bowlTarget);
      orbitControls.update();

      // Seat eye/look: the generated own seat (sits among the real rows) when there is one,
      // else bowl3d's schematic seat position.
      const seatEye = layout.ownSeat?.eye ?? bowl.seat?.eye ?? null;
      const seatLook = layout.ownSeat?.lookAt ?? bowl.seat?.lookAt ?? null;

      const reduceMotion = mediaMatches("(prefers-reduced-motion: reduce)");

      let firstRender = true;
      const renderOnce = () => {
        venueScene.updateLabels(camera);
        if (composer) composer.render();
        else localRenderer.render(scene, camera);
        if (firstRender) {
          firstRender = false;
          container.dataset.rendered = "1";
        }
      };

      // ---- Unified on-demand frame loop ----
      // Frames only run while something is moving: damping settle, a camera flight, or a
      // bounded ambient window (seat pulse / head sway) after the last interaction.
      let settleFrames = 0;
      let ambientUntil = reduceMotion ? 0 : performance.now() + AMBIENT_MS;
      let flight: ((now: number) => boolean) | null = null;
      let dragging = false;
      const sway = new THREE.Vector3();
      const nextSway = new THREE.Vector3();

      const frame = (now: number) => {
        rafId = null;
        let again = false;
        if (flight) {
          again = flight(now) || again;
        } else {
          // Remove last frame's sway before the controls integrate, so it never accumulates.
          camera.position.sub(sway);
          orbitControls.target.sub(sway);
          sway.set(0, 0, 0);
          orbitControls.update();
          if (settleFrames > 0) {
            settleFrames -= 1;
            again = true;
          }
        }
        const ambientLeft = ambientUntil - now;
        if (ambientLeft > 0) {
          const strength = Math.min(1, ambientLeft / 1200);
          venueScene.animate(now, strength);
          if (modeRef.current === "seat" && !flight && !dragging) {
            nextSway.set(Math.sin(now / 820) * 0.022 * strength, Math.sin(now / 530) * 0.012 * strength, 0);
            camera.position.add(nextSway);
            orbitControls.target.add(nextSway);
            sway.copy(nextSway);
          }
          again = true;
        } else {
          venueScene.animate(now, 0);
        }
        renderOnce();
        if (again && rafId === null && !cancelled) rafId = requestAnimationFrame(frame);
      };
      const requestRender = () => {
        if (rafId === null && !cancelled) rafId = requestAnimationFrame(frame);
      };
      const extendAmbient = () => {
        if (!reduceMotion) ambientUntil = performance.now() + AMBIENT_MS;
      };
      const onControlsStart = () => {
        dragging = true;
        settleFrames = 40;
        extendAmbient();
        requestRender();
      };
      const onControlsChange = () => {
        settleFrames = Math.max(settleFrames, 40); // a few extra frames so damping visibly settles
        requestRender();
      };
      const onControlsEnd = () => {
        dragging = false;
      };
      orbitControls.addEventListener("start", onControlsStart);
      orbitControls.addEventListener("change", onControlsChange);
      orbitControls.addEventListener("end", onControlsEnd);

      const configureControls = (next: CameraMode) => {
        // Seat mode = look around from the seat: no zoom/pan away from it.
        orbitControls.enableZoom = next === "bowl";
        orbitControls.enablePan = next === "bowl";
        orbitControls.maxPolarAngle = next === "bowl" ? Math.PI * 0.49 : Math.PI * 0.8;
      };

      const applyMode = (next: CameraMode, animate: boolean) => {
        const toSeat = next === "seat" && !!seatEye && !!seatLook;
        const endEye = toSeat ? new THREE.Vector3(seatEye!.x, seatEye!.y, seatEye!.z) : bowlEye.clone();
        const endLook = toSeat ? new THREE.Vector3(seatLook!.x, seatLook!.y, seatLook!.z) : bowlTarget.clone();
        // Final orbit target: just in front of the eye (seat) or the bowl centre.
        const endTarget = toSeat
          ? endEye.clone().addScaledVector(endLook.clone().sub(endEye).normalize(), LOOK_TARGET_M)
          : bowlTarget.clone();

        venueScene.setBeaconVisible(!toSeat);
        // Stop any in-flight settle loop and flush leftover rotate/pan deltas from a previous
        // drag (update() with damping off applies and zeroes them) — otherwise that residual
        // momentum keeps turning the camera after it lands.
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        camera.position.sub(sway);
        orbitControls.target.sub(sway);
        sway.set(0, 0, 0);
        settleFrames = 0;
        orbitControls.enableDamping = false;
        orbitControls.update();
        configureControls(next);
        extendAmbient();

        if (!animate || reduceMotion) {
          flight = null;
          camera.position.copy(endEye);
          orbitControls.target.copy(endTarget);
          orbitControls.update();
          orbitControls.enableDamping = true;
          orbitControls.enabled = true;
          renderOnce();
          if (!reduceMotion) requestRender();
          return;
        }

        // Curved flight: CatmullRom through a lifted control point. Into the seat it swings in
        // from behind and above the seat so the last stretch glides forward into the row; the
        // look point is a far point (stage / bowl centre) throughout, then swapped for the near
        // look-around target on landing (same direction, so no visible jump).
        const startEye = camera.position.clone();
        const startLook = orbitControls.target.clone();
        const distanceToLook = startEye.distanceTo(startLook);
        if (distanceToLook < 2) {
          // Leaving seat mode: extend the near target out to a far point along the same view.
          const dir = startLook.clone().sub(startEye).normalize();
          startLook.copy(startEye).addScaledVector(dir, Math.max(startEye.distanceTo(bowlTarget), 10));
        }
        const travel = startEye.distanceTo(endEye);
        const up = new THREE.Vector3(0, 1, 0);
        let control: InstanceType<ThreeNS["Vector3"]>;
        if (toSeat) {
          const viewDir = endLook.clone().sub(endEye).setY(0).normalize();
          control = endEye.clone().addScaledVector(viewDir, -travel * 0.3).addScaledVector(up, travel * 0.22);
        } else {
          control = startEye.clone().lerp(endEye, 0.5).addScaledVector(up, travel * 0.25);
        }
        const path = new THREE.CatmullRomCurve3([startEye, control, endEye], false, "centripetal");
        const duration = toSeat ? 1900 : 1400;
        const startTime = performance.now();
        const look = new THREE.Vector3();
        orbitControls.enabled = false;
        flight = (now: number) => {
          // Clamped at 0 too: a rAF timestamp can precede the performance.now() taken when the
          // flight started, and a negative t would index before the curve's first point.
          const t = Math.min(1, Math.max(0, (now - startTime) / duration));
          path.getPoint(easeInOutCubic(t), camera.position);
          look.lerpVectors(startLook, endLook, easeOutCubic(Math.min(1, t * 1.25)));
          camera.lookAt(look);
          if (t < 1) return true;
          flight = null;
          orbitControls.target.copy(endTarget);
          orbitControls.enabled = true;
          orbitControls.update();
          orbitControls.enableDamping = true;
          return true;
        };
        requestRender();
      };
      applyModeRef.current = applyMode;
      setCrowdRef.current = (on: boolean) => {
        venueScene.setCrowdVisible(on);
        requestRender();
      };
      // Catch up to whatever mode was clicked while three.js was still loading (see modeRef's
      // comment) — a no-op jump if nothing changed since the initial bowlEye/bowlTarget setup.
      applyMode(modeRef.current, false);

      // ---- Hover tooltip / click-to-select ----
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      let lastHover = 0;
      let selectedIndex: number | null = null;
      let tapTimer: ReturnType<typeof setTimeout> | null = null;
      const pickAt = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObject(venueScene.hitMesh, false)[0];
        if (!hit || hit.faceIndex == null) return null;
        const blockIndex = layout.hitSurfaces.triangleBlock[hit.faceIndex];
        if (blockIndex === undefined) return null;
        const seatIndex = nearestSeatInBlock(layout, blockIndex, hit.point);
        return { blockIndex, seatIndex, x: clientX - rect.left, y: clientY - rect.top };
      };
      const tooltipText = (pick: { blockIndex: number; seatIndex: number | null }) => {
        const block = layout.blocks[pick.blockIndex];
        const own = layout.ownSeat;
        if (own && own.blockIndex === pick.blockIndex && pick.seatIndex !== null) {
          const p = layout.positions;
          const d = Math.hypot(p[pick.seatIndex * 3] - own.position.x, p[pick.seatIndex * 3 + 2] - own.position.z);
          if (d < 1.2) return `Your seat · Block ${block.label}${ownRowLabel ? ` · Row ${ownRowLabel}` : ""}`;
        }
        const described = pick.seatIndex !== null ? describeSeat(layout, pick.seatIndex) : null;
        const row = described?.rowLabel ? ` · Row ≈${described.rowLabel}` : "";
        return `${block.levelLabel} · Block ${block.label}${row}`;
      };
      const showTooltip = (pick: { blockIndex: number; seatIndex: number | null; x: number; y: number } | null) => {
        const tip = tooltipRef.current;
        if (!tip) return;
        if (!pick) {
          tip.style.opacity = "0";
          canvas.style.cursor = "";
          return;
        }
        tip.textContent = tooltipText(pick);
        const left = Math.min(Math.max(pick.x + 12, 4), Math.max(width - tip.offsetWidth - 4, 4));
        const top = Math.max(pick.y - 30, 4);
        tip.style.transform = `translate(${left}px, ${top}px)`;
        tip.style.opacity = "1";
        canvas.style.cursor = "pointer";
      };
      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || dragging || flight) return;
        const now = performance.now();
        if (now - lastHover < HOVER_THROTTLE_MS) return;
        lastHover = now;
        showTooltip(pickAt(event.clientX, event.clientY));
      };
      const onPointerLeave = () => showTooltip(null);
      let downAt: { x: number; y: number; t: number } | null = null;
      const onPointerDown = (event: PointerEvent) => {
        downAt = { x: event.clientX, y: event.clientY, t: event.timeStamp };
        container.focus({ preventScroll: true });
        showTooltip(null);
      };
      const onPointerUp = (event: PointerEvent) => {
        const start = downAt;
        downAt = null;
        if (!start || flight) return;
        // Event timestamps, not handler time — a slow frame between the two must not turn a tap
        // into a "long press".
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 || event.timeStamp - start.t > 450) return;
        const pick = pickAt(event.clientX, event.clientY);
        const next = pick && pick.blockIndex !== selectedIndex ? pick.blockIndex : null;
        selectedIndex = next;
        venueScene.setSelectedBlock(next);
        const block = next !== null ? layout.blocks[next] : null;
        setSelected(block ? { label: block.label, levelLabel: block.levelLabel } : null);
        if (event.pointerType !== "mouse") {
          showTooltip(pick);
          if (tapTimer) clearTimeout(tapTimer);
          tapTimer = setTimeout(() => showTooltip(null), 2500);
        }
        extendAmbient();
        requestRender();
      };
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", onPointerUp);

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          const w = Math.max(Math.round(entry.contentRect.width), 1);
          const h = entry.contentRect.height > 0
            ? Math.max(Math.round(entry.contentRect.height), 1)
            : Math.max(Math.round(w / CANVAS_ASPECT), 1);
          // Skip no-op resizes (e.g. the observer's initial callback) — each setSize would
          // otherwise trigger another layout pass for nothing.
          if (w === canvas.clientWidth && h === canvas.clientHeight) return;
          width = w;
          height = h;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          localRenderer.setSize(w, h);
          composer?.setSize(w, h);
          renderOnce();
        });
        resizeObserver.observe(container);
      }

      cleanupRef.current = () => {
        orbitControls.removeEventListener("start", onControlsStart);
        orbitControls.removeEventListener("change", onControlsChange);
        orbitControls.removeEventListener("end", onControlsEnd);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointerup", onPointerUp);
        if (tapTimer) clearTimeout(tapTimer);
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        flight = null;
        resizeObserver?.disconnect();
        applyModeRef.current = null;
        setCrowdRef.current = null;
        for (const d of postDisposables) d.dispose();
        venueScene.dispose();
        orbitControls.dispose();
        localRenderer.dispose();
        localRenderer.forceContextLoss();
        canvas.remove();
        delete container.dataset.rendered;
      };
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [resolved, onUnavailable, ownRowLabel]);

  const handleModeChange = (next: CameraMode) => {
    if (next === "seat" && !model?.seat) return;
    modeRef.current = next;
    setMode(next);
    applyModeRef.current?.(next, true);
  };

  const toggleCrowd = () => {
    const next = !crowdOn;
    crowdRef.current = next;
    setCrowdOn(next);
    setCrowdRef.current?.(next);
  };

  if (isTheatre && seat && seat.status !== "unparseable") {
    return (
      <p className={`text-xs text-muted-foreground/70 ${className ?? ""}`} data-testid="seat-map-3d-theatre">
        {venueConfig?.name}: {THEATRE_HEDGE}
      </p>
    );
  }

  if (!model) {
    return (
      <p className={`text-xs text-muted-foreground/70 ${className ?? ""}`} data-testid="seat-map-3d-empty">
        No 3D seat map available for this venue yet.
      </p>
    );
  }

  return (
    <div className={className} data-testid="seat-map-3d" ref={rootRef}>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <Button
          type="button"
          size="sm"
          variant={mode === "bowl" ? "default" : "outline"}
          aria-pressed={mode === "bowl"}
          onClick={() => handleModeChange("bowl")}
        >
          Bowl view
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "seat" ? "default" : "outline"}
          aria-pressed={mode === "seat"}
          onClick={() => handleModeChange("seat")}
          disabled={!model.seat}
          title={model.seat ? "Fly to your seat — Esc to return" : "Seat position isn't confirmed for this block yet"}
        >
          From your seat
        </Button>
        <Button type="button" size="sm" variant={crowdOn ? "secondary" : "outline"} aria-pressed={crowdOn} onClick={toggleCrowd}>
          Crowd
        </Button>
      </div>

      {unavailable ? (
        <p className="text-xs text-muted-foreground/70" data-testid="seat-map-3d-unavailable">
          3D view unavailable on this device
        </p>
      ) : (
        <div
          ref={containerRef}
          role="img"
          aria-label="3D seat view of the venue bowl"
          // Focusable (not tabbable) so a click on the canvas keeps keyboard focus inside this
          // component — Escape in seat mode then reaches our own keydown listener.
          tabIndex={-1}
          // Inline aspect-ratio (not a Tailwind class) so the height is fixed even before/without
          // the stylesheet — the canvas sizes itself from this box. 16:10, capped for tall views.
          // Always the night-scene colour (the canvas is a venue at night in either app theme).
          style={{ aspectRatio: "16 / 10", maxHeight: 420, background: hex(NIGHT_PALETTE.background), position: "relative" }}
          className="w-full rounded-md border border-border overflow-hidden outline-none"
          data-testid="seat-map-3d-canvas-container"
        >
          <div
            ref={tooltipRef}
            aria-hidden="true"
            data-testid="seat-map-3d-tooltip"
            className="pointer-events-none z-10 whitespace-nowrap rounded-md border border-white/15 bg-[#140c2e]/90 px-2 py-1 text-[11px] font-medium text-white shadow-lg transition-opacity"
            // Positioning inline (like the container's aspect ratio) so the tooltip can never
            // take up layout space and shift the canvas under the pointer.
            style={{ opacity: 0, position: "absolute", left: 0, top: 0 }}
          />
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-testid="seat-map-3d-legend">
        {legend.map((entry) => (
          <span key={entry.id} className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
        {model.seat && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-full" style={{ background: hex(NIGHT_PALETTE.ownSeat) }} />
            Your seat
          </span>
        )}
        {selected && (
          <span className="font-medium text-foreground" data-testid="seat-map-3d-selected">
            Selected: {selected.levelLabel} · Block {selected.label}
          </span>
        )}
      </div>

      {model.hedge.length > 0 && (
        <ul className="text-[11px] text-muted-foreground/70 mt-1 space-y-0.5">
          {model.hedge.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
          <li>{SEAT_LAYOUT_HEDGE}</li>
        </ul>
      )}
    </div>
  );
}
