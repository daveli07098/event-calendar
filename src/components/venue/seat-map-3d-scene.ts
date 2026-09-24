/**
 * Scene builder for SeatMap3D's night-time concert view: instanced seats in raked rows, an
 * optional lightstick crowd, a glowing stage with LED screens, block labels, floor aisle glow,
 * the resolved seat's beacon, and invisible per-block hit surfaces for hover/tap.
 *
 * `three` (and its addons) are passed IN by the caller after its lazy `import()` — this module
 * only holds type-only references to them, so importing it statically never pulls `three` into
 * a chunk. Everything it creates is released by `dispose()`.
 */

import type { Bowl3DModel } from "@/lib/venue-seatmap/bowl3d";
import type { SeatLayout3D } from "@/lib/venue-seatmap/seats3d";

type ThreeNS = typeof import("three");
type GeometryUtilsNS = typeof import("three/addons/utils/BufferGeometryUtils.js");
type Object3D = InstanceType<ThreeNS["Object3D"]>;
type Camera = InstanceType<ThreeNS["PerspectiveCamera"]>;

/** Night palette. Stand seats are coloured per level ("zone") like a ticketing plan: floor
 * lilac-white, then teal, gold, lilac, green for successive stand tiers. */
export const NIGHT_PALETTE = {
  background: 0x0b0820,
  fog: 0x160c30,
  floorSeats: 0xd6c8ff,
  tierSeats: [0x2cc9b0, 0xe0a93c, 0xb08cff, 0x5fd38a, 0x5ab0ff],
  ownSeat: 0xffa51f,
} as const;

/** Seat colour for a block (floor blocks share one colour; stand tiers cycle the palette). */
export function seatColorFor(kind: "stand" | "floor", tier: number): number {
  if (kind === "floor") return NIGHT_PALETTE.floorSeats;
  const tiers = NIGHT_PALETTE.tierSeats;
  return tiers[Math.max(0, tier - 1) % tiers.length];
}

export interface VenueScene {
  scene: InstanceType<ThreeNS["Scene"]>;
  /** Invisible block surfaces to raycast (each triangle maps to a block via `triangleBlock`). */
  hitMesh: InstanceType<ThreeNS["Mesh"]>;
  setCrowdVisible(visible: boolean): void;
  setSelectedBlock(blockIndex: number | null): void;
  /** Beacon/beam visibility — hidden in "From your seat" mode (the camera sits at the seat). */
  setBeaconVisible(visible: boolean): void;
  /** Fades labels by camera distance; call before every render. */
  updateLabels(camera: Camera): void;
  /** Advances the seat pulse; `strength` 0..1 fades it out at the end of an ambient window. */
  animate(now: number, strength: number): void;
  dispose(): void;
}

export interface VenueSceneOptions {
  /** Framing reference length in metres (see SeatMap3D's `span`). */
  span: number;
  pixelRatio: number;
}

// ---- 2D canvas helpers (null under jsdom / no 2D context → fall back to plain colours) ----

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!ctx || typeof ctx.fillText !== "function" || typeof ctx.createLinearGradient !== "function") return null;
  return { canvas, ctx };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vertical fade baked into vertex colours (bright at `brightEnd` y), for additive beams. */
function fadeAlongY(THREE: ThreeNS, geo: InstanceType<ThreeNS["BufferGeometry"]>, color: [number, number, number], brightAtTop: boolean) {
  const pos = geo.getAttribute("position") as InstanceType<ThreeNS["BufferAttribute"]>;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const h = Math.max(box.max.y - box.min.y, 1e-6);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getY(i) - box.min.y) / h;
    const k = Math.pow(brightAtTop ? u : 1 - u, 1.6);
    colors[i * 3] = color[0] * k;
    colors[i * 3 + 1] = color[1] * k;
    colors[i * 3 + 2] = color[2] * k;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export function buildVenueScene(
  THREE: ThreeNS,
  GeometryUtils: GeometryUtilsNS,
  model: Bowl3DModel,
  layout: SeatLayout3D,
  options: VenueSceneOptions,
): VenueScene {
  const { span, pixelRatio } = options;
  const scene = new THREE.Scene();
  const textures: { dispose: () => void }[] = [];
  const rand = mulberry(0xc0ffee);

  // ---- Sky / fog ----
  const sky = canvas2d(4, 256);
  if (sky) {
    const g = sky.ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#04030c");
    g.addColorStop(0.55, "#110a2c");
    g.addColorStop(1, "#2c1552");
    sky.ctx.fillStyle = g;
    sky.ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(sky.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    textures.push(tex);
  } else {
    scene.background = new THREE.Color(NIGHT_PALETTE.background);
  }
  scene.fog = new THREE.FogExp2(NIGHT_PALETTE.fog, 0.2 / span);

  // Starfield well above the bowl.
  {
    const n = 500;
    const stars = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = rand() * Math.PI * 0.42;
      const r = span * 9;
      stars[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      stars[i * 3 + 1] = r * Math.cos(phi) * 0.6 + span * 0.8;
      stars[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    const mat = new THREE.PointsMaterial({ color: 0xbfb4ff, size: 1.3 * pixelRatio, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 });
    scene.add(new THREE.Points(geo, mat));
  }

  // ---- Lights ----
  scene.add(new THREE.HemisphereLight(0x8f86ff, 0x120a24, 1.1));
  const key = new THREE.DirectionalLight(0xd9d0ff, 1.1);
  key.position.set(span * 0.4, span * 1.6, span * 0.9);
  scene.add(key);
  const stageFocus = model.stage ? model.stage.center : { x: 0, y: 0, z: 0 };
  const pink = new THREE.PointLight(0xff4fd8, 1.2, span * 1.6, 0);
  pink.position.set(stageFocus.x - span * 0.12, 8, stageFocus.z + 4);
  const blue = new THREE.PointLight(0x6f7bff, 1.0, span * 1.6, 0);
  blue.position.set(stageFocus.x + span * 0.12, 8, stageFocus.z + 4);
  scene.add(pink, blue);

  // ---- Ground, floor, slabs ----
  const groundGeo = new THREE.PlaneGeometry(model.footprint.width * 1.4, model.footprint.length * 1.4);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x0a0818, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  scene.add(ground);

  const floorGeo = new THREE.PlaneGeometry(model.pitch.width, model.pitch.length);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0x19123a, emissive: 0x0b0724, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const slabMat = new THREE.MeshStandardMaterial({ color: 0x1c1738, emissive: 0x06041a, roughness: 0.95, side: THREE.DoubleSide });
  for (const slab of model.slabs) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(slab.positions, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, slabMat));
  }
  if (model.floorBlocks.length > 0) {
    const patchMat = new THREE.MeshStandardMaterial({ color: 0x241b4d, emissive: 0x0c0826, side: THREE.DoubleSide });
    for (const block of model.floorBlocks) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(block.positions, 3));
      geo.computeVertexNormals();
      scene.add(new THREE.Mesh(geo, patchMat));
    }
  }

  // Glowing aisle / pen outlines on the floor, plus the floor's own outline.
  {
    const hw = model.pitch.width / 2;
    const hl = model.pitch.length / 2;
    const y = 0.07;
    const outline = [-hw, y, -hl, hw, y, -hl, hw, y, -hl, hw, y, hl, hw, y, hl, -hw, y, hl, -hw, y, hl, -hw, y, -hl];
    const all = new Float32Array(layout.floorLines.length + outline.length);
    all.set(layout.floorLines, 0);
    all.set(outline, layout.floorLines.length);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(all, 3));
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.62, 0.38, 1.35), transparent: true, opacity: 0.75, toneMapped: false });
    scene.add(new THREE.LineSegments(geo, mat));
  }

  // ---- Seats (one InstancedMesh) ----
  const pan = new THREE.BoxGeometry(0.46, 0.08, 0.42);
  pan.translate(0, 0.42, 0.03);
  const back = new THREE.BoxGeometry(0.46, 0.46, 0.07);
  back.translate(0, 0.66, -0.19);
  const seatGeo = GeometryUtils.mergeGeometries([pan, back]) ?? pan;
  if (seatGeo !== pan) pan.dispose();
  back.dispose();
  const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
  const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, Math.max(layout.count, 1));
  seatMesh.count = layout.count;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const baseColors = new Float32Array(Math.max(layout.count, 1) * 3);
  const blockColors = layout.blocks.map((b) => new THREE.Color(seatColorFor(b.kind, b.tier)));
  for (let i = 0; i < layout.count; i++) {
    dummy.position.set(layout.positions[i * 3], layout.positions[i * 3 + 1], layout.positions[i * 3 + 2]);
    dummy.rotation.set(0, layout.yaw[i], 0);
    // The own seat is drawn separately as the glowing beacon seat.
    dummy.scale.setScalar(layout.ownSeat?.seatIndex === i ? 0 : 1);
    dummy.updateMatrix();
    seatMesh.setMatrixAt(i, dummy.matrix);
    color.copy(blockColors[layout.blockIndex[i]]).multiplyScalar(0.82 + rand() * 0.3);
    baseColors[i * 3] = color.r;
    baseColors[i * 3 + 1] = color.g;
    baseColors[i * 3 + 2] = color.b;
    seatMesh.setColorAt(i, color);
  }
  seatMesh.instanceMatrix.needsUpdate = true;
  if (seatMesh.instanceColor) seatMesh.instanceColor.needsUpdate = true;
  seatMesh.computeBoundingSphere();
  scene.add(seatMesh);

  // ---- Crowd: dark figures + additive lightstick dots ----
  const crowdGroup = new THREE.Group();
  const body = new THREE.CylinderGeometry(0.15, 0.2, 0.95, 6, 1).toNonIndexed();
  body.translate(0, 0.475, 0);
  const head = new THREE.IcosahedronGeometry(0.13, 0);
  head.translate(0, 1.1, 0);
  const figureGeo = GeometryUtils.mergeGeometries([body, head]) ?? body;
  if (figureGeo !== body) body.dispose();
  head.dispose();
  const figureMat = new THREE.MeshStandardMaterial({ color: 0x2d2350, emissive: 0x0d0822, roughness: 0.9 });
  const crowdCount = layout.crowd.count;
  const figures = new THREE.InstancedMesh(figureGeo, figureMat, Math.max(crowdCount, 1));
  figures.count = crowdCount;
  const stickPos = new Float32Array(crowdCount * 3);
  const stickCol = new Float32Array(crowdCount * 3);
  let sticks = 0;
  const stickPalette: [number, number, number][] = [
    [1.45, 0.5, 1.1], // pink
    [1.0, 0.7, 1.6], // lilac
    [1.5, 1.2, 1.45], // white-pink
  ];
  for (let i = 0; i < crowdCount; i++) {
    const x = layout.crowd.positions[i * 3];
    const y = layout.crowd.positions[i * 3 + 1];
    const z = layout.crowd.positions[i * 3 + 2];
    const standing = layout.crowd.standing[i] === 1;
    const scale = standing ? 1.06 + rand() * 0.1 : 0.82 + rand() * 0.08;
    const baseY = standing ? y : y + 0.3;
    dummy.position.set(x, baseY, z);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    figures.setMatrixAt(i, dummy.matrix);
    if (rand() < 0.62) {
      const top = baseY + 1.23 * scale;
      stickPos[sticks * 3] = x + (rand() - 0.5) * 0.4;
      stickPos[sticks * 3 + 1] = top + 0.05 + rand() * 0.25;
      stickPos[sticks * 3 + 2] = z + (rand() - 0.5) * 0.4;
      const r = rand();
      const c = stickPalette[r < 0.46 ? 0 : r < 0.86 ? 1 : 2];
      stickCol[sticks * 3] = c[0];
      stickCol[sticks * 3 + 1] = c[1];
      stickCol[sticks * 3 + 2] = c[2];
      sticks++;
    }
  }
  figures.instanceMatrix.needsUpdate = true;
  figures.computeBoundingSphere();
  crowdGroup.add(figures);

  let glowTex: InstanceType<ThreeNS["CanvasTexture"]> | null = null;
  const glow = canvas2d(64, 64);
  if (glow) {
    const g = glow.ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    glow.ctx.fillStyle = g;
    glow.ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(glow.canvas);
    textures.push(glowTex);
  }
  const stickGeo = new THREE.BufferGeometry();
  stickGeo.setAttribute("position", new THREE.BufferAttribute(stickPos.subarray(0, sticks * 3), 3));
  stickGeo.setAttribute("color", new THREE.BufferAttribute(stickCol.subarray(0, sticks * 3), 3));
  const stickMat = new THREE.PointsMaterial({
    size: 0.45,
    sizeAttenuation: true,
    vertexColors: true,
    map: glowTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  // Keep far lightsticks from vanishing to sub-pixel and near ones from ballooning.
  const minPx = (1.8 * pixelRatio).toFixed(1);
  const maxPx = (6 * pixelRatio).toFixed(1);
  stickMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <logdepthbuf_vertex>",
      `gl_PointSize = clamp(gl_PointSize, ${minPx}, ${maxPx});\n#include <logdepthbuf_vertex>`,
    );
  };
  crowdGroup.add(new THREE.Points(stickGeo, stickMat));
  scene.add(crowdGroup);

  // ---- Stage: glowing deck, LED screens, beams ----
  if (model.stage) {
    const st = model.stage;
    const deckGeo = new THREE.BoxGeometry(st.width, st.height, st.depth);
    const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ color: 0x1a0b33, emissive: 0x6d28d9, emissiveIntensity: 0.8 }));
    deck.position.set(st.center.x, st.center.y, st.center.z);
    scene.add(deck);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(deckGeo),
      new THREE.LineBasicMaterial({ color: new THREE.Color(1.3, 0.6, 1.6), toneMapped: false }),
    );
    edges.position.copy(deck.position);
    scene.add(edges);
    const topGeo = new THREE.PlaneGeometry(st.width * 0.94, st.depth * 0.9);
    const top = new THREE.Mesh(topGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.22, 1.1), toneMapped: false }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(st.center.x, st.height + 0.02, st.center.z);
    scene.add(top);

    // LED screen texture: a generic concert-visual gradient (no external assets).
    let ledTex: InstanceType<ThreeNS["CanvasTexture"]> | null = null;
    const led = canvas2d(512, 288);
    if (led) {
      const { ctx } = led;
      const lg = ctx.createLinearGradient(0, 0, 512, 288);
      lg.addColorStop(0, "#2a0b63");
      lg.addColorStop(0.45, "#8b2bd6");
      lg.addColorStop(0.75, "#ff5cc8");
      lg.addColorStop(1, "#3c6cff");
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, 512, 288);
      const rg = ctx.createRadialGradient(256, 150, 10, 256, 150, 170);
      rg.addColorStop(0, "rgba(255,235,250,0.95)");
      rg.addColorStop(0.35, "rgba(255,150,230,0.45)");
      rg.addColorStop(1, "rgba(255,150,230,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, 512, 288);
      ctx.fillStyle = "rgba(20,6,40,0.55)"; // performer silhouette
      ctx.beginPath();
      ctx.arc(256, 118, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(232, 142, 48, 110);
      ctx.fillStyle = "rgba(0,0,0,0.18)"; // LED scanlines
      for (let yy = 0; yy < 288; yy += 4) ctx.fillRect(0, yy, 512, 1);
      ledTex = new THREE.CanvasTexture(led.canvas);
      ledTex.colorSpace = THREE.SRGBColorSpace;
      textures.push(ledTex);
    }
    const screenMat = new THREE.MeshBasicMaterial({
      map: ledTex,
      color: ledTex ? new THREE.Color(1.25, 1.25, 1.25) : new THREE.Color(0.9, 0.4, 1.4),
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0b0716, roughness: 0.8 });
    const addScreen = (w: number, h: number, x: number, y: number, z: number, rotY: number) => {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat);
      screen.position.set(x, y, z);
      screen.rotation.y = rotY;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, h * 1.06, 0.4), frameMat);
      frame.position.set(x, y, z);
      frame.rotation.y = rotY;
      frame.translateZ(-0.25);
      scene.add(frame, screen);
    };
    const isCentre = Math.abs(st.center.z) < 1e-6 && Math.abs(st.center.x) < 1e-6;
    if (isCentre) {
      // In the round: a four-sided screen cube hung above the stage, one face per side.
      const w = st.width * 0.72;
      const h = w * 0.5;
      const y = st.height + st.width * 0.75 + h / 2;
      const d = w / 2 + 0.3;
      addScreen(w, h, 0, y, d, 0);
      addScreen(w, h, 0, y, -d, Math.PI);
      addScreen(w, h, d, y, 0, Math.PI / 2);
      addScreen(w, h, -d, y, 0, -Math.PI / 2);
    } else {
      const backZ = st.center.z - st.depth / 2 - 0.6;
      const w = st.width * 0.48;
      const h = w * 0.5625;
      addScreen(w, h, st.center.x, st.height + 1.2 + h / 2, backZ, 0);
      const ws = st.width * 0.17;
      const hs = ws * 1.55;
      const sx = st.width * 0.4;
      addScreen(ws, hs, st.center.x - sx, st.height + 1 + hs / 2, backZ + ws * 0.3, 0.32);
      addScreen(ws, hs, st.center.x + sx, st.height + 1 + hs / 2, backZ + ws * 0.3, -0.32);
    }

    // Light beams: additive cones fading away from their source.
    const beamMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const beamLen = span * 0.55;
    const beamCount = isCentre ? 4 : 5;
    for (let b = 0; b < beamCount; b++) {
      const geo = new THREE.ConeGeometry(beamLen * 0.12, beamLen, 20, 1, true);
      fadeAlongY(THREE, geo, b % 2 === 0 ? [0.42, 0.2, 0.75] : [0.6, 0.18, 0.55], true);
      geo.translate(0, -beamLen / 2, 0); // apex at the origin (the fixture)
      const beam = new THREE.Mesh(geo, beamMat);
      const f = b / (beamCount - 1) - 0.5;
      if (isCentre) {
        const a = (b / beamCount) * Math.PI * 2 + Math.PI / 4;
        beam.position.set(Math.cos(a) * st.width * 0.4, st.height + st.width * 0.9, Math.sin(a) * st.width * 0.4);
        beam.rotation.set(Math.sin(a) * -0.5, 0, Math.cos(a) * 0.5);
      } else {
        beam.position.set(st.center.x + f * st.width * 0.9, st.height + st.width * 0.32, st.center.z);
        // Tilt down towards the audience (+z) and fan out sideways.
        beam.rotation.set(-1.3, 0, -f * 0.7);
      }
      scene.add(beam);
    }
  }

  // ---- Own seat beacon ----
  const beacon = new THREE.Group();
  let ring: InstanceType<ThreeNS["Mesh"]> | null = null;
  let ringMat: InstanceType<ThreeNS["MeshBasicMaterial"]> | null = null;
  let beamMesh: InstanceType<ThreeNS["Mesh"]> | null = null;
  const own = layout.ownSeat;
  const ownFallback = model.seat;
  const ownPos = own?.position ?? ownFallback?.position ?? null;
  if (ownPos) {
    if (own) {
      const ownSeatMesh = new THREE.Mesh(seatGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.35, 0.25), toneMapped: false }));
      ownSeatMesh.position.set(own.position.x, own.position.y, own.position.z);
      ownSeatMesh.rotation.y = own.yaw;
      ownSeatMesh.scale.setScalar(1.25);
      scene.add(ownSeatMesh);
    }
    const r = Math.max(0.35, span * 0.006);
    const h = span * 0.35;
    const beamGeo = new THREE.CylinderGeometry(r, r, h, 20, 1, true);
    beamGeo.translate(0, h / 2, 0);
    fadeAlongY(THREE, beamGeo, [1.6, 0.95, 0.2], false);
    beamMesh = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }),
    );
    beamMesh.position.set(ownPos.x, ownPos.y, ownPos.z);
    beacon.add(beamMesh);
    ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.3, 0.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.4, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(ownPos.x, ownPos.y + 0.12, ownPos.z);
    beacon.add(ring);
    if (glowTex) {
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(2.2, 1.3, 0.3), sizeAttenuation: false, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }),
      );
      halo.scale.set(0.035, 0.035, 1);
      halo.position.set(ownPos.x, ownPos.y + 0.8, ownPos.z);
      halo.renderOrder = 10;
      beacon.add(halo);
    }
    scene.add(beacon);
  }

  // ---- Block labels: one atlas texture, one sprite per block (bounded) ----
  const labels: { sprite: InstanceType<ThreeNS["Sprite"]>; block: number }[] = [];
  const cellW = 128;
  const cellH = 56;
  const cols = 8;
  const maxLabels = cols * Math.floor(1024 / cellH);
  const labelBlocks = layout.blocks.slice(0, maxLabels);
  const atlas = labelBlocks.length > 0 ? canvas2d(cols * cellW, Math.ceil(labelBlocks.length / cols) * cellH) : null;
  if (atlas) {
    const { canvas, ctx } = atlas;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    labelBlocks.forEach((block, i) => {
      const x = (i % cols) * cellW;
      const y = Math.floor(i / cols) * cellH;
      ctx.fillStyle = "rgba(14,9,34,0.78)";
      ctx.strokeStyle = "rgba(196,170,255,0.7)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x + 6, y + 6, cellW - 12, cellH - 12, 18);
      else ctx.rect(x + 6, y + 6, cellW - 12, cellH - 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      const text = block.label.length > 6 ? `${block.label.slice(0, 6)}…` : block.label;
      ctx.font = `bold ${text.length > 4 ? 22 : 30}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(text, x + cellW / 2, y + cellH / 2 + 1);
    });
    const base = new THREE.CanvasTexture(canvas);
    base.colorSpace = THREE.SRGBColorSpace;
    textures.push(base);
    labelBlocks.forEach((block, i) => {
      const tex = base.clone(); // shares the atlas image (uploaded once); own offset/repeat
      tex.repeat.set(cellW / canvas.width, cellH / canvas.height);
      tex.offset.set(((i % cols) * cellW) / canvas.width, 1 - ((Math.floor(i / cols) + 1) * cellH) / canvas.height);
      textures.push(tex);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false, toneMapped: false }),
      );
      sprite.position.set(block.anchor.x, block.anchor.y, block.anchor.z);
      sprite.renderOrder = 5;
      labels.push({ sprite, block: i });
      scene.add(sprite);
    });
  }
  const LABEL_H = 0.034;
  const labelStride = labels.length > 48 ? 2 : 1;
  const LABEL_W = LABEL_H * (cellW / cellH);
  let selected: number | null = null;
  const labelTint = (i: number) => {
    const b = layout.blocks[i];
    if (b.highlighted) return { c: [2.0, 1.25, 0.35], s: 1.3 };
    if (i === selected) return { c: [1.6, 1.3, 2.0], s: 1.3 };
    return { c: [0.88, 0.85, 1.0], s: 1 };
  };
  const applyLabelStyles = () => {
    for (const { sprite, block } of labels) {
      const { c, s } = labelTint(block);
      (sprite.material as InstanceType<ThreeNS["SpriteMaterial"]>).color.setRGB(c[0], c[1], c[2]);
      sprite.scale.set(LABEL_W * s, LABEL_H * s, 1);
    }
  };
  applyLabelStyles();

  // ---- Hover / tap surfaces ----
  const hitGeo = new THREE.BufferGeometry();
  hitGeo.setAttribute("position", new THREE.BufferAttribute(layout.hitSurfaces.positions, 3));
  hitGeo.computeBoundingSphere();
  const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  scene.add(hitMesh);

  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  return {
    scene,
    hitMesh,
    setCrowdVisible(visible) {
      crowdGroup.visible = visible;
    },
    setSelectedBlock(blockIndex) {
      const paint = (b: number, tint: boolean) => {
        const block = layout.blocks[b];
        if (!block) return;
        for (let s = block.seatStart; s < block.seatStart + block.seatCount; s++) {
          color.setRGB(baseColors[s * 3], baseColors[s * 3 + 1], baseColors[s * 3 + 2]);
          if (tint) color.lerp(new THREE.Color(1.5, 1.35, 1.7), 0.55);
          seatMesh.setColorAt(s, color);
        }
      };
      if (selected !== null) paint(selected, false);
      selected = blockIndex;
      if (selected !== null) paint(selected, true);
      if (seatMesh.instanceColor) seatMesh.instanceColor.needsUpdate = true;
      applyLabelStyles();
    },
    setBeaconVisible(visible) {
      beacon.visible = visible;
    },
    updateLabels(camera) {
      for (const { sprite, block } of labels) {
        const d = camera.position.distanceTo(sprite.position);
        const keep = layout.blocks[block].highlighted || block === selected;
        // Large venues: only every other block's label from afar, so the ring stays legible.
        if (!keep && labelStride > 1 && block % labelStride !== 0 && d > span * 0.9) {
          sprite.visible = false;
          continue;
        }
        const near = smooth(5, 16, d);
        const far = keep ? 1 : 1 - smooth(span * 3.4, span * 4.6, d);
        (sprite.material as InstanceType<ThreeNS["SpriteMaterial"]>).opacity = near * far;
        sprite.visible = near * far > 0.02;
      }
    },
    animate(now, strength) {
      if (!ring || !ringMat) return;
      const phase = (now % 1600) / 1600;
      ring.scale.setScalar(1 + phase * 3);
      ringMat.opacity = (1 - phase) * 0.9 * strength;
      if (beamMesh) (beamMesh.material as InstanceType<ThreeNS["MeshBasicMaterial"]>).opacity = 0.75 + 0.25 * Math.sin(now / 260) * strength;
    },
    dispose() {
      scene.traverse((obj: Object3D) => {
        const mesh = obj as Object3D & { geometry?: { dispose: () => void }; material?: { dispose: () => void } | { dispose: () => void }[] };
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
        else mesh.material?.dispose();
        if (obj instanceof THREE.InstancedMesh) obj.dispose();
      });
      for (const t of textures) t.dispose();
      scene.clear();
    },
  };
}
