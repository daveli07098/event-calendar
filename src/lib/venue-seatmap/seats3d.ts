/**
 * Schematic per-seat layout for the 3D venue view: turns a venue config's blocks into rows of
 * individual seat positions (instanced-mesh transforms), block label anchors, floor aisle lines,
 * a decorative crowd, and the resolved seat's own spot among those rows. Pure — no `three`
 * import — so it's unit-tested without WebGL, same contract as bowl3d.ts.
 *
 * Placement reuses bowl3d.ts's frame (`frameFor`/`toVec3`/`tierHeights`/`blockArcWindow`) and
 * perimeter.ts's `pointAtDepth`, so every generated seat sits inside the block patch and slab the
 * rest of the 3D view (and the 2D plan) draws for it. What this module adds is invented density:
 *  - rows: the slab's rake length / `SEAT_LAYOUT.rowPitchM` (not the documented row count — the
 *    slabs are schematic and much shallower than the real stands). Each generated row carries the
 *    nearest documented row label by depth fraction (the same fraction the resolver computes), so
 *    a seat's row letter maps to the nearest generated row consistently.
 *  - seats per row: the row's arc length within its block / `SEAT_LAYOUT.seatPitchM`, less an
 *    aisle at each block edge.
 *  - a `maxSeats` cap samples every Nth seat within each row (every row is kept unless the cap is
 *    below one seat per row), never shrinks the venue.
 * Only CONFIRMED block ranges get seats (Kai Tak's 101-110 never do), and the own seat is `null`
 * whenever the resolver gave no arc position — nothing here is a guessed position.
 */

import type { LevelConfig, SeatGeometryFacts, VenueSeatMapConfig } from "./types";
import { isFloorLevel, layoutOf, locateBlock } from "./geometry";
import { arcSamples, floorBandRect, pointAtDepth } from "./perimeter";
import {
  DEFAULT_ROW_SEQUENCE,
  bankedRowDepthFraction,
  defaultRowDepthFraction,
  numericRowDepthFraction,
  sequenceRowDepthFraction,
} from "./rows";
import {
  APPROXIMATE_BOWL,
  blockArcWindow,
  buildRakedStrip,
  flatQuad,
  frameFor,
  insetRect,
  tierHeights,
  toVec3,
  type BowlFrame,
  type Bowl3DModel,
  type Vec3,
} from "./bowl3d";

/** Invented, approximate seating metrics — none is a measured venue figure. */
export const SEAT_LAYOUT = {
  seatPitchM: 0.55, // centre-to-centre along a row (a typical stadium seat width)
  rowPitchM: 0.85, // row-to-row along the rake (a typical tread depth)
  aisleM: 1.2, // gap left at each block edge (half on each side of the boundary)
  floorAisleM: 1.6, // floor cross-aisles between a floor block's sections
  floorSectionsAcross: 3, // a floor block is split into this many side-by-side sections
  // Stand rows are kept a little inside the slab's edges so seats don't overhang them.
  rowInsetFraction: 0.04,
  seatedEyeM: 1.2,
  // A little above a real standing eye-line (~1.6 m) so a floor view clears the heads directly
  // in front — schematic, like the rest of the camera placement.
  standingEyeM: 2.0,
  // No crowd figure within this horizontal radius of the own seat (the camera sits there).
  ownSeatClearM: 1.3,
  // Share of stand seats with a (decorative) audience member; floor blocks are always full.
  standCrowdShare: 0.7,
  standingCrowdPitchM: 0.95, // grid pitch for the decorative standing crowd on an unblocked floor
  standingCrowdFloorShare: 0.7, // how much of an end-stage floor (from the stage) the crowd fills
  labelLiftM: 2.5, // label anchor height above a block's back/top
};

/** Default caps for `maxSeats`: a desktop GPU vs a phone. */
export const SEAT_DENSITY = { desktop: 60000, mobile: 15000 } as const;

export interface SeatBlock3D {
  /** `${levelId}:${label}` — unique within the layout. */
  key: string;
  label: string;
  levelId: string;
  levelLabel: string;
  tier: number;
  kind: "stand" | "floor";
  /** Label position: above the middle of the block's rake (stand) or its centre (floor). */
  anchor: Vec3;
  /** Approximate documented row label per generated row, front to back. */
  rowLabels: string[];
  /** Contiguous range of this block's seats in the (sampled) seat arrays. */
  seatStart: number;
  seatCount: number;
  /** The resolved seat's own block. */
  highlighted: boolean;
}

export interface OwnSeat3D {
  blockIndex: number;
  rowIndex: number;
  /** Index into the sampled seat arrays, or `null` when sampling skipped this seat (it is still
   * drawn — the renderer adds it as its own highlighted seat). */
  seatIndex: number | null;
  position: Vec3;
  yaw: number;
  eye: Vec3;
  lookAt: Vec3;
}

export interface SeatLayout3D {
  /** Seats emitted after density sampling. */
  count: number;
  /** Seats the full-density layout would have (before the cap). */
  totalGenerated: number;
  /** Every `stride`-th seat of each row is kept (1 = all). */
  stride: number;
  /** Every `rowStride`-th row is kept — above 1 only when the cap is below one seat per row. */
  rowStride: number;
  /** xyz of each seat's base centre (metres, bowl3d coordinates). */
  positions: Float32Array;
  /** Rotation about +y so the seat's local +z faces the field/stage. */
  yaw: Float32Array;
  blockIndex: Uint16Array;
  rowIndex: Uint16Array;
  blocks: SeatBlock3D[];
  /** Decorative audience: xyz base per figure, `standing` 1/0 (seated figures sit on a seat). */
  crowd: { positions: Float32Array; standing: Uint8Array; count: number };
  /** Floor outlines/aisles as line-segment pairs (xyz, xyz). */
  floorLines: Float32Array;
  /** Invisible per-block hover/tap surfaces: a triangle list (9 numbers per triangle) and the
   * block index of each triangle, so a raycast hit maps straight to a block. */
  hitSurfaces: { positions: Float32Array; triangleBlock: Uint16Array };
  ownSeat: OwnSeat3D | null;
}

/** Shown alongside the 3D view's other hedges. */
export const SEAT_LAYOUT_HEDGE =
  "Individual seats, rows and the crowd are drawn schematically — row spacing and seat counts are approximate, not the venue's real seating chart.";

export interface SeatLayoutOptions {
  maxSeats?: number;
  /** Seed for the crowd's deterministic sampling. */
  seed?: number;
}

// ---- Small helpers -----------------------------------------------------------------

/** mulberry32 — tiny deterministic PRNG so the crowd is stable across renders and tests. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

interface RowPlan {
  /** Seat base positions (full density) and facing. */
  seats: { p: Vec3; yaw: number }[];
}

interface BlockPlan {
  block: Omit<SeatBlock3D, "seatStart" | "seatCount">;
  rows: RowPlan[];
  /** Each generated row's depth on the resolver's `SeatGeometryFacts.rowDepthFraction` scale
   * (not its physical placement), used to map the seat's own row. */
  rowFractions: number[];
  /** Eye height above the seat base for the own seat. */
  eyeM: number;
  /** Hover/tap surface triangles for this block. */
  hit: Float32Array;
}

/** Candidate documented row labels for a level + the depth fraction the resolver gives each,
 * following the resolver's precedence (geometry.ts): `rowBankSplit` banks first, then the
 * level's own `rowSequence`, and only with neither the generic sequence (numeric rows for a
 * floor, the default A..Z/AA..QQ for a stand). */
function rowCandidates(level: LevelConfig): { label: string; fraction: number }[] {
  const out: { label: string; fraction: number }[] = [];
  const split = level.rowBankSplit;
  if (split) {
    for (const label of [...split.lowerRows, ...split.upperRows]) out.push({ label, fraction: bankedRowDepthFraction(label, split) ?? 0 });
  }
  if (level.rowSequence) {
    const seq = level.rowSequence;
    for (const label of seq) {
      if (!out.some((c) => c.label === label)) out.push({ label, fraction: sequenceRowDepthFraction(label, seq) ?? 0 });
    }
  }
  if (out.length > 0) return out;
  if (isFloorLevel(level)) {
    return Array.from({ length: 30 }, (_, i) => String(i + 1)).map((label) => ({ label, fraction: numericRowDepthFraction(label) ?? 0 }));
  }
  return DEFAULT_ROW_SEQUENCE.map((label) => ({ label, fraction: defaultRowDepthFraction(label) ?? 0 }));
}

function nearestLabel(candidates: { label: string; fraction: number }[], fraction: number): string {
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c.fraction - fraction) < Math.abs(best.fraction - fraction)) best = c;
  return best?.label ?? "";
}

/** Maps physical row placements (0..1 across the band) onto the resolver's depth scale for this
 * level's documented rows. Usually identity, but a one-bank `rowBankSplit` (rows listed only in
 * `lowerRows`, e.g. a front-row-AA floor) resolves into [0, 0.4] — its rows still fill the whole
 * band physically, so their label/own-row fractions are rescaled into that range. */
function labelFractions(candidates: { fraction: number }[], placements: number[]): number[] {
  const fs = candidates.map((c) => c.fraction);
  const lo = Math.min(...fs);
  const hi = Math.max(...fs);
  return placements.map((p) => lo + p * (hi - lo));
}

/** Generated row depth fractions (0 = front, 1 = back) for `n` rows. A banked level keeps a
 * real walkway gap between its banks, split at the resolver's own bank boundaries. */
function rowFractionsFor(level: LevelConfig, n: number): number[] {
  if (n <= 1) return [0.5];
  const split = level.rowBankSplit;
  if (split && split.lowerRows.length > 0 && split.upperRows.length > 0 && n >= 4) {
    const lowerMax = bankedRowDepthFraction(split.lowerRows[split.lowerRows.length - 1], split) ?? 0.4;
    const upperMin = bankedRowDepthFraction(split.upperRows[0], split) ?? 0.6;
    const usable = lowerMax + (1 - upperMin);
    const nLower = Math.max(2, Math.min(n - 2, Math.round((n * lowerMax) / usable)));
    const nUpper = n - nLower;
    const lower = Array.from({ length: nLower }, (_, i) => (i / (nLower - 1)) * lowerMax);
    const upper = Array.from({ length: nUpper }, (_, i) => upperMin + (i / (nUpper - 1)) * (1 - upperMin));
    return [...lower, ...upper];
  }
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

/** Samples a polyline along the arc window at a fixed band depth (metres, with elevation). */
function arcPolyline(frame: BowlFrame, t0: number, t1: number, depth: number, y: number): { p: Vec3; t: number }[] {
  const ts = arcSamples(t0, t1, frame.inner, frame.outer, 24, frame.kind);
  return ts.map((t) => ({ p: toVec3(frame, pointAtDepth(t, depth, frame.inner, frame.outer, frame.kind), y), t }));
}

/** Confirmed blocks of a level as `{label, index, count}` in each range's documented order. */
function confirmedBlocks(level: LevelConfig): { label: string; index: number; count: number }[] {
  const out: { label: string; index: number; count: number }[] = [];
  for (const r of level.blockNumberRanges) {
    if (r.positionConfidence !== "confirmed") continue;
    const count = r.max - r.min + 1;
    for (let i = 0; i < count; i++) out.push({ label: String(r.min + i), index: i, count });
  }
  for (const r of level.blockLabelRanges ?? []) {
    if (r.positionConfidence !== "confirmed") continue;
    r.labels.forEach((label, index) => out.push({ label, index, count: r.labels.length }));
  }
  return out;
}

// ---- Stand blocks ---------------------------------------------------------------------

function planStandLevel(frame: BowlFrame, level: LevelConfig): BlockPlan[] {
  const blocks = confirmedBlocks(level);
  if (blocks.length === 0) return [];
  const [depthInner, depthOuter] = level.radiusRange;
  const { baseM, riseM } = tierHeights(level.tier, frame);
  // Rows fixed per level from the rake length at the band's middle (the far end for an end
  // stage), so every block of the level reads as the same neat row pattern.
  const inner = toVec3(frame, pointAtDepth(0.5, depthInner, frame.inner, frame.outer, frame.kind), baseM);
  const outer = toVec3(frame, pointAtDepth(0.5, depthOuter, frame.inner, frame.outer, frame.kind), baseM + riseM);
  const rowCount = Math.max(3, Math.floor(dist(inner, outer) / SEAT_LAYOUT.rowPitchM));
  const placements = rowFractionsFor(level, rowCount);
  const candidates = rowCandidates(level);
  const rowFractions = labelFractions(candidates, placements);
  const rowLabels = rowFractions.map((f) => nearestLabel(candidates, f));
  const inset = SEAT_LAYOUT.rowInsetFraction;

  return blocks.map(({ label, index, count }) => {
    const { t0, t1, centre } = blockArcWindow(frame, index, count);
    const rows: RowPlan[] = placements.map((f) => {
      const g = inset + f * (1 - 2 * inset);
      const depth = depthInner + g * (depthOuter - depthInner);
      const y = baseM + g * riseM;
      const line = arcPolyline(frame, t0, t1, depth, y);
      const cumulative = [0];
      for (let i = 1; i < line.length; i++) cumulative.push(cumulative[i - 1] + dist(line[i - 1].p, line[i].p));
      const length = cumulative[cumulative.length - 1];
      const usable = length - SEAT_LAYOUT.aisleM;
      const n = Math.max(0, Math.floor(usable / SEAT_LAYOUT.seatPitchM));
      const seats: RowPlan["seats"] = [];
      const start = (length - n * SEAT_LAYOUT.seatPitchM) / 2 + SEAT_LAYOUT.seatPitchM / 2;
      let seg = 0;
      for (let j = 0; j < n; j++) {
        const s = start + j * SEAT_LAYOUT.seatPitchM;
        while (seg < line.length - 2 && cumulative[seg + 1] < s) seg++;
        const segLen = Math.max(cumulative[seg + 1] - cumulative[seg], 1e-9);
        const u = Math.min(1, Math.max(0, (s - cumulative[seg]) / segLen));
        const a = line[seg];
        const b = line[seg + 1];
        const p = { x: a.p.x + (b.p.x - a.p.x) * u, y, z: a.p.z + (b.p.z - a.p.z) * u };
        const t = a.t + (b.t - a.t) * u;
        // Face inward: from the outer edge towards the inner edge at the same arc position.
        const pin = toVec3(frame, pointAtDepth(t, depthInner, frame.inner, frame.outer, frame.kind), 0);
        const pout = toVec3(frame, pointAtDepth(t, depthOuter, frame.inner, frame.outer, frame.kind), 0);
        seats.push({ p, yaw: Math.atan2(pin.x - pout.x, pin.z - pout.z) });
      }
      return { seats };
    });
    // Over the middle of the block's rake, so stacked tiers' labels don't collide at the seam
    // between one tier's back and the next tier's front.
    const anchorPoint = toVec3(
      frame,
      pointAtDepth(centre, (depthInner + depthOuter) / 2, frame.inner, frame.outer, frame.kind),
      baseM + riseM / 2 + SEAT_LAYOUT.labelLiftM,
    );
    return {
      block: {
        key: `${level.id}:${label}`,
        label,
        levelId: level.id,
        levelLabel: level.label,
        tier: level.tier,
        kind: "stand" as const,
        anchor: anchorPoint,
        rowLabels,
        highlighted: false,
      },
      rows,
      rowFractions,
      eyeM: SEAT_LAYOUT.seatedEyeM,
      hit: buildRakedStrip(frame, t0, t1, depthInner, depthOuter, baseM, baseM + riseM, 6),
    };
  });
}

// ---- Floor blocks ---------------------------------------------------------------------

type Rect = { x: number; y: number; width: number; height: number };

function planToVec(frame: BowlFrame, x: number, y: number, elev = 0): Vec3 {
  return toVec3(frame, { x, y }, elev);
}

/** Floor blocks (end stage only, like bowl3d's floor patches): each depth band split into
 * `floorSectionsAcross` sections with cross-aisles, rows front (stage side) to back. */
function planFloorLevel(frame: BowlFrame, level: LevelConfig, lines: number[]): BlockPlan[] {
  const blocks = confirmedBlocks(level);
  const candidates = rowCandidates(level);
  return blocks.map(({ label, index, count }) => {
    const rect: Rect = insetRect(floorBandRect(index, count, frame.inner, frame.outer), APPROXIMATE_BOWL.floorBlockGapLocal);
    const depthM = rect.height * frame.scaleZ;
    const rowCount = Math.max(2, Math.floor(depthM / SEAT_LAYOUT.rowPitchM));
    const rowFractions = labelFractions(candidates, rowFractionsFor(level, rowCount));
    const sections = SEAT_LAYOUT.floorSectionsAcross;
    const aisleLocal = SEAT_LAYOUT.floorAisleM / frame.scaleX;
    const sectionWidthLocal = (rect.width - aisleLocal * (sections - 1)) / sections;
    const perSection = Math.max(1, Math.floor((sectionWidthLocal * frame.scaleX) / SEAT_LAYOUT.seatPitchM));
    const pitchLocal = SEAT_LAYOUT.seatPitchM / frame.scaleX;
    const rowPitchLocal = rowCount > 1 ? (rect.height - SEAT_LAYOUT.rowPitchM / frame.scaleZ) / (rowCount - 1) : 0;
    // Stage is on the plan's bottom edge (larger y), so row 0 hugs the rect's bottom.
    const rowY = (k: number) => rect.y + rect.height - SEAT_LAYOUT.rowPitchM / frame.scaleZ / 2 - k * rowPitchLocal;
    const rows: RowPlan[] = rowFractions.map((_, k) => {
      const seats: RowPlan["seats"] = [];
      for (let s = 0; s < sections; s++) {
        const sx = rect.x + s * (sectionWidthLocal + aisleLocal);
        const start = sx + (sectionWidthLocal - perSection * pitchLocal) / 2 + pitchLocal / 2;
        for (let j = 0; j < perSection; j++) {
          seats.push({ p: planToVec(frame, start + j * pitchLocal, rowY(k), APPROXIMATE_BOWL.floorPatchY), yaw: Math.PI });
        }
      }
      return { seats };
    });
    // Glowing section outlines (each section's rect) — the floor's aisle lines.
    for (let s = 0; s < sections; s++) {
      const sx = rect.x + s * (sectionWidthLocal + aisleLocal);
      const corners = [
        planToVec(frame, sx, rect.y, 0.08),
        planToVec(frame, sx + sectionWidthLocal, rect.y, 0.08),
        planToVec(frame, sx + sectionWidthLocal, rect.y + rect.height, 0.08),
        planToVec(frame, sx, rect.y + rect.height, 0.08),
      ];
      for (let c = 0; c < 4; c++) {
        const a = corners[c];
        const b = corners[(c + 1) % 4];
        lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const centre = planToVec(frame, rect.x + rect.width / 2, rect.y + rect.height / 2, SEAT_LAYOUT.labelLiftM + 1);
    return {
      block: {
        key: `${level.id}:${label}`,
        label,
        levelId: level.id,
        levelLabel: level.label,
        tier: level.tier,
        kind: "floor" as const,
        anchor: centre,
        rowLabels: rowFractions.map((f) => nearestLabel(candidates, f)),
        highlighted: false,
      },
      rows,
      rowFractions,
      eyeM: SEAT_LAYOUT.standingEyeM,
      hit: flatQuad(frame, rect, 0.3),
    };
  });
}

// ---- Decorative floor crowd ----------------------------------------------------------------

/** A standing crowd on a floor with no configured floor blocks (Kai Tak's Zone A/B/C standing
 * floor, an in-the-round floor): purely decorative, no block/row claims. End stage: the front
 * `standingCrowdFloorShare` of the floor from the stage. Centre stage: the whole floor minus the
 * stage box and a margin around it. */
function decorativeFloorCrowd(
  frame: BowlFrame,
  stage: Bowl3DModel["stage"],
  isCentre: boolean,
  rand: () => number,
  lines: number[],
): Vec3[] {
  const out: Vec3[] = [];
  const halfW = frame.floorWidthM / 2 - 2;
  const halfL = frame.floorLengthM / 2 - 2;
  const pitch = SEAT_LAYOUT.standingCrowdPitchM;
  const zFront = -halfL; // stage end is -z
  const zBack = isCentre ? halfL : -halfL + frame.floorLengthM * SEAT_LAYOUT.standingCrowdFloorShare;
  for (let z = zFront; z <= zBack; z += pitch) {
    for (let x = -halfW; x <= halfW; x += pitch) {
      const p = { x: x + (rand() - 0.5) * pitch * 0.6, y: 0, z: z + (rand() - 0.5) * pitch * 0.6 };
      if (stage) {
        const margin = 3;
        if (Math.abs(p.x - stage.center.x) < stage.width / 2 + margin && Math.abs(p.z - stage.center.z) < stage.depth / 2 + margin) continue;
      }
      // Leave a few thin aisles so the crowd reads as pens rather than a carpet.
      if (Math.abs(p.x) < 0.9 || Math.abs(Math.abs(p.x) - halfW / 2) < 0.6) continue;
      out.push(p);
    }
  }
  // Glowing pen outline + the aisle lines the crowd leaves free.
  const y = 0.08;
  const seg = (x0: number, z0: number, x1: number, z1: number) => lines.push(x0, y, z0, x1, y, z1);
  seg(-halfW, zFront, halfW, zFront);
  seg(halfW, zFront, halfW, zBack);
  seg(halfW, zBack, -halfW, zBack);
  seg(-halfW, zBack, -halfW, zFront);
  for (const x of [0, -halfW / 2, halfW / 2]) seg(x, zFront, x, zBack);
  return out;
}

// ---- Entry point ------------------------------------------------------------------------

/**
 * Builds the per-seat layout for a venue. `model` is the same venue's `buildBowl3D` output
 * (for the stage and lookAt). Theatre layouts get an empty layout.
 */
export function buildSeatLayout3D(
  config: VenueSeatMapConfig,
  geometry: SeatGeometryFacts | null,
  model: Bowl3DModel,
  options: SeatLayoutOptions = {},
): SeatLayout3D {
  const maxSeats = Math.max(1, options.maxSeats ?? SEAT_DENSITY.desktop);
  const rand = rng(options.seed ?? 0x5eed);
  const frame = frameFor(config);
  const layout = layoutOf(config);
  const lines: number[] = [];
  const plans: BlockPlan[] = [];

  if (layout !== "theatre") {
    for (const level of config.levels) {
      if (isFloorLevel(level)) {
        if (layout === "bowl-end-stage") plans.push(...planFloorLevel(frame, level, lines));
      } else {
        plans.push(...planStandLevel(frame, level));
      }
    }
  }

  // Own seat: its block + nearest generated row by depth fraction, middle of that row (seat
  // numbers aren't mapped). Only when the resolver gave an arc position.
  let own: { plan: number; row: number; seat: number } | null = null;
  if (geometry && geometry.angleFraction !== null && layout !== "theatre") {
    const located = locateBlock(config, geometry.block);
    if (located && located.positionConfidence === "confirmed") {
      const wantedLabel = located.numeric !== null ? String(located.numeric) : geometry.block.trim().toUpperCase();
      const planIndex = plans.findIndex((p) => p.block.levelId === located.level.id && p.block.label.trim().toUpperCase() === wantedLabel);
      if (planIndex !== -1) {
        const plan = plans[planIndex];
        const wanted = geometry.rowDepthFraction ?? 0.5;
        let row = 0;
        plan.rowFractions.forEach((f, k) => {
          if (Math.abs(f - wanted) < Math.abs(plan.rowFractions[row] - wanted)) row = k;
        });
        const n = plan.rows[row].seats.length;
        if (n > 0) own = { plan: planIndex, row, seat: Math.floor(n / 2) };
      }
    }
  }

  const totalGenerated = plans.reduce((sum, p) => sum + p.rows.reduce((s, r) => s + r.seats.length, 0), 0);
  // Seats kept in row `k` of `n` seats: every `stride`-th, offset by row so a sampled layout
  // staggers instead of leaving straight empty lanes; rows only thin (`rowStride`) when even one
  // seat per row would exceed the cap.
  const keptInRow = (n: number, k: number, stride: number, rowStride: number) =>
    k % rowStride !== 0 ? 0 : Math.max(0, Math.ceil((n - (k % stride)) / stride));
  const keptFor = (stride: number, rowStride: number) =>
    plans.reduce((sum, p) => sum + p.rows.reduce((acc, r, k) => acc + keptInRow(r.seats.length, k, stride, rowStride), 0), 0);
  const longestRow = plans.reduce((m, p) => p.rows.reduce((mm, r) => Math.max(mm, r.seats.length), m), 1);
  let stride = Math.max(1, Math.ceil(totalGenerated / maxSeats));
  let rowStride = 1;
  while (keptFor(stride, rowStride) > maxSeats) {
    if (stride < longestRow) stride++;
    else rowStride++;
  }
  const count = keptFor(stride, rowStride);

  const positions = new Float32Array(count * 3);
  const yaw = new Float32Array(count);
  const blockIndex = new Uint16Array(count);
  const rowIndex = new Uint16Array(count);
  const blocks: SeatBlock3D[] = [];
  let ownSeatIndex: number | null = null;
  let i = 0;
  plans.forEach((plan, b) => {
    const seatStart = i;
    plan.rows.forEach((row, k) => {
      if (k % rowStride !== 0) return;
      for (let j = k % stride; j < row.seats.length; j += stride) {
        const seat = row.seats[j];
        positions[i * 3] = seat.p.x;
        positions[i * 3 + 1] = seat.p.y;
        positions[i * 3 + 2] = seat.p.z;
        yaw[i] = seat.yaw;
        blockIndex[i] = b;
        rowIndex[i] = k;
        if (own && own.plan === b && own.row === k && own.seat === j) ownSeatIndex = i;
        i++;
      }
    });
    blocks.push({ ...plan.block, highlighted: own?.plan === b, seatStart, seatCount: i - seatStart });
  });

  let ownSeat: OwnSeat3D | null = null;
  if (own) {
    const plan = plans[own.plan];
    const seat = plan.rows[own.row].seats[own.seat];
    const eye = { x: seat.p.x, y: seat.p.y + plan.eyeM, z: seat.p.z };
    // Aim a little above the stage deck (at the performers / screens), not at its floor.
    const lookAt = model.stage ? { ...model.stage.center, y: model.stage.center.y + model.stage.height * 2 } : { x: 0, y: 0, z: 0 };
    ownSeat = { blockIndex: own.plan, rowIndex: own.row, seatIndex: ownSeatIndex, position: seat.p, yaw: seat.yaw, eye, lookAt };
  }

  // Crowd: every kept floor-block seat (standing), ~70% of kept stand seats (seated), plus a
  // decorative standing crowd where the floor has no configured blocks. Never on the own seat
  // or its immediate neighbours, so the from-your-seat camera isn't inside a figure.
  const crowdPos: number[] = [];
  const crowdStanding: number[] = [];
  const ownPos = ownSeat?.position ?? null;
  for (let s = 0; s < count; s++) {
    const px = positions[s * 3];
    const py = positions[s * 3 + 1];
    const pz = positions[s * 3 + 2];
    if (ownPos && Math.hypot(px - ownPos.x, pz - ownPos.z) < SEAT_LAYOUT.ownSeatClearM && Math.abs(py - ownPos.y) < 0.3) continue;
    const isFloor = blocks[blockIndex[s]].kind === "floor";
    if (!isFloor && rand() > SEAT_LAYOUT.standCrowdShare) continue;
    crowdPos.push(px, py, pz);
    crowdStanding.push(isFloor ? 1 : 0);
  }
  const hasFloorBlocks = blocks.some((b) => b.kind === "floor");
  if (!hasFloorBlocks && layout !== "theatre") {
    const budget = Math.max(0, maxSeats - crowdStanding.length);
    let extra = decorativeFloorCrowd(frame, model.stage, layout === "bowl-centre-stage", rand, lines);
    if (extra.length > budget) {
      const step = extra.length / Math.max(budget, 1);
      extra = Array.from({ length: budget }, (_, k) => extra[Math.floor(k * step)]);
    }
    for (const p of extra) {
      crowdPos.push(p.x, p.y, p.z);
      crowdStanding.push(1);
    }
  }

  const hitLength = plans.reduce((sum, p) => sum + p.hit.length, 0);
  const hitPositions = new Float32Array(hitLength);
  const triangleBlock = new Uint16Array(hitLength / 9);
  let offset = 0;
  plans.forEach((p, b) => {
    hitPositions.set(p.hit, offset);
    triangleBlock.fill(b, offset / 9, (offset + p.hit.length) / 9);
    offset += p.hit.length;
  });

  return {
    count,
    totalGenerated,
    stride,
    rowStride,
    positions,
    yaw,
    blockIndex,
    rowIndex,
    blocks,
    crowd: { positions: new Float32Array(crowdPos), standing: new Uint8Array(crowdStanding), count: crowdStanding.length },
    floorLines: new Float32Array(lines),
    hitSurfaces: { positions: hitPositions, triangleBlock },
    ownSeat,
  };
}

/** Block + approximate row for a seat index — the hover tooltip text source. */
export function describeSeat(layout: SeatLayout3D, seatIndex: number): { block: SeatBlock3D; rowLabel: string } | null {
  if (seatIndex < 0 || seatIndex >= layout.count) return null;
  const block = layout.blocks[layout.blockIndex[seatIndex]];
  if (!block) return null;
  return { block, rowLabel: block.rowLabels[layout.rowIndex[seatIndex]] ?? "" };
}

/** Nearest sampled seat to a world point within one block (for block-surface hover hits). */
export function nearestSeatInBlock(layout: SeatLayout3D, blockIdx: number, point: Vec3): number | null {
  const block = layout.blocks[blockIdx];
  if (!block || block.seatCount === 0) return null;
  let best = block.seatStart;
  let bestD = Infinity;
  for (let s = block.seatStart; s < block.seatStart + block.seatCount; s++) {
    const d = (layout.positions[s * 3] - point.x) ** 2 + (layout.positions[s * 3 + 1] - point.y) ** 2 + (layout.positions[s * 3 + 2] - point.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

