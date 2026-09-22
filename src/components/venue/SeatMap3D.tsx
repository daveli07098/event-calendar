"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SeatParseResult } from "@/lib/seat-parse";
import { resolveSeatGeometry } from "@/lib/venue-seatmap/geometry";
import { matchVenueConfig } from "@/lib/venue-seatmap/registry";
import { APPROXIMATE_BOWL, buildBowl3D, type Bowl3DModel } from "@/lib/venue-seatmap/bowl3d";
import { Button } from "@/components/ui/button";

/** Loaded lazily inside the effect — `three` must never be statically imported so the module
 * graph keeps it out of the main chunk (see the dynamic() wrapper in EventModal.tsx). This
 * type-only alias is erased at build time, so it does NOT count as a static import. */
type ThreeNS = typeof import("three");

/**
 * Lazy-loaded 3D Kai Tak bowl viewer with a "view from your seat" camera. Sibling to SeatMap
 * (the 2D-SVG plan view) — same props, same graceful-degradation contract: an unmatched venue
 * or an unresolvable block renders the same muted hint SeatMap renders, never a guessed scene.
 * `three` itself is only pulled in once this component actually mounts and its effect runs:
 *
 *   const SeatMap3D = dynamic(() => import("@/components/venue/SeatMap3D").then((m) => m.SeatMap3D));
 *
 * Camera has two modes, toggled by the two buttons below the canvas: "Bowl view" (orbiting
 * above the far end, free look) and "From your seat" (camera planted at the resolved seat's
 * eye position, orbit target at its lookAt so the visitor can still pan around) — the latter
 * is disabled whenever `model.seat` is null (unconfirmed blocks, e.g. Kai Tak's 101-110,
 * never get a guessed eye position; see bowl3d.ts).
 */
export interface SeatMap3DProps {
  venue: string | null | undefined;
  seat: SeatParseResult | null | undefined;
  className?: string;
  /** Called once if WebGL isn't usable on this device/browser, so a caller (EventModal) can
   * fall back to the 2D SeatMap instead. */
  onUnavailable?: () => void;
}

type CameraMode = "bowl" | "seat";

// One clearly distinct shade per tier (lower tiers darker, upper tiers lighter) so stacked
// raked stands read as separate bands rather than one grey mass.
const TIER_COLORS = [0x475569, 0x3f6690, 0x9aa3b5, 0xa78bfa, 0x7ca1a1, 0x8ba17c];
const HIGHLIGHT_COLOR = 0xf59e0b; // amber — matches SeatMap's stage/marker accent
const PITCH_COLOR = 0x059669; // emerald, matches SeatMap's pitch fill
const GROUND_COLOR = 0x1e293b; // dark slate concourse under the whole bowl footprint
const STAGE_COLOR = 0x7c3aed; // purple
/** Canvas aspect (width / height) — landscape, used whenever the container has no CSS height
 * of its own yet (and matches the container's own `aspectRatio` style below). */
const CANVAS_ASPECT = 16 / 10;
/** Seat marker radius in metres — deliberately oversized (the bowl view camera sits ~250 m
 * away) so it stays visible as a dot rather than a sub-pixel speck. */
const MARKER_RADIUS_M = 2.5;

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

export function SeatMap3D({ venue, seat, className, onUnavailable }: SeatMap3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<CameraMode>("bowl");
  const [unavailable, setUnavailable] = useState(false);
  // Refs bridging the (async) three.js setup effect and the plain camera-mode buttons below —
  // avoids re-running the whole scene-setup effect on every mode toggle.
  const applyModeRef = useRef<((mode: CameraMode, animate: boolean) => void) | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Mirrors `mode` for the async setup effect to read once it finishes — a click on "From
  // your seat" can land before the lazy three.js/OrbitControls import resolves, and without
  // this the scene would always initialize into "bowl" regardless of what was clicked meanwhile.
  const modeRef = useRef<CameraMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Mirrors SeatMap's resolution chain (matchVenueConfig -> resolveSeatGeometry) then hands
  // off to the pure bowl3d builder. Memoised on the raw inputs, not on `geometry` itself,
  // since resolveSeatGeometry returns a fresh object every call.
  const model: Bowl3DModel | null = useMemo(() => {
    if (!seat || seat.status === "unparseable") return null;
    const venueConfig = matchVenueConfig(venue);
    if (!venueConfig) return null;
    const geometry = resolveSeatGeometry(venueConfig, seat.fields);
    return buildBowl3D(venueConfig, geometry);
  }, [venue, seat]);

  // Reset the camera mode / unavailable flag whenever the resolved model changes so a stale
  // "seat" mode doesn't linger after switching to a seat with no resolvable eye position.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync camera mode when a different seat/venue model resolves
    setMode("bowl");
    setUnavailable(false);
  }, [model]);

  useEffect(() => {
    if (!model) return;
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
    let tweenRafId: number | null = null;
    const disposables: { dispose: () => void }[] = [];

    (async () => {
      const [THREE, { OrbitControls }] = await Promise.all([
        import("three"),
        import("three/addons/controls/OrbitControls.js"),
      ]);
      if (cancelled) return;

      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      // Block-level so the canvas doesn't add an inline line-box descender under itself: with
      // an inline canvas, container height = canvas height + a few px, which re-triggers the
      // ResizeObserver below every frame and grows the canvas without bound.
      canvas.style.display = "block";

      let localRenderer: InstanceType<ThreeNS["WebGLRenderer"]>;
      try {
        localRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      } catch {
        if (!cancelled) {
          setUnavailable(true);
          onUnavailable?.();
        }
        return;
      }

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b1220);

      const width = Math.max(container.clientWidth, 1);
      const height = container.clientHeight > 0 ? container.clientHeight : Math.max(Math.round(width / CANVAS_ASPECT), 1);
      const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 1000);

      localRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      localRenderer.setSize(width, height);
      container.appendChild(canvas);

      const orbitControls = new OrbitControls(camera, localRenderer.domElement);
      orbitControls.enableDamping = true;

      // Lights — a sky/ground hemisphere fill plus a key light from high above, so the raked
      // (tilted) tiers shade differently from the flat pitch and the rake reads in 3D.
      const hemisphere = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.9);
      const directional = new THREE.DirectionalLight(0xffffff, 1.6);
      directional.position.set(40, 160, 90);
      scene.add(hemisphere, directional);
      disposables.push({ dispose: () => scene.remove(hemisphere, directional) });

      // Ground — the bowl's whole outer footprint, so the gaps between pitch and tiers read as
      // concourse rather than empty void. Sits just below the pitch to avoid z-fighting.
      const groundGeo = new THREE.PlaneGeometry(
        APPROXIMATE_BOWL.planOuter.width * APPROXIMATE_BOWL.scaleX,
        APPROXIMATE_BOWL.planOuter.height * APPROXIMATE_BOWL.scaleZ,
      );
      const groundMat = new THREE.MeshStandardMaterial({ color: GROUND_COLOR, side: THREE.DoubleSide });
      const groundMesh = new THREE.Mesh(groundGeo, groundMat);
      groundMesh.rotation.x = -Math.PI / 2;
      groundMesh.position.y = -0.3;
      scene.add(groundMesh);
      disposables.push({ dispose: () => { groundGeo.dispose(); groundMat.dispose(); } });

      // Pitch
      const pitchGeo = new THREE.PlaneGeometry(model.pitch.width, model.pitch.length);
      const pitchMat = new THREE.MeshStandardMaterial({ color: PITCH_COLOR, side: THREE.DoubleSide });
      const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
      pitchMesh.rotation.x = -Math.PI / 2;
      scene.add(pitchMesh);
      disposables.push({ dispose: () => { pitchGeo.dispose(); pitchMat.dispose(); } });

      // Stage
      if (model.stage) {
        const stageGeo = new THREE.BoxGeometry(model.stage.width, model.stage.height, model.stage.depth);
        const stageMat = new THREE.MeshStandardMaterial({ color: STAGE_COLOR });
        const stageMesh = new THREE.Mesh(stageGeo, stageMat);
        // `stage.center` is already the box's geometric centre (y = height / 2), so it sits on
        // the ground as-is — no extra half-height offset.
        stageMesh.position.set(model.stage.center.x, model.stage.center.y, model.stage.center.z);
        scene.add(stageMesh);
        disposables.push({ dispose: () => { stageGeo.dispose(); stageMat.dispose(); } });
      }

      // Slabs — one mesh per level, distinct muted colour per tier.
      for (const slab of model.slabs) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(slab.positions, 3));
        geo.computeVertexNormals();
        const color = TIER_COLORS[slab.tier % TIER_COLORS.length];
        const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        disposables.push({ dispose: () => { geo.dispose(); mat.dispose(); } });
      }

      // Seat-block highlight
      if (model.seatBlock) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(model.seatBlock, 3));
        geo.computeVertexNormals();
        // The patch is coplanar with its level's slab, so pull it towards the camera in depth
        // (polygonOffset) or it z-fights with the slab and disappears.
        const mat = new THREE.MeshStandardMaterial({
          color: HIGHLIGHT_COLOR,
          side: THREE.DoubleSide,
          emissive: HIGHLIGHT_COLOR,
          emissiveIntensity: 0.6,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        disposables.push({ dispose: () => { geo.dispose(); mat.dispose(); } });
      }

      // Seat marker sphere — hidden in "From your seat" mode (the camera sits inside it there).
      let marker: InstanceType<ThreeNS["Mesh"]> | null = null;
      if (model.seat) {
        const markerGeo = new THREE.SphereGeometry(MARKER_RADIUS_M, 20, 20);
        const markerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: HIGHLIGHT_COLOR, emissiveIntensity: 0.8 });
        marker = new THREE.Mesh(markerGeo, markerMat);
        marker.position.set(model.seat.position.x, model.seat.position.y + MARKER_RADIUS_M, model.seat.position.z);
        scene.add(marker);
        disposables.push({ dispose: () => { markerGeo.dispose(); markerMat.dispose(); } });
      }

      // Initial "bowl" camera: an elevated 3/4 overview from above and beyond the far
      // (non-stage) end, slightly off-axis so the side stands' rake is visible, looking down
      // (~45 deg) at a point just behind the pitch centre — stage end is -z per
      // Bowl3DModel's coordinate convention. Distances scale with the pitch so the whole bowl
      // (outer wall ~1.7x the pitch length, upper tier ~30 m tall) stays in frame.
      const span = Math.max(model.pitch.length, model.pitch.width);
      const bowlEye = new THREE.Vector3(span * 0.52, span * 1.62, span * 1.57);
      const bowlTarget = new THREE.Vector3(0, 0, span * 0.05);
      camera.position.copy(bowlEye);
      orbitControls.target.copy(bowlTarget);
      camera.lookAt(bowlTarget);
      orbitControls.update();

      const reduceMotion = typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;

      const renderOnce = () => {
        localRenderer.render(scene, camera);
      };
      renderOnce();

      // Render-on-demand: re-render only while the user is actively interacting (damping
      // needs a few settle frames after the gesture ends) rather than a perpetual rAF loop.
      let settleFrames = 0;
      const tick = () => {
        orbitControls.update();
        renderOnce();
        settleFrames -= 1;
        if (settleFrames > 0) {
          rafId = requestAnimationFrame(tick);
        } else {
          rafId = null;
        }
      };
      const startTicking = () => {
        settleFrames = 40; // a few extra frames so damping visibly settles
        if (rafId === null) rafId = requestAnimationFrame(tick);
      };
      orbitControls.addEventListener("start", startTicking);
      orbitControls.addEventListener("change", startTicking);

      const applyMode = (next: CameraMode, animate: boolean) => {
        const targetEye = next === "seat" && model.seat
          ? new THREE.Vector3(model.seat.eye.x, model.seat.eye.y, model.seat.eye.z)
          : bowlEye;
        const targetLook = next === "seat" && model.seat
          ? new THREE.Vector3(model.seat.lookAt.x, model.seat.lookAt.y, model.seat.lookAt.z)
          : bowlTarget;

        if (marker) marker.visible = next !== "seat";
        // Stop any in-flight damping settle loop and flush leftover rotate/pan deltas from a
        // previous drag (update() with damping off applies and zeroes them) — otherwise that
        // residual momentum keeps turning the camera after it lands, so it no longer faces
        // targetLook.
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        orbitControls.enableDamping = false;
        orbitControls.update();

        if (!animate || reduceMotion) {
          camera.position.copy(targetEye);
          orbitControls.target.copy(targetLook);
          orbitControls.update();
          orbitControls.enableDamping = true;
          renderOnce();
          return;
        }

        const startEye = camera.position.clone();
        const startTarget = orbitControls.target.clone();
        const duration = 600;
        const startTime = performance.now();

        const step = (now: number) => {
          const t = Math.min(1, (now - startTime) / duration);
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out-quad
          camera.position.lerpVectors(startEye, targetEye, eased);
          orbitControls.target.lerpVectors(startTarget, targetLook, eased);
          orbitControls.update();
          renderOnce();
          if (t < 1) {
            tweenRafId = requestAnimationFrame(step);
          } else {
            tweenRafId = null;
            orbitControls.enableDamping = true;
          }
        };
        if (tweenRafId !== null) cancelAnimationFrame(tweenRafId);
        tweenRafId = requestAnimationFrame(step);
      };
      applyModeRef.current = applyMode;
      // Catch up to whatever mode was clicked while three.js was still loading (see modeRef's
      // comment) — a no-op jump if nothing changed since the initial bowlEye/bowlTarget setup.
      applyMode(modeRef.current, false);

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
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          localRenderer.setSize(w, h);
          renderOnce();
        });
        resizeObserver.observe(container);
      }

      cleanupRef.current = () => {
        orbitControls.removeEventListener("start", startTicking);
        orbitControls.removeEventListener("change", startTicking);
        if (rafId !== null) cancelAnimationFrame(rafId);
        if (tweenRafId !== null) cancelAnimationFrame(tweenRafId);
        resizeObserver?.disconnect();
        for (const d of disposables) d.dispose();
        orbitControls.dispose();
        localRenderer.dispose();
        localRenderer.forceContextLoss();
        canvas.remove();
      };
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [model, onUnavailable]);

  const handleModeChange = (next: CameraMode) => {
    if (next === "seat" && !model?.seat) return;
    setMode(next);
    applyModeRef.current?.(next, true);
  };

  if (!model) {
    return (
      <p className={`text-xs text-muted-foreground/70 ${className ?? ""}`} data-testid="seat-map-3d-empty">
        No 3D seat map available for this venue yet.
      </p>
    );
  }

  return (
    <div className={className} data-testid="seat-map-3d">
      <div className="flex gap-1.5 mb-1.5">
        <Button
          type="button"
          size="sm"
          variant={mode === "bowl" ? "default" : "outline"}
          onClick={() => handleModeChange("bowl")}
        >
          Bowl view
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "seat" ? "default" : "outline"}
          onClick={() => handleModeChange("seat")}
          disabled={!model.seat}
          title={model.seat ? undefined : "Seat position isn't confirmed for this block yet"}
        >
          From your seat
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
          // Inline aspect-ratio (not a Tailwind class) so the height is fixed even before/without
          // the stylesheet — the canvas sizes itself from this box. 16:10, capped for tall views.
          style={{ aspectRatio: "16 / 10", maxHeight: 420 }}
          className="w-full rounded-md border border-border bg-muted/40 overflow-hidden"
          data-testid="seat-map-3d-canvas-container"
        />
      )}

      {model.hedge.length > 0 && (
        <ul className="text-[11px] text-muted-foreground/70 mt-1 space-y-0.5">
          {model.hedge.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
