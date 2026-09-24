/**
 * Turns the existing 2D fractional seat-map model into mesh-ready 3D data for a Kai Tak
 * Stadium bowl view. Deliberately pure — no `three` import here, and no rendering concerns —
 * so it can be unit-tested without a WebGL context and consumed by whichever renderer layer
 * turns `Float32Array` triangle lists into actual meshes.
 *
 * Placement math is NOT re-derived: every point comes from `perimeter.ts`'s
 * `pointOnPerimeter`/`pointAtDepth`/`sampleArc`, the exact same helpers `SeatMap.tsx` uses for
 * the 2D plan view, so the two views agree by construction. This module only adds a third
 * (height) axis and a metres scale on top of that shared 2D placement.
 *
 * Coordinate system: origin is the pitch centre at ground level, y is up, +z points away from
 * the stage (i.e. the stage sits at -z). The 2D plan's local coordinate space (the `OUTER`
 * rect, 0..220 x 0..260, same numbers as `SeatMap.tsx`) is centred on the pitch by
 * construction (the INNER pitch rect is centred inside OUTER — see perimeter.ts), so
 * `OUTER.width/2, OUTER.height/2` doubles as both the plan's centre and the pitch centre;
 * `toVec3` below just re-centres on that point and scales by `APPROXIMATE_BOWL.scaleX` /
 * `scaleZ`, flipping the y-local axis so larger local y (the stage edge in the 2D plan) maps
 * to more negative z.
 *
 * Other venues: a config's own `plan` rects and `approxFloorM` replace the Kai Tak defaults
 * (see `frameFor`), a centre-stage layout closes the stands into a 4-sided loop around a
 * stage box at the origin, a floor-kind level becomes flat block patches on the floor, and a
 * theatre layout builds no stands or seat at all (just `THEATRE_HEDGE`).
 *
 * Every single-source, non-measured number lives in `APPROXIMATE_BOWL`, each with a comment
 * saying so — none of this is verified venue data (see the venue config's own hedges for what
 * *is* documented).
 */

import type { LevelConfig, SeatGeometryFacts, VenueSeatMapConfig } from "./types";
import { THEATRE_HEDGE, isFloorLevel, layoutOf, locateBlock } from "./geometry";
import {
  PLAN_INNER,
  PLAN_OUTER,
  arcSamples,
  floorBandRect,
  perimeterKindFor,
  planRectsFor,
  pointAtDepth,
  seatPlanPoint,
  type PerimeterKind,
  type Point,
  type RectSize,
} from "./perimeter";

// ---- Public shape --------------------------------------------------------------

/** Metres; origin = pitch centre at ground; y = up; stage end is -z. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Flat xyz triangle list, non-indexed (every 9 numbers = one triangle, every 3 = one vertex). */
export interface Bowl3DSlab {
  levelId: string;
  label: string;
  tier: number;
  positions: Float32Array;
}

/** One flat floor block (a floor-kind level's depth band), as a triangle list lying just above
 * the floor. `highlighted` marks the resolved seat's own block. */
export interface Bowl3DFloorBlock {
  levelId: string;
  label: string;
  highlighted: boolean;
  positions: Float32Array;
}

export interface Bowl3DModel {
  pitch: { width: number; length: number }; // metres, x-extent and z-extent
  footprint: { width: number; length: number }; // metres, the outer wall rect's x/z extent (ground plane)
  stage: { center: Vec3; width: number; depth: number; height: number } | null; // null when not default layout / none
  slabs: Bowl3DSlab[]; // one per level band SeatMap.tsx would draw (confirmed ranges only); raked surface + back wall
  floorBlocks: Bowl3DFloorBlock[]; // flat patches for floor-kind levels (end stage, confirmed ranges only)
  seatBlock: Float32Array | null; // triangles for just the seat's block patch (highlight), null if angleFraction null
  seat: { position: Vec3; eye: Vec3; lookAt: Vec3 } | null; // null when angleFraction is null (e.g. blocks 101-110) — never guess
  hedge: string[]; // user-facing caveats; ALWAYS includes the approximation notice, plus geometry.hedge
}

// ---- Approximate constants ------------------------------------------------------

/**
 * Every non-verified metric this module invents lives here, each commented as approximate.
 * None of this is measured Kai Tak data — see `kai-tak.ts` / `geometry.ts` for what IS
 * documented (block ranges, row banks, stage-facing anchors). This is a schematic simulation
 * layered on top of that real data, not a survey.
 */
export const APPROXIMATE_BOWL = {
  // Local 2D plan-space rects, shared with SeatMap.tsx via perimeter.ts so the 2D and 3D
  // views can't drift apart.
  planOuter: PLAN_OUTER,
  planInner: PLAN_INNER,

  // Real-world pitch footprint (approximate — a generic full-size pitch, not Kai Tak's actual
  // measured dimensions) that the `planInner` rect is scaled to represent.
  pitchWidthM: 68,
  pitchLengthM: 105,
  // Derived per-axis metres-per-plan-unit scale, applied uniformly to both planInner and
  // planOuter so the whole bowl scales consistently (see module header for the transform).
  get scaleX(): number {
    return this.pitchWidthM / this.planInner.width;
  },
  get scaleZ(): number {
    return this.pitchLengthM / this.planInner.height;
  },

  // Same arc window SeatMap.tsx passes to `bandPath` for its level bands — kept slightly
  // inset from the full [0,1] loop as a schematic gap at the stage seam.
  bandArcStart: 0.02,
  bandArcEnd: 0.98,

  // Mesh resolution — arbitrary, chosen to look smooth without generating excessive geometry.
  arcSteps: 64, // samples across a full level band's arc
  blockArcSteps: 12, // samples across a single block's highlight patch

  // Approximate raked-seating base/rise per tier, in metres. Not measured — chosen to be a
  // plausible profile for a rounded-rect stadium bowl (floor near pitch level, Level 2 rising
  // to a concourse, Level 5 rising much further to the roofline). The plan's bands are only
  // ~12-14 m deep horizontally at this scale, so the rises are kept to a ~40-50 deg rake — a
  // taller rise reads as a near-vertical wall rather than a raked stand.
  tierHeightsM: {
    0: { baseM: 0, riseM: 1.2 }, // floor: a shallow standing platform, not raked seating
    1: { baseM: 2, riseM: 10 }, // Level 2 tier: rises to ~12 m
    2: { baseM: 16, riseM: 16 }, // Level 5 tier: rises to ~32 m
  } as Record<number, { baseM: number; riseM: number }>,

  // Height above the seat position for the "eye" viewpoint — an approximate seated eye-line,
  // not a measured ergonomic figure.
  eyeHeightM: 1.2,

  // Stage box (default layout only) — mirrors SeatMap.tsx's stage rect proportions
  // (`stageWidth = OUTER.width * 0.32`, an 8-unit-thick strip inset 6 units from the outer
  // wall) so the 3D stage footprint lines up with the 2D one, plus an invented platform
  // height (a typical concert stage riser, not a documented Kai Tak figure).
  stageWidthFractionOfOuter: 0.32,
  stageLocalThickness: 8,
  stageLocalYInset: 6,
  stageHeightM: 1.5,

  // Centre-stage box footprint as a fraction of the floor's shorter side (in-the-round stages
  // are compact squares; not a documented figure for any venue).
  centreStageFractionOfFloor: 0.28,
  // Floor block patches: lifted just above the floor to avoid z-fighting, with a small gap
  // between adjacent blocks (plan units) so they read as separate blocks.
  floorPatchY: 0.05,
  floorHighlightY: 0.12,
  floorBlockGapLocal: 1.5,
  // Samples around a closed 4-sided (centre-stage) loop — more than `arcSteps` since it runs
  // around all four sides.
  fullLoopSteps: 96,

  approximationNotice:
    "This 3D bowl view is a schematic simulation with approximate dimensions — not measured venue data.",
};

/**
 * Per-venue placement frame: plan rects, perimeter kind, and metres scale. Kai Tak (no `plan`,
 * no `approxFloorM`) gets exactly the `APPROXIMATE_BOWL` defaults, so its model is unchanged.
 * `heightScale` shrinks tier heights with the horizontal scale (square-root damped) so a
 * smaller arena's stands keep a plausible rake instead of towering over their shallower bands.
 */
export interface BowlFrame {
  outer: RectSize;
  inner: RectSize;
  kind: PerimeterKind;
  scaleX: number;
  scaleZ: number;
  heightScale: number;
  floorWidthM: number;
  floorLengthM: number;
}

export function frameFor(config: VenueSeatMapConfig): BowlFrame {
  const { outer, inner } = planRectsFor(config);
  const floorWidthM = config.approxFloorM?.width ?? APPROXIMATE_BOWL.pitchWidthM;
  const floorLengthM = config.approxFloorM?.length ?? APPROXIMATE_BOWL.pitchLengthM;
  const scaleX = floorWidthM / inner.width;
  const scaleZ = floorLengthM / inner.height;
  const defaultMean = (APPROXIMATE_BOWL.scaleX + APPROXIMATE_BOWL.scaleZ) / 2;
  // Square root, not linear: an arena's stands are shallower than a stadium's but not
  // proportionally lower — a linear scale flattens them into near-level decks.
  const heightScale = Math.sqrt((scaleX + scaleZ) / 2 / defaultMean);
  return { outer, inner, kind: perimeterKindFor(config), scaleX, scaleZ, heightScale, floorWidthM, floorLengthM };
}

// ---- Small local helpers --------------------------------------------------------

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Converts a 2D plan-space point (same space `pointAtDepth`/`sampleArc` operate in) plus an
 * explicit elevation into a metres Vec3. See module header for the transform's derivation:
 * the plan rects are centred on the pitch by construction, so this just re-centres and scales
 * per axis, flipping local y so the stage edge (larger local y) lands at more negative z. */
export function toVec3(frame: BowlFrame, local: Point, elevationM: number): Vec3 {
  return {
    x: (local.x - frame.outer.width / 2) * frame.scaleX,
    y: elevationM,
    z: (frame.outer.height / 2 - local.y) * frame.scaleZ,
  };
}

/** Base/rise for a tier, falling back to a linear extrapolation for a tier not covered by
 * `APPROXIMATE_BOWL.tierHeightsM` (not exercised by Kai Tak today, but keeps this module from
 * producing garbage if a future venue config adds one). */
export function tierHeights(tier: number, frame: BowlFrame): { baseM: number; riseM: number } {
  const known = APPROXIMATE_BOWL.tierHeightsM[tier] ?? { baseM: Math.max(0, 2 + (tier - 1) * 18), riseM: 12 };
  return { baseM: known.baseM * frame.heightScale, riseM: known.riseM * frame.heightScale };
}

/** Builds a raked, triangulated strip between `t0..t1` of the perimeter arc, with the inner
 * edge (`depthInner`) at `baseY` and the outer edge (`depthOuter`) at `topY`. Non-indexed
 * triangle list (2 triangles / 6 vertices per arc segment), CCW winding when viewed from +y
 * (i.e. front faces point up) on all three of a level's rectangle edges. */
export function buildRakedStrip(
  frame: BowlFrame,
  t0: number,
  t1: number,
  depthInner: number,
  depthOuter: number,
  baseY: number,
  topY: number,
  steps: number,
): Float32Array {
  const ts = arcSamples(t0, t1, frame.inner, frame.outer, steps, frame.kind);
  const innerPts = ts.map((t) => pointAtDepth(t, depthInner, frame.inner, frame.outer, frame.kind));
  const outerPts = ts.map((t) => pointAtDepth(t, depthOuter, frame.inner, frame.outer, frame.kind));
  const verts: number[] = [];
  const push = (p: Point, y: number) => {
    const v = toVec3(frame, p, y);
    verts.push(v.x, v.y, v.z);
  };
  for (let i = 0; i < ts.length - 1; i++) {
    const innerA = innerPts[i];
    const innerB = innerPts[i + 1];
    const outerA = outerPts[i];
    const outerB = outerPts[i + 1];
    // Triangle 1: innerA, outerA, innerB
    push(innerA, baseY);
    push(outerA, topY);
    push(innerB, baseY);
    // Triangle 2: outerA, outerB, innerB
    push(outerA, topY);
    push(outerB, topY);
    push(innerB, baseY);
  }
  return new Float32Array(verts);
}

/** Vertical back wall along a strip's outer edge (`depthOuter`), from `topY` down to `baseY`
 * — closes each tier into a solid wedge so it reads as a stand rather than a floating sheet.
 * Stops at the tier's own base (not the ground) so tiers never overlap vertically. Same
 * non-indexed triangle-list layout as `buildRakedStrip`. */
function buildBackWall(
  frame: BowlFrame,
  t0: number,
  t1: number,
  depthOuter: number,
  baseY: number,
  topY: number,
  steps: number,
): Float32Array {
  const ts = arcSamples(t0, t1, frame.inner, frame.outer, steps, frame.kind);
  const pts = ts.map((t) => pointAtDepth(t, depthOuter, frame.inner, frame.outer, frame.kind));
  const verts: number[] = [];
  const push = (p: Point, y: number) => {
    const v = toVec3(frame, p, y);
    verts.push(v.x, v.y, v.z);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    push(a, topY);
    push(a, baseY);
    push(b, topY);
    push(a, baseY);
    push(b, baseY);
    push(b, topY);
  }
  return new Float32Array(verts);
}

function concatFloat32(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ---- Slabs (level bands) --------------------------------------------------------

/** Mirrors SeatMap.tsx's level-band filter exactly: only a stand level with at least one
 * CONFIRMED block range (numbered or labelled) has a safe-to-draw arc position — a level with
 * none (e.g. Kai Tak's floor, whose only content is unnumbered standing zones) is skipped, not
 * guessed. Floor-kind levels are drawn as flat floor blocks instead (see `buildFloorBlocks`). */
export function hasConfirmedRange(level: LevelConfig): boolean {
  return (
    level.blockNumberRanges.some((r) => r.positionConfidence === "confirmed") ||
    (level.blockLabelRanges ?? []).some((r) => r.positionConfidence === "confirmed")
  );
}

/** Arc window a level band spans: the end-stage U keeps its small schematic gap at the stage
 * seam; a centre-stage loop closes all the way round. */
export function bandWindow(frame: BowlFrame): { t0: number; t1: number; steps: number } {
  return frame.kind === "four-sided"
    ? { t0: 0, t1: 1, steps: APPROXIMATE_BOWL.fullLoopSteps }
    : { t0: APPROXIMATE_BOWL.bandArcStart, t1: APPROXIMATE_BOWL.bandArcEnd, steps: APPROXIMATE_BOWL.arcSteps };
}

function buildSlabs(config: VenueSeatMapConfig, frame: BowlFrame): Bowl3DSlab[] {
  if (layoutOf(config) === "theatre") return [];
  const { t0, t1, steps } = bandWindow(frame);
  const slabs: Bowl3DSlab[] = [];
  for (const level of config.levels) {
    if (isFloorLevel(level) || !hasConfirmedRange(level)) continue;
    const [depthInner, depthOuter] = level.radiusRange;
    const { baseM, riseM } = tierHeights(level.tier, frame);
    const rake = buildRakedStrip(frame, t0, t1, depthInner, depthOuter, baseM, baseM + riseM, steps);
    const backWall = buildBackWall(frame, t0, t1, depthOuter, baseM, baseM + riseM, steps);
    const positions = concatFloat32(rake, backWall);
    slabs.push({ levelId: level.id, label: level.label, tier: level.tier, positions });
  }
  return slabs;
}

// ---- Floor blocks ----------------------------------------------------------------

/** Flat horizontal quad (2 triangles, CCW from +y) over a plan-space rect at height `y`. */
export function flatQuad(frame: BowlFrame, rect: { x: number; y: number; width: number; height: number }, y: number): Float32Array {
  const a = toVec3(frame, { x: rect.x, y: rect.y }, y);
  const b = toVec3(frame, { x: rect.x + rect.width, y: rect.y }, y);
  const c = toVec3(frame, { x: rect.x + rect.width, y: rect.y + rect.height }, y);
  const d = toVec3(frame, { x: rect.x, y: rect.y + rect.height }, y);
  return new Float32Array([a.x, a.y, a.z, d.x, d.y, d.z, b.x, b.y, b.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z]);
}

export function insetRect(rect: { x: number; y: number; width: number; height: number }, gap: number) {
  return { x: rect.x + gap, y: rect.y + gap / 2, width: Math.max(rect.width - gap * 2, 0), height: Math.max(rect.height - gap, 0) };
}

/** A floor-kind level's blocks as flat depth bands straight out from an END stage (block 0
 * nearest the stage). Confirmed ranges only; centre-stage floors aren't projected (see
 * geometry.ts), so they get no patches either. */
function buildFloorBlocks(config: VenueSeatMapConfig, frame: BowlFrame, geometry: SeatGeometryFacts | null): Bowl3DFloorBlock[] {
  if (layoutOf(config) !== "bowl-end-stage") return [];
  const seatLocation = geometry && geometry.angleFraction !== null ? locateBlock(config, geometry.block) : null;
  const blocks: Bowl3DFloorBlock[] = [];
  for (const level of config.levels) {
    if (!isFloorLevel(level)) continue;
    const ranges: { labels: string[] }[] = [
      ...level.blockNumberRanges
        .filter((r) => r.positionConfidence === "confirmed")
        .map((r) => ({ labels: Array.from({ length: r.max - r.min + 1 }, (_, i) => String(r.min + i)) })),
      ...(level.blockLabelRanges ?? []).filter((r) => r.positionConfidence === "confirmed"),
    ];
    for (const range of ranges) {
      range.labels.forEach((label, index) => {
        const rect = insetRect(floorBandRect(index, range.labels.length, frame.inner, frame.outer), APPROXIMATE_BOWL.floorBlockGapLocal);
        const highlighted =
          !!seatLocation &&
          seatLocation.level.id === level.id &&
          seatLocation.index === index &&
          seatLocation.count === range.labels.length;
        blocks.push({ levelId: level.id, label, highlighted, positions: flatQuad(frame, rect, APPROXIMATE_BOWL.floorPatchY) });
      });
    }
  }
  return blocks;
}

// ---- Stage -----------------------------------------------------------------------

function buildStage(config: VenueSeatMapConfig, frame: BowlFrame, isDefaultLayout: boolean): Bowl3DModel["stage"] {
  if (!isDefaultLayout) return null;
  const layout = layoutOf(config);
  if (layout === "theatre") return null;
  if (layout === "bowl-centre-stage") {
    // In the round: a compact square stage at the floor centre (the origin).
    const side = Math.min(frame.floorWidthM, frame.floorLengthM) * APPROXIMATE_BOWL.centreStageFractionOfFloor;
    return {
      center: { x: 0, y: APPROXIMATE_BOWL.stageHeightM / 2, z: 0 },
      width: side,
      depth: side,
      height: APPROXIMATE_BOWL.stageHeightM,
    };
  }
  const stageWidthLocal = frame.outer.width * APPROXIMATE_BOWL.stageWidthFractionOfOuter;
  const stageYLocal = frame.outer.height - APPROXIMATE_BOWL.stageLocalYInset;
  // Geometric centre of the stage strip (mirrors SeatMap.tsx's `stageX`/`stageY`/`stageWidth`
  // rect, converted from a corner+size rect into a centre point).
  const stageCenterLocal: Point = {
    x: frame.outer.width / 2,
    y: stageYLocal + APPROXIMATE_BOWL.stageLocalThickness / 2,
  };
  const center = toVec3(frame, stageCenterLocal, APPROXIMATE_BOWL.stageHeightM / 2);
  return {
    center,
    width: stageWidthLocal * frame.scaleX,
    depth: APPROXIMATE_BOWL.stageLocalThickness * frame.scaleZ,
    height: APPROXIMATE_BOWL.stageHeightM,
  };
}

// ---- Seat + seat-block highlight ------------------------------------------------

/** The seat's block highlight patch: a slice of its level's band spanning roughly one block's
 * share of its (confirmed) range's arc, at the level's full radial band depth. Clamped into
 * the same `[bandArcStart, bandArcEnd]` window the slab itself is drawn in — a seam block
 * (e.g. 201 or 501, angleFraction 0) would otherwise produce a sliver hanging just outside the
 * slab's own arc. */
function buildSeatBlockPatch(config: VenueSeatMapConfig, frame: BowlFrame, geometry: SeatGeometryFacts): Float32Array | null {
  if (geometry.angleFraction === null) return null;
  const located = locateBlock(config, geometry.block);
  if (!located || located.level.id !== geometry.levelId || located.positionConfidence !== "confirmed") return null;
  const level = located.level;

  if (isFloorLevel(level)) {
    // Same depth band as the floor block patch, lifted a little so it sits on top of it.
    const rect = insetRect(floorBandRect(located.index, located.count, frame.inner, frame.outer), APPROXIMATE_BOWL.floorBlockGapLocal);
    return flatQuad(frame, rect, APPROXIMATE_BOWL.floorHighlightY);
  }

  const { t0, t1 } = blockArcWindow(frame, located.index, located.count);

  const [depthInner, depthOuter] = level.radiusRange;
  const { baseM, riseM } = tierHeights(level.tier, frame);
  return buildRakedStrip(frame, t0, t1, depthInner, depthOuter, baseM, baseM + riseM, APPROXIMATE_BOWL.blockArcSteps);
}

/** The arc window (`t0..t1`) block `index` of `count` spans — the same window its highlight
 * patch and its generated seats (seats3d.ts) use. End stage: centred on `index/(count-1)` (the
 * resolver's `angleFraction`), clamped into the band's `[bandArcStart, bandArcEnd]` window so a
 * seam block (e.g. 201 or 501) doesn't hang outside its slab. Centre stage: blocks tile the
 * full loop, centred on `(index+0.5)/count`. */
export function blockArcWindow(frame: BowlFrame, index: number, count: number): { t0: number; t1: number; centre: number } {
  if (frame.kind === "four-sided") {
    const halfWidth = 0.5 / Math.max(count, 1); // centre-stage blocks tile the full loop
    const centre = (index + 0.5) / Math.max(count, 1);
    return { t0: Math.max(0, centre - halfWidth), t1: Math.min(1, centre + halfWidth), centre };
  }
  const blockCount = Math.max(count - 1, 1);
  const halfWidth = 0.5 / blockCount; // one block's approximate share of this range's arc
  const centre = index / blockCount;
  return {
    t0: Math.max(APPROXIMATE_BOWL.bandArcStart, centre - halfWidth),
    t1: Math.min(APPROXIMATE_BOWL.bandArcEnd, centre + halfWidth),
    centre,
  };
}

/** Seat position/eye/lookAt, consistent with the 2D marker: same `pointAtDepth` call SeatMap.tsx
 * uses for its marker, just carried into 3D with an elevation derived from the seat's radial
 * position within its level's band. Note `geometry.depthFraction` blends radial position with
 * an around-the-bowl term when a stage exists (see geometry.ts's `computeDepthFraction`), so
 * for a block right at the arc seam it can fall slightly outside its own level's
 * `radiusRange` — the elevation fraction is clamped to [0,1] so the seat still sits at a
 * plausible tier height rather than a wild extrapolation, but this is a known, accepted
 * approximation (faithful to the 2D marker, which uses the same `depthFraction`). */
function buildSeat(
  config: VenueSeatMapConfig,
  frame: BowlFrame,
  geometry: SeatGeometryFacts,
  stage: Bowl3DModel["stage"],
): Bowl3DModel["seat"] {
  if (geometry.angleFraction === null) return null;
  const level = config.levels.find((l) => l.id === geometry.levelId);
  if (!level) return null;
  const point2d = seatPlanPoint(config, geometry);
  if (!point2d) return null;

  let elevation = 0; // floor seats stand on the floor
  if (!isFloorLevel(level)) {
    const [depthInner, depthOuter] = level.radiusRange;
    const { baseM, riseM } = tierHeights(level.tier, frame);
    const localFraction = clamp01((geometry.depthFraction - depthInner) / Math.max(depthOuter - depthInner, 1e-6));
    elevation = baseM + localFraction * riseM;
  }

  const position = toVec3(frame, point2d, elevation);
  const eye: Vec3 = { x: position.x, y: position.y + APPROXIMATE_BOWL.eyeHeightM, z: position.z };
  const lookAt: Vec3 = stage ? stage.center : { x: 0, y: 0, z: 0 };

  return { position, eye, lookAt };
}

// ---- Entry point -------------------------------------------------------------

/**
 * Builds mesh-ready 3D data for a venue's bowl, optionally highlighting one resolved seat.
 * `geometry` is `null` when there's no seat to place (e.g. no config match, no block) — the
 * bowl itself (slabs, stage) still builds; only `seat`/`seatBlock` go null. When `geometry` is
 * null there's no `stagePosition` to read, so the default concert layout is assumed (mirrors
 * `DEFAULT_STAGE_POSITION` being the resolver's own default).
 */
export function buildBowl3D(config: VenueSeatMapConfig, geometry: SeatGeometryFacts | null): Bowl3DModel {
  const frame = frameFor(config);
  const isTheatre = layoutOf(config) === "theatre";
  const isDefaultLayout = geometry ? geometry.isDefaultStageLayout : true;
  const stage = buildStage(config, frame, isDefaultLayout);
  const slabs = buildSlabs(config, frame);
  const floorBlocks = isTheatre ? [] : buildFloorBlocks(config, frame, geometry);
  const seatBlock = geometry && !isTheatre ? buildSeatBlockPatch(config, frame, geometry) : null;
  const seat = geometry && !isTheatre ? buildSeat(config, frame, geometry, stage) : null;
  const hedge = [APPROXIMATE_BOWL.approximationNotice, ...(geometry?.hedge ?? [])];
  if (isTheatre && !hedge.includes(THEATRE_HEDGE)) hedge.push(THEATRE_HEDGE);

  return {
    pitch: { width: frame.floorWidthM, length: frame.floorLengthM },
    footprint: { width: frame.outer.width * frame.scaleX, length: frame.outer.height * frame.scaleZ },
    stage,
    slabs,
    floorBlocks,
    seatBlock,
    seat,
    hedge,
  };
}
