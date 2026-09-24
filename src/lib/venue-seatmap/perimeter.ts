/**
 * Pure SVG-placement math for the procedural bowl renderer. Kept separate from geometry.ts:
 * this module only turns already-resolved fractions into 2D points, it makes no factual
 * claims about the venue.
 *
 * The bowl is modelled as a rounded rectangle (per the confirmed "four corner towers, not an
 * oval" shape) with the stage occupying one short edge. Seating wraps the other three edges
 * as a single continuous path, parameterised by `t` in [0,1):
 *   t=0            -> stage-adjacent corner (left)
 *   t=0.5          -> the far short edge, dead centre (directly opposite the stage)
 *   t->1           -> stage-adjacent corner (right)
 * `t` is arc-length-proportional across the three straight edges (corner rounding is applied
 * only for the visual outline, not for this parameterisation — a deliberate simplification
 * for a schematic, approximate renderer). `SeatGeometryFacts.angleFraction` maps directly
 * onto this `t` by construction: both put "opposite the stage" at exactly the midpoint,
 * regardless of the rectangle's aspect ratio.
 *
 * Centre-stage venues (`layout: "bowl-centre-stage"`) use a second, closed 4-sided loop
 * instead (`pointOnFullPerimeter`); every placement helper takes a `PerimeterKind` that
 * defaults to the 3-sided one above, so end-stage callers are unchanged.
 */

import type { SeatGeometryFacts, VenueSeatMapConfig } from "./types";
import { floorPositionFraction, isFloorLevel, layoutOf, locateBlock } from "./geometry";

export interface RectSize {
  width: number; // short (stage) edge
  height: number; // long (side) edge
}

/**
 * Plan-space bowl wall and pitch rects shared by the 2D SeatMap and the 3D bowl builder, so
 * the two views place every block and seat identically. Unitless drawing units, not metres.
 */
export const PLAN_OUTER: RectSize = { width: 220, height: 260 };
export const PLAN_INNER: RectSize = { width: 100, height: 150 }; // pitch boundary


export interface Point {
  x: number;
  y: number;
}

/** `"three-sided"`: the end-stage U (stage on the bottom edge, see `pointOnPerimeter`).
 * `"four-sided"`: a closed loop for centre-stage venues (see `pointOnFullPerimeter`). */
export type PerimeterKind = "three-sided" | "four-sided";

/** The plan rects for a venue: its own `plan` when drafted with one, else Kai Tak's. */
export function planRectsFor(config: VenueSeatMapConfig | null | undefined): { outer: RectSize; inner: RectSize } {
  return config?.plan ?? { outer: PLAN_OUTER, inner: PLAN_INNER };
}

export function perimeterKindFor(config: VenueSeatMapConfig | null | undefined): PerimeterKind {
  return config && layoutOf(config) === "bowl-centre-stage" ? "four-sided" : "three-sided";
}

/** Point on the 3-sided seating perimeter of a `width` x `height` rect whose 4th (bottom)
 * edge is the stage, for `t` in [0,1]. */
export function pointOnPerimeter(t: number, size: RectSize): Point {
  const { width, height } = size;
  const total = 2 * height + width;
  const t1 = height / total;
  const t2 = (height + width) / total;
  const clamped = Math.min(1, Math.max(0, t));

  if (clamped <= t1) {
    // Left edge, going up from the stage corner (y: height -> 0).
    const local = t1 === 0 ? 0 : clamped / t1;
    return { x: 0, y: height - local * height };
  }
  if (clamped <= t2) {
    // Far (top) edge, opposite the stage (x: 0 -> width).
    const local = (clamped - t1) / (t2 - t1);
    return { x: local * width, y: 0 };
  }
  // Right edge, going back down to the other stage corner (y: 0 -> height).
  const local = (clamped - t2) / (1 - t2);
  return { x: width, y: local * height };
}

/** Point on the full 4-sided perimeter of a `width` x `height` rect (centre-stage venues:
 * stands on every side), for `t` in [0,1], arc-length-proportional and clockwise:
 *   t=0 -> top-left corner, along the top edge (the far end), down the right side, back along
 *   the bottom edge, up the left side, and t=1 -> the top-left corner again. */
export function pointOnFullPerimeter(t: number, size: RectSize): Point {
  const { width, height } = size;
  const total = 2 * (width + height);
  const d = Math.min(1, Math.max(0, t)) * total;
  if (d <= width) return { x: d, y: 0 };
  if (d <= width + height) return { x: width, y: d - width };
  if (d <= 2 * width + height) return { x: width - (d - width - height), y: height };
  return { x: 0, y: height - (d - 2 * width - height) };
}

/** Corner `t` values of the 4-sided loop for a rect, so sampled bands keep square corners
 * instead of chamfering across them. */
function fullPerimeterCorners(size: RectSize): number[] {
  const total = 2 * (size.width + size.height);
  return [size.width / total, (size.width + size.height) / total, (2 * size.width + size.height) / total];
}

function perimeterPoint(t: number, size: RectSize, kind: PerimeterKind): Point {
  return kind === "four-sided" ? pointOnFullPerimeter(t, size) : pointOnPerimeter(t, size);
}

/** Interpolates between the point on an inner rect (`innerSize`, e.g. the pitch boundary) and
 * the point on an outer rect (`outerSize`, e.g. the bowl wall) at the same arc position `t`,
 * by `depthFraction` (0 = inner, 1 = outer). Both rects share a centre. */
export function pointAtDepth(
  t: number,
  depthFraction: number,
  innerSize: RectSize,
  outerSize: RectSize,
  kind: PerimeterKind = "three-sided",
): Point {
  const innerCenter = { x: (outerSize.width - innerSize.width) / 2, y: (outerSize.height - innerSize.height) / 2 };
  const inner = perimeterPoint(t, innerSize, kind);
  const outer = perimeterPoint(t, outerSize, kind);
  const innerAbs = { x: inner.x + innerCenter.x, y: inner.y + innerCenter.y };
  const depth = Math.min(1, Math.max(0, depthFraction));
  return {
    x: innerAbs.x + (outer.x - innerAbs.x) * depth,
    y: innerAbs.y + (outer.y - innerAbs.y) * depth,
  };
}

/** Samples a band of the perimeter between `t0` and `t1` (both directions supported) at a
 * fixed depth, for drawing a level/block arc as an SVG polyline. */
export function sampleArc(
  t0: number,
  t1: number,
  depthFraction: number,
  innerSize: RectSize,
  outerSize: RectSize,
  steps = 16,
  kind: PerimeterKind = "three-sided",
): Point[] {
  return arcSamples(t0, t1, innerSize, outerSize, steps, kind).map((t) => pointAtDepth(t, depthFraction, innerSize, outerSize, kind));
}

/** The `t` values `sampleArc` samples at: `steps` even steps, plus (four-sided only) the inner
 * and outer rects' corner positions inside the span so corners stay square. Exported so the
 * 3D builder can sample inner and outer edges at identical `t`s. */
export function arcSamples(t0: number, t1: number, innerSize: RectSize, outerSize: RectSize, steps: number, kind: PerimeterKind): number[] {
  const ts: number[] = [];
  for (let i = 0; i <= steps; i++) ts.push(t0 + ((t1 - t0) * i) / steps);
  if (kind === "three-sided") return ts;
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  for (const c of [...fullPerimeterCorners(innerSize), ...fullPerimeterCorners(outerSize)]) {
    if (c > lo && c < hi) ts.push(c);
  }
  return ts.sort((a, b) => (t1 >= t0 ? a - b : b - a));
}

export function pointsToPolylinePath(points: Point[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

/** Builds a closed band polygon (e.g. one level's ring, or one block's highlighted slice)
 * spanning `t0..t1` between `depthInner` and `depthOuter`. */
export function bandPath(
  t0: number,
  t1: number,
  depthInner: number,
  depthOuter: number,
  innerSize: RectSize,
  outerSize: RectSize,
  steps = 16,
  kind: PerimeterKind = "three-sided",
): string {
  const outerEdge = sampleArc(t0, t1, depthOuter, innerSize, outerSize, steps, kind);
  const innerEdge = sampleArc(t1, t0, depthInner, innerSize, outerSize, steps, kind);
  return `${pointsToPolylinePath(outerEdge)} L ${innerEdge.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`;
}

/** A full closed ring (four-sided loop, `t` 0..1) between two depths, as two closed subpaths
 * — draw with `fill-rule="evenodd"`. Unlike `bandPath` over 0..1 it has no seam line joining
 * the outer and inner edges. */
export function ringPath(depthInner: number, depthOuter: number, innerSize: RectSize, outerSize: RectSize, steps = 64): string {
  const outerEdge = sampleArc(0, 1, depthOuter, innerSize, outerSize, steps, "four-sided");
  const innerEdge = sampleArc(1, 0, depthInner, innerSize, outerSize, steps, "four-sided");
  return `${pointsToPolylinePath(outerEdge)} Z ${pointsToPolylinePath(innerEdge)} Z`;
}

// ---- Layout-aware placement (shared by SeatMap.tsx and bowl3d.ts) ----------------

/** A floor level's depth band `index` of `count` (front = nearest the stage) as a plan-space
 * rect inside the inner (floor) rect. End-stage only: the stage sits on the bottom edge, so
 * band 0 hugs the bottom and later bands stack upward (away from the stage). */
export function floorBandRect(index: number, count: number, innerSize: RectSize, outerSize: RectSize): { x: number; y: number; width: number; height: number } {
  const left = (outerSize.width - innerSize.width) / 2;
  const top = (outerSize.height - innerSize.height) / 2;
  const bandHeight = innerSize.height / Math.max(count, 1);
  const bottom = top + innerSize.height - index * bandHeight;
  return { x: left, y: bottom - bandHeight, width: innerSize.width, height: bandHeight };
}

/**
 * The plan-space point (unpadded, same space as `pointAtDepth`) for a resolved seat, per the
 * venue's layout: stand seats sit on the perimeter at their block's arc position and
 * `depthFraction`; floor seats sit on the floor's centre line at their front-to-back position.
 * `null` whenever the geometry carries no position (`angleFraction` null) — never a guess.
 */
export function seatPlanPoint(config: VenueSeatMapConfig, geometry: SeatGeometryFacts): Point | null {
  if (geometry.angleFraction === null) return null;
  const { outer, inner } = planRectsFor(config);
  const located = locateBlock(config, geometry.block);
  if (located && isFloorLevel(located.level)) {
    const position = floorPositionFraction(located.index, located.count, geometry.rowDepthFraction);
    const top = (outer.height - inner.height) / 2;
    return { x: outer.width / 2, y: top + inner.height - position * inner.height };
  }
  return pointAtDepth(geometry.angleFraction, geometry.depthFraction, inner, outer, perimeterKindFor(config));
}
