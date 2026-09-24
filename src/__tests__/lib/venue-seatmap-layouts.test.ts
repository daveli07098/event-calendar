import { describe, it, expect } from "vitest";
import { resolveSeatGeometry, THEATRE_HEDGE } from "@/lib/venue-seatmap/geometry";
import { buildBowl3D, APPROXIMATE_BOWL, type Vec3 } from "@/lib/venue-seatmap/bowl3d";
import { pointOnFullPerimeter, seatPlanPoint } from "@/lib/venue-seatmap/perimeter";
import { configForVenue, matchVenueConfig } from "@/lib/venue-seatmap/registry";
import { kaiTakStadium } from "@/lib/venue-seatmap/venues/kai-tak";
import { aweLikeArena, coliseumLike, fieldsWith, theatreLike } from "./venue-seatmap-layout-fixtures";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";

function resolve(config: VenueSeatMapConfig, block: string, row?: string) {
  const geometry = resolveSeatGeometry(config, fieldsWith(block, row));
  if (!geometry) throw new Error(`expected block ${block} to resolve`);
  return geometry;
}

function planDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe("end-stage arena with a lettered floor (AWE-like)", () => {
  it("resolves label blocks case-insensitively with a null blockNumeric", () => {
    const geometry = resolve(aweLikeArena, "b", "C");
    expect(geometry.levelId).toBe("floor");
    expect(geometry.blockNumeric).toBeNull();
    expect(geometry.blockSuffix).toBeNull();
    expect(geometry.angleFraction).toBe(0.5); // straight out from the stage
    expect(geometry.viewingAngle).toBe("front-on");
    expect(geometry.isDocumentedBestFacing).toBe(false); // estimated, not documented
  });

  it("places floor block A closer to the stage than block D (resolver, 2D and 3D)", () => {
    const a = resolve(aweLikeArena, "A", "5");
    const d = resolve(aweLikeArena, "D", "5");
    expect(a.depthFraction).toBeLessThan(d.depthFraction);

    // 2D: stage is the bottom edge (larger y), so A sits lower on the plan than D.
    const pa = seatPlanPoint(aweLikeArena, a)!;
    const pd = seatPlanPoint(aweLikeArena, d)!;
    expect(pa.y).toBeGreaterThan(pd.y);
    expect(pa.x).toBeCloseTo(aweLikeArena.plan!.outer.width / 2); // on the stage's centre line

    const modelA = buildBowl3D(aweLikeArena, a);
    const modelD = buildBowl3D(aweLikeArena, d);
    expect(modelA.stage).not.toBeNull();
    expect(planDistance(modelA.seat!.position, modelA.stage!.center)).toBeLessThan(
      planDistance(modelD.seat!.position, modelD.stage!.center),
    );
    expect(modelA.seat!.position.y).toBe(0); // floor seats stand on the floor
  });

  it("orders numeric floor rows front to back and hedges the assumed row count", () => {
    const front = resolve(aweLikeArena, "B", "2");
    const back = resolve(aweLikeArena, "B", "25");
    expect(front.rowDepthFraction).not.toBeNull();
    expect(back.rowDepthFraction!).toBeGreaterThan(front.rowDepthFraction!);
    expect(back.depthFraction).toBeGreaterThan(front.depthFraction);
    expect(back.hedge.some((line) => line.includes("about 30 rows"))).toBe(true);
  });

  it("builds flat floor blocks A-D with only the seat's block highlighted, plus a balcony slab", () => {
    const model = buildBowl3D(aweLikeArena, resolve(aweLikeArena, "C"));
    expect(model.floorBlocks.map((b) => b.label)).toEqual(["A", "B", "C", "D"]);
    expect(model.floorBlocks.filter((b) => b.highlighted).map((b) => b.label)).toEqual(["C"]);
    for (const block of model.floorBlocks) {
      expect(block.positions.length % 9).toBe(0);
      for (let i = 1; i < block.positions.length; i += 3) expect(block.positions[i]).toBeLessThan(0.5);
    }
    expect(model.seatBlock).not.toBeNull();
    expect(model.slabs.map((s) => s.levelId)).toEqual(["balcony"]); // the floor isn't a raked slab
    expect(model.pitch).toEqual({ width: 45, length: 60 }); // approxFloorM honoured
  });

  it("puts balcony blocks 1 and 17 at the stage ends and 9 opposite the stage", () => {
    const b1 = resolve(aweLikeArena, "1", "A");
    const b9 = resolve(aweLikeArena, "9", "A");
    const b17 = resolve(aweLikeArena, "17", "A");
    expect(b1.angleFraction).toBe(0);
    expect(b9.angleFraction).toBe(0.5);
    expect(b17.angleFraction).toBe(1);
    expect(b9.viewingAngle).toBe("front-on");
    expect(b1.viewingAngle).toBe("side-on");
    expect(b17.viewingAngle).toBe("side-on");
    expect(b9.hedge.some((line) => line.includes("estimated from the block's position"))).toBe(true);

    const m1 = buildBowl3D(aweLikeArena, b1);
    const m9 = buildBowl3D(aweLikeArena, b9);
    const m17 = buildBowl3D(aweLikeArena, b17);
    // Stage end is -z: 1 and 17 flank it on opposite sides, 9 is at the far (+z) end.
    expect(m1.seat!.position.z).toBeLessThan(0);
    expect(m17.seat!.position.z).toBeLessThan(0);
    expect(Math.sign(m1.seat!.position.x)).toBe(-Math.sign(m17.seat!.position.x));
    expect(m9.seat!.position.z).toBeGreaterThan(0);
    expect(Math.abs(m9.seat!.position.x)).toBeLessThan(1);
    expect(planDistance(m9.seat!.position, m9.stage!.center)).toBeGreaterThan(
      planDistance(m1.seat!.position, m1.stage!.center),
    );
  });

  it("returns null for a label that isn't configured, never a guess", () => {
    expect(resolveSeatGeometry(aweLikeArena, fieldsWith("E"))).toBeNull();
    expect(resolveSeatGeometry(aweLikeArena, fieldsWith("18"))).toBeNull();
  });
});

describe("centre-stage bowl (Coliseum-like)", () => {
  it("resolves every aisle block 40-79 with an angle, front-on, around all four sides", () => {
    const sides = { north: 0, south: 0, east: 0, west: 0 };
    for (let block = 40; block <= 79; block++) {
      const geometry = resolve(coliseumLike, String(block), "M");
      expect(geometry.angleFraction).not.toBeNull();
      expect(geometry.angleFraction!).toBeGreaterThan(0);
      expect(geometry.angleFraction!).toBeLessThan(1);
      expect(geometry.viewingAngle).toBe("front-on");
      expect(geometry.hedge.some((line) => line.includes("In-the-round"))).toBe(true);

      const seat = buildBowl3D(coliseumLike, geometry).seat!;
      expect(seat).not.toBeNull();
      if (Math.abs(seat.position.z) > Math.abs(seat.position.x)) {
        if (seat.position.z > 0) sides.north += 1;
        else sides.south += 1;
      } else if (seat.position.x > 0) sides.east += 1;
      else sides.west += 1;
    }
    expect(Object.values(sides).every((count) => count >= 6)).toBe(true);
  });

  it("measures distance radially, independent of which side the block is on", () => {
    const a = resolve(coliseumLike, "45", "C");
    const b = resolve(coliseumLike, "65", "C");
    expect(a.depthFraction).toBeCloseTo(b.depthFraction, 10);
  });

  it("puts the stage box at the origin and closes the stand slab all the way round", () => {
    const model = buildBowl3D(coliseumLike, resolve(coliseumLike, "50"));
    expect(model.stage).not.toBeNull();
    expect(model.stage!.center.x).toBeCloseTo(0);
    expect(model.stage!.center.z).toBeCloseTo(0);
    expect(model.seat!.lookAt).toEqual(model.stage!.center);

    const slab = model.slabs[0];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < slab.positions.length; i += 3) {
      minX = Math.min(minX, slab.positions[i]);
      maxX = Math.max(maxX, slab.positions[i]);
      minZ = Math.min(minZ, slab.positions[i + 2]);
      maxZ = Math.max(maxZ, slab.positions[i + 2]);
    }
    // Stands on all four sides: symmetric about the origin in both axes.
    expect(minX).toBeCloseTo(-maxX, 3);
    expect(minZ).toBeCloseTo(-maxZ, 3);
    for (let i = 0; i < slab.positions.length; i++) expect(Number.isFinite(slab.positions[i])).toBe(true);
  });

  it("walks the full 4-sided perimeter clockwise from the top-left corner", () => {
    const size = { width: 100, height: 60 };
    expect(pointOnFullPerimeter(0, size)).toEqual({ x: 0, y: 0 });
    expect(pointOnFullPerimeter(0.5, size)).toEqual({ x: 100, y: 60 });
    expect(pointOnFullPerimeter(1, size)).toEqual({ x: 0, y: 0 });
    expect(pointOnFullPerimeter(100 / 320, size)).toEqual({ x: 100, y: 0 });
  });
});

describe("theatre layout", () => {
  it("resolves the block but never a position, with the theatre hedge", () => {
    const geometry = resolve(theatreLike, "Centre", "F");
    expect(geometry.levelId).toBe("stalls");
    expect(geometry.angleFraction).toBeNull();
    expect(geometry.viewingAngle).toBeNull();
    expect(geometry.hedge).toContain(THEATRE_HEDGE);
  });

  it("builds a 3D model with no stands, stage or seat, carrying the hedge once", () => {
    const withSeat = buildBowl3D(theatreLike, resolve(theatreLike, "Left"));
    const withoutSeat = buildBowl3D(theatreLike, null);
    for (const model of [withSeat, withoutSeat]) {
      expect(model.slabs).toEqual([]);
      expect(model.floorBlocks).toEqual([]);
      expect(model.seat).toBeNull();
      expect(model.seatBlock).toBeNull();
      expect(model.stage).toBeNull();
      expect(model.hedge.filter((line) => line === THEATRE_HEDGE)).toHaveLength(1);
    }
  });
});

describe("Kai Tak defaults are untouched by the layout work", () => {
  it("keeps the default footprint/pitch and draws no floor blocks", () => {
    const model = buildBowl3D(kaiTakStadium, null);
    expect(model.pitch).toEqual({ width: APPROXIMATE_BOWL.pitchWidthM, length: APPROXIMATE_BOWL.pitchLengthM });
    expect(model.footprint.width).toBeCloseTo(APPROXIMATE_BOWL.planOuter.width * APPROXIMATE_BOWL.scaleX);
    expect(model.footprint.length).toBeCloseTo(APPROXIMATE_BOWL.planOuter.height * APPROXIMATE_BOWL.scaleZ);
    expect(model.floorBlocks).toEqual([]);
  });
});

describe("registry with runtime configs", () => {
  it("matches extra configs by alias, falling back to their name", () => {
    expect(matchVenueConfig("Test Expo Arena, Lantau", [coliseumLike, aweLikeArena])?.id).toBe("test-awe-arena");
    const nameOnly = { ...coliseumLike, aliases: [] };
    expect(matchVenueConfig("the test coliseum, Hung Hom", [nameOnly])?.id).toBe("test-coliseum");
    expect(matchVenueConfig("Test Expo Arena")).toBeNull(); // no extras -> static registry only
  });

  it("always prefers the static registry (Kai Tak wins over a runtime look-alike)", () => {
    const impostor = { ...aweLikeArena, id: "impostor", aliases: ["Kai Tak Stadium"] };
    expect(matchVenueConfig("Kai Tak Stadium", [impostor])?.id).toBe("kai-tak-stadium");
    expect(matchVenueConfig("Kai Tak Cruise Terminal", [impostor])).toBeNull();
  });

  it("uses an explicit config ahead of name matching", () => {
    expect(configForVenue("Kai Tak Stadium", coliseumLike)?.id).toBe("test-coliseum");
    expect(configForVenue("Kai Tak Stadium", null)?.id).toBe("kai-tak-stadium");
  });
});
