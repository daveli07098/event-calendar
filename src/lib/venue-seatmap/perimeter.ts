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
 */

export interface RectSize {
  width: number; // short (stage) edge
  height: number; // long (side) edge
}

export interface Point {
  x: number;
  y: number;
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

/** Interpolates between the point on an inner rect (`innerSize`, e.g. the pitch boundary) and
 * the point on an outer rect (`outerSize`, e.g. the bowl wall) at the same arc position `t`,
 * by `depthFraction` (0 = inner, 1 = outer). Both rects share a centre. */
export function pointAtDepth(t: number, depthFraction: number, innerSize: RectSize, outerSize: RectSize): Point {
  const innerCenter = { x: (outerSize.width - innerSize.width) / 2, y: (outerSize.height - innerSize.height) / 2 };
  const inner = pointOnPerimeter(t, innerSize);
  const outer = pointOnPerimeter(t, outerSize);
  const innerAbs = { x: inner.x + innerCenter.x, y: inner.y + innerCenter.y };
  const depth = Math.min(1, Math.max(0, depthFraction));
  return {
    x: innerAbs.x + (outer.x - innerAbs.x) * depth,
    y: innerAbs.y + (outer.y - innerAbs.y) * depth,
  };
}

/** Samples a band of the perimeter between `t0` and `t1` (both directions supported) at a
 * fixed depth, for drawing a level/block arc as an SVG polyline. */
export function sampleArc(t0: number, t1: number, depthFraction: number, innerSize: RectSize, outerSize: RectSize, steps = 16): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    points.push(pointAtDepth(t, depthFraction, innerSize, outerSize));
  }
  return points;
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
): string {
  const outerEdge = sampleArc(t0, t1, depthOuter, innerSize, outerSize, steps);
  const innerEdge = sampleArc(t1, t0, depthInner, innerSize, outerSize, steps);
  return `${pointsToPolylinePath(outerEdge)} L ${innerEdge.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`;
}
