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
 * Every single-source, non-measured number lives in `APPROXIMATE_BOWL`, each with a comment
 * saying so — none of this is verified venue data (see the venue config's own hedges for what
 * *is* documented).
 */

import type { LevelConfig, SeatGeometryFacts, VenueSeatMapConfig } from "./types";
import { PLAN_INNER, PLAN_OUTER, pointAtDepth, sampleArc, type Point, type RectSize } from "./perimeter";

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

export interface Bowl3DModel {
  pitch: { width: number; length: number }; // metres, x-extent and z-extent
  stage: { center: Vec3; width: number; depth: number; height: number } | null; // null when not default layout / none
  slabs: Bowl3DSlab[]; // one per level band SeatMap.tsx would draw (confirmed ranges only)
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
  // to a concourse, Level 5 rising much further to the roofline).
  tierHeightsM: {
    0: { baseM: 0, riseM: 1.2 }, // floor: a shallow standing platform, not raked seating
    1: { baseM: 2, riseM: 12 }, // Level 2 tier: rises to ~14 m
    2: { baseM: 20, riseM: 22 }, // Level 5 tier: rises to ~42 m
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

  approximationNotice:
    "This 3D bowl view is a schematic simulation with approximate dimensions — not measured venue data.",
};

const OUTER: RectSize = APPROXIMATE_BOWL.planOuter;
const INNER: RectSize = APPROXIMATE_BOWL.planInner;

// ---- Small local helpers --------------------------------------------------------

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Converts a 2D plan-space point (same space `pointAtDepth`/`sampleArc` operate in) plus an
 * explicit elevation into a metres Vec3. See module header for the transform's derivation:
 * the plan rects are centred on the pitch by construction, so this just re-centres and scales
 * per axis, flipping local y so the stage edge (larger local y) lands at more negative z. */
function toVec3(local: Point, elevationM: number): Vec3 {
  return {
    x: (local.x - OUTER.width / 2) * APPROXIMATE_BOWL.scaleX,
    y: elevationM,
    z: (OUTER.height / 2 - local.y) * APPROXIMATE_BOWL.scaleZ,
  };
}

/** Base/rise for a tier, falling back to a linear extrapolation for a tier not covered by
 * `APPROXIMATE_BOWL.tierHeightsM` (not exercised by Kai Tak today, but keeps this module from
 * producing garbage if a future venue config adds one). */
function tierHeights(tier: number): { baseM: number; riseM: number } {
  const known = APPROXIMATE_BOWL.tierHeightsM[tier];
  if (known) return known;
  return { baseM: Math.max(0, 2 + (tier - 1) * 18), riseM: 12 };
}

/** Builds a raked, triangulated strip between `t0..t1` of the perimeter arc, with the inner
 * edge (`depthInner`) at `baseY` and the outer edge (`depthOuter`) at `topY`. Non-indexed
 * triangle list (2 triangles / 6 vertices per arc segment), CCW winding when viewed from +y
 * (i.e. front faces point up) on all three of a level's rectangle edges. */
function buildRakedStrip(
  t0: number,
  t1: number,
  depthInner: number,
  depthOuter: number,
  baseY: number,
  topY: number,
  steps: number,
): Float32Array {
  const innerPts = sampleArc(t0, t1, depthInner, INNER, OUTER, steps);
  const outerPts = sampleArc(t0, t1, depthOuter, INNER, OUTER, steps);
  const verts: number[] = [];
  const push = (p: Point, y: number) => {
    const v = toVec3(p, y);
    verts.push(v.x, v.y, v.z);
  };
  for (let i = 0; i < steps; i++) {
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

// ---- Slabs (level bands) --------------------------------------------------------

/** Mirrors SeatMap.tsx's level-band filter exactly: only a level with at least one CONFIRMED
 * block-number range has a safe-to-draw arc position — a level with none (e.g. Kai Tak's
 * floor, whose only content is unnumbered standing zones) is skipped, not guessed. */
function hasConfirmedRange(level: LevelConfig): boolean {
  return level.blockNumberRanges.some((r) => r.positionConfidence === "confirmed");
}

function buildSlabs(config: VenueSeatMapConfig): Bowl3DSlab[] {
  const slabs: Bowl3DSlab[] = [];
  for (const level of config.levels) {
    if (!hasConfirmedRange(level)) continue;
    const [depthInner, depthOuter] = level.radiusRange;
    const { baseM, riseM } = tierHeights(level.tier);
    const positions = buildRakedStrip(
      APPROXIMATE_BOWL.bandArcStart,
      APPROXIMATE_BOWL.bandArcEnd,
      depthInner,
      depthOuter,
      baseM,
      baseM + riseM,
      APPROXIMATE_BOWL.arcSteps,
    );
    slabs.push({ levelId: level.id, label: level.label, tier: level.tier, positions });
  }
  return slabs;
}

// ---- Stage -----------------------------------------------------------------------

function buildStage(isDefaultLayout: boolean): Bowl3DModel["stage"] {
  if (!isDefaultLayout) return null;
  const stageWidthLocal = OUTER.width * APPROXIMATE_BOWL.stageWidthFractionOfOuter;
  const stageYLocal = OUTER.height - APPROXIMATE_BOWL.stageLocalYInset;
  // Geometric centre of the stage strip (mirrors SeatMap.tsx's `stageX`/`stageY`/`stageWidth`
  // rect, converted from a corner+size rect into a centre point).
  const stageCenterLocal: Point = {
    x: OUTER.width / 2,
    y: stageYLocal + APPROXIMATE_BOWL.stageLocalThickness / 2,
  };
  const center = toVec3(stageCenterLocal, APPROXIMATE_BOWL.stageHeightM / 2);
  return {
    center,
    width: stageWidthLocal * APPROXIMATE_BOWL.scaleX,
    depth: APPROXIMATE_BOWL.stageLocalThickness * APPROXIMATE_BOWL.scaleZ,
    height: APPROXIMATE_BOWL.stageHeightM,
  };
}

// ---- Seat + seat-block highlight ------------------------------------------------

/** The seat's block highlight patch: a slice of its level's band spanning roughly one block's
 * share of its (confirmed) range's arc, at the level's full radial band depth. Clamped into
 * the same `[bandArcStart, bandArcEnd]` window the slab itself is drawn in — a seam block
 * (e.g. 201 or 501, angleFraction 0) would otherwise produce a sliver hanging just outside the
 * slab's own arc. */
function buildSeatBlockPatch(config: VenueSeatMapConfig, geometry: SeatGeometryFacts): Float32Array | null {
  if (geometry.angleFraction === null) return null;
  const level = config.levels.find((l) => l.id === geometry.levelId);
  if (!level) return null;
  const range = level.blockNumberRanges.find(
    (r) => r.positionConfidence === "confirmed" && geometry.blockNumeric >= r.min && geometry.blockNumeric <= r.max,
  );
  if (!range) return null;

  const blockCount = Math.max(range.max - range.min, 1);
  const halfWidth = 0.5 / blockCount; // one block's approximate share of this range's arc
  const t0 = Math.max(APPROXIMATE_BOWL.bandArcStart, geometry.angleFraction - halfWidth);
  const t1 = Math.min(APPROXIMATE_BOWL.bandArcEnd, geometry.angleFraction + halfWidth);

  const [depthInner, depthOuter] = level.radiusRange;
  const { baseM, riseM } = tierHeights(level.tier);
  return buildRakedStrip(t0, t1, depthInner, depthOuter, baseM, baseM + riseM, APPROXIMATE_BOWL.blockArcSteps);
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
  geometry: SeatGeometryFacts,
  stage: Bowl3DModel["stage"],
): Bowl3DModel["seat"] {
  if (geometry.angleFraction === null) return null;
  const level = config.levels.find((l) => l.id === geometry.levelId);
  if (!level) return null;

  const [depthInner, depthOuter] = level.radiusRange;
  const { baseM, riseM } = tierHeights(level.tier);
  const localFraction = clamp01((geometry.depthFraction - depthInner) / Math.max(depthOuter - depthInner, 1e-6));
  const elevation = baseM + localFraction * riseM;

  const point2d = pointAtDepth(geometry.angleFraction, geometry.depthFraction, INNER, OUTER);
  const position = toVec3(point2d, elevation);
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
  const isDefaultLayout = geometry ? geometry.isDefaultStageLayout : true;
  const stage = buildStage(isDefaultLayout);
  const slabs = buildSlabs(config);
  const seatBlock = geometry ? buildSeatBlockPatch(config, geometry) : null;
  const seat = geometry ? buildSeat(config, geometry, stage) : null;
  const hedge = [APPROXIMATE_BOWL.approximationNotice, ...(geometry?.hedge ?? [])];

  return {
    pitch: { width: APPROXIMATE_BOWL.pitchWidthM, length: APPROXIMATE_BOWL.pitchLengthM },
    stage,
    slabs,
    seatBlock,
    seat,
    hedge,
  };
}
