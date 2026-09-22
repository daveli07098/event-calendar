import { describe, it, expect } from "vitest";
import { parseSeat } from "@/lib/seat-parse";
import { resolveSeatGeometry } from "@/lib/venue-seatmap/geometry";
import { pointAtDepth } from "@/lib/venue-seatmap/perimeter";
import { kaiTakStadium } from "@/lib/venue-seatmap/venues/kai-tak";
import { buildBowl3D, APPROXIMATE_BOWL, type Bowl3DModel } from "@/lib/venue-seatmap/bowl3d";
// Exercise the barrel export too, so a broken re-export would fail a test.
import { buildBowl3D as buildBowl3DFromBarrel } from "@/lib/venue-seatmap";

function fieldsFor(raw: string) {
  const result = parseSeat(raw);
  if (result.status === "unparseable") throw new Error(`expected ${raw} to parse`);
  return result.fields;
}

function geometryFor(raw: string, options?: Parameters<typeof resolveSeatGeometry>[2]) {
  const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor(raw), options);
  if (!geometry) throw new Error(`expected ${raw} to resolve`);
  return geometry;
}

/** Every triangle-list Float32Array must be a whole number of triangles (9 numbers each: 3
 * vertices x xyz) and contain only finite numbers — a NaN or an Infinity would silently break
 * any renderer consuming this. */
function assertValidTriangleList(positions: Float32Array) {
  expect(positions.length % 9).toBe(0);
  for (let i = 0; i < positions.length; i++) {
    expect(Number.isFinite(positions[i])).toBe(true);
  }
}

function slabYExtent(positions: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    min = Math.min(min, positions[i]);
    max = Math.max(max, positions[i]);
  }
  return { min, max };
}

function findSlab(model: Bowl3DModel, levelId: string) {
  const slab = model.slabs.find((s) => s.levelId === levelId);
  if (!slab) throw new Error(`expected a slab for ${levelId}`);
  return slab;
}

describe("buildBowl3D", () => {
  it("places the pitch and stage using APPROXIMATE_BOWL's metre constants", () => {
    const geometry = geometryFor("Level 5 Block 519B Row M Seat 1");
    const model = buildBowl3D(kaiTakStadium, geometry);

    expect(model.pitch).toEqual({ width: APPROXIMATE_BOWL.pitchWidthM, length: APPROXIMATE_BOWL.pitchLengthM });
    expect(model.stage).not.toBeNull();
    expect(model.stage!.height).toBeGreaterThan(0);
    expect(model.stage!.width).toBeGreaterThan(0);
    expect(model.stage!.depth).toBeGreaterThan(0);
    // Stage sits at the -z end per the exported contract.
    expect(model.stage!.center.z).toBeLessThan(0);
  });

  it("builds one slab per level SeatMap.tsx would draw (confirmed block-number ranges only)", () => {
    const expectedLevelIds = kaiTakStadium.levels
      .filter((level) => level.blockNumberRanges.some((r) => r.positionConfidence === "confirmed"))
      .map((level) => level.id);
    expect(expectedLevelIds).toEqual(["level-2", "level-5"]);

    const model = buildBowl3D(kaiTakStadium, null);
    expect(model.slabs.map((s) => s.levelId)).toEqual(expectedLevelIds);
    // The floor level has no confirmed range (only unnumbered zones) and must not appear.
    expect(model.slabs.find((s) => s.levelId === "floor")).toBeUndefined();
  });

  it("produces well-formed, finite triangle lists for every slab and the seat-block patch", () => {
    const geometry = geometryFor("Level 5 Block 519B Row M Seat 1");
    const model = buildBowl3D(kaiTakStadium, geometry);

    for (const slab of model.slabs) assertValidTriangleList(slab.positions);
    expect(model.seatBlock).not.toBeNull();
    assertValidTriangleList(model.seatBlock!);
  });

  it("rakes each slab upward (min < max) and stacks tiers outward (level-5 sits above level-2)", () => {
    const model = buildBowl3D(kaiTakStadium, null);
    const level2 = slabYExtent(findSlab(model, "level-2").positions);
    const level5 = slabYExtent(findSlab(model, "level-5").positions);

    expect(level2.min).toBeLessThan(level2.max);
    expect(level5.min).toBeLessThan(level5.max);
    // Level 5 (tier 2) is a materially higher tier than Level 2 (tier 1) — its whole band
    // sits above Level 2's entire band, never overlapping.
    expect(level5.min).toBeGreaterThan(level2.max);
  });

  it("gives a Level-5 seat a higher eye position than a Level-2 seat", () => {
    const level2 = buildBowl3D(kaiTakStadium, geometryFor("Level 2 Block 225 Row M Seat 1"));
    const level5 = buildBowl3D(kaiTakStadium, geometryFor("Level 5 Block 519B Row M Seat 1"));

    expect(level2.seat).not.toBeNull();
    expect(level5.seat).not.toBeNull();
    expect(level5.seat!.eye.y).toBeGreaterThan(level2.seat!.eye.y);
  });

  it("gives a seat further back (row QQ) a higher position than the same block's front row", () => {
    const rowA = buildBowl3D(kaiTakStadium, geometryFor("Level 5 Block 519 Row A Seat 1"));
    const rowQQ = buildBowl3D(kaiTakStadium, geometryFor("Level 5 Block 519 Row QQ Seat 1"));

    expect(rowA.seat).not.toBeNull();
    expect(rowQQ.seat).not.toBeNull();
    expect(rowQQ.seat!.position.y).toBeGreaterThan(rowA.seat!.position.y);
  });

  it("agrees with the 2D marker's x/z placement for a resolved seat", () => {
    const geometry = geometryFor("Level 5 Block 519B Row M Seat 1");
    const model = buildBowl3D(kaiTakStadium, geometry);

    const point2d = pointAtDepth(geometry.angleFraction!, geometry.depthFraction, APPROXIMATE_BOWL.planInner, APPROXIMATE_BOWL.planOuter);
    const expectedX = (point2d.x - APPROXIMATE_BOWL.planOuter.width / 2) * APPROXIMATE_BOWL.scaleX;
    const expectedZ = (APPROXIMATE_BOWL.planOuter.height / 2 - point2d.y) * APPROXIMATE_BOWL.scaleZ;

    expect(model.seat!.position.x).toBeCloseTo(expectedX, 6);
    expect(model.seat!.position.z).toBeCloseTo(expectedZ, 6);
  });

  it("places a seam block (501) toward the stage and an opposite block (520) away from it", () => {
    const seam = buildBowl3D(kaiTakStadium, geometryFor("Level 5 Block 501 Row M Seat 1"));
    const opposite = buildBowl3D(kaiTakStadium, geometryFor("Level 5 Block 520 Row M Seat 1"));

    expect(seam.seat!.position.z).toBeLessThan(0);
    expect(opposite.seat!.position.z).toBeGreaterThan(0);
  });

  it("returns null seat and seatBlock for a block with no confirmed arc position (101-110), while slabs still render", () => {
    const geometry = geometryFor("Level 2 Block 105 Row A Seat 1");
    expect(geometry.angleFraction).toBeNull();

    const model = buildBowl3D(kaiTakStadium, geometry);
    expect(model.seat).toBeNull();
    expect(model.seatBlock).toBeNull();
    expect(model.slabs.length).toBeGreaterThan(0);
    // The geometry's own hedge about the unconfirmed position must be carried through.
    expect(model.hedge.some((line) => line.includes("unconfirmed"))).toBe(true);
  });

  it("returns a null seat/seatBlock when there is no resolved geometry at all, while slabs and stage still render", () => {
    const model = buildBowl3D(kaiTakStadium, null);
    expect(model.seat).toBeNull();
    expect(model.seatBlock).toBeNull();
    expect(model.slabs.length).toBeGreaterThan(0);
    expect(model.stage).not.toBeNull(); // default layout assumed with no seat-specific info
  });

  it("always includes the approximation notice in hedge, even with no geometry", () => {
    const model = buildBowl3D(kaiTakStadium, null);
    expect(model.hedge).toContain(APPROXIMATE_BOWL.approximationNotice);
  });

  it("suppresses the stage (and lookAt falls back to pitch centre) for a non-default stage layout", () => {
    const geometry = geometryFor("Level 5 Block 519B Row M Seat 1", { stagePosition: "four-sided" });
    const model = buildBowl3D(kaiTakStadium, geometry);

    expect(model.stage).toBeNull();
    expect(model.seat).not.toBeNull();
    expect(model.seat!.lookAt).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("is re-exported from the lib barrel", () => {
    const model = buildBowl3DFromBarrel(kaiTakStadium, null);
    expect(model.slabs.length).toBeGreaterThan(0);
  });
});
