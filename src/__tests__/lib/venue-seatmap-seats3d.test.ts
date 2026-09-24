import { describe, it, expect } from "vitest";
import { parseSeat } from "@/lib/seat-parse";
import { resolveSeatGeometry } from "@/lib/venue-seatmap/geometry";
import { kaiTakStadium } from "@/lib/venue-seatmap/venues/kai-tak";
import { buildBowl3D, frameFor, tierHeights } from "@/lib/venue-seatmap/bowl3d";
import { buildSeatLayout3D, describeSeat, nearestSeatInBlock, SEAT_DENSITY } from "@/lib/venue-seatmap/seats3d";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";
import type { SeatParseResult } from "@/lib/seat-parse";
import { aweLikeArena, coliseumLike, seatWith, theatreLike } from "./venue-seatmap-layout-fixtures";
import { asiaWorldExpoArena, hongKongColiseum, macphersonStadium } from "../../../scripts/data/venue-seatmap-drafts";

function layoutFor(config: VenueSeatMapConfig, seat: SeatParseResult | null, maxSeats?: number) {
  const geometry = seat && seat.status !== "unparseable" ? resolveSeatGeometry(config, seat.fields) : null;
  const model = buildBowl3D(config, geometry);
  return { layout: buildSeatLayout3D(config, geometry, model, { maxSeats }), model, geometry };
}

const KT_225 = parseSeat("Gate F Level 2 Block 225 Row BB Seat 101");

describe("buildSeatLayout3D — Kai Tak", () => {
  const { layout } = layoutFor(kaiTakStadium, KT_225, 1_000_000);

  it("generates seats for every confirmed block (201-240, 501-540) and none for 101-110", () => {
    const labels = layout.blocks.map((b) => b.label);
    expect(labels).toHaveLength(80);
    for (let n = 201; n <= 240; n++) expect(labels).toContain(String(n));
    for (let n = 501; n <= 540; n++) expect(labels).toContain(String(n));
    for (let n = 101; n <= 110; n++) expect(labels).not.toContain(String(n));
    // Seam blocks (201/240, 501/540) are clamped to half a block's arc, so they're smaller.
    expect(Math.min(...layout.blocks.map((b) => b.seatCount))).toBeGreaterThan(20);
    expect(layout.blocks.find((b) => b.label === "520")!.seatCount).toBeGreaterThan(200);
    // Plausible stadium-scale totals (schematic, not a documented capacity).
    expect(layout.totalGenerated).toBeGreaterThan(15000);
    expect(layout.totalGenerated).toBeLessThan(60000);
    expect(layout.stride).toBe(1);
    expect(layout.count).toBe(layout.totalGenerated);
  });

  it("keeps every seat within its level's height band and rakes rows upward front to back", () => {
    const frame = frameFor(kaiTakStadium);
    for (const block of layout.blocks) {
      const level = kaiTakStadium.levels.find((l) => l.id === block.levelId)!;
      const { baseM, riseM } = tierHeights(level.tier, frame);
      const rowY: number[] = [];
      let outOfBand = 0;
      for (let s = block.seatStart; s < block.seatStart + block.seatCount; s++) {
        const y = layout.positions[s * 3 + 1];
        if (y < baseM - 1e-6 || y > baseM + riseM + 1e-6) outOfBand++;
        rowY[layout.rowIndex[s]] = y;
      }
      expect(outOfBand).toBe(0);
      const ys = rowY.filter((y) => y !== undefined);
      expect(ys.every((y, k) => k === 0 || y > ys[k - 1])).toBe(true);
    }
  });

  it("keeps a walkway between Level 5's lower (A-M) and upper (AA-QQ) banks", () => {
    const block = layout.blocks.find((b) => b.label === "520")!;
    expect(block.rowLabels[0]).toBe("A");
    expect(block.rowLabels[block.rowLabels.length - 1]).toBe("QQ");
    expect(block.rowLabels).toContain("M");
    expect(block.rowLabels).toContain("AA");
    const ys: number[] = [];
    for (let s = block.seatStart; s < block.seatStart + block.seatCount; s++) ys[layout.rowIndex[s]] = layout.positions[s * 3 + 1];
    const steps = ys.slice(1).map((y, k) => y - ys[k]);
    const typical = steps.slice().sort((a, b) => a - b)[Math.floor(steps.length / 2)];
    expect(Math.max(...steps)).toBeGreaterThan(typical * 3); // the walkway gap
  });

  it("resolves the own seat into block 225, at its nearest row, and gives it an eye above the seat", () => {
    const own = layout.ownSeat!;
    expect(own).not.toBeNull();
    const block = layout.blocks[own.blockIndex];
    expect(block.label).toBe("225");
    expect(block.highlighted).toBe(true);
    // Generated rows are coarser than the documented A..QQ sequence, so the nearest generated
    // row carries a neighbouring label at worst.
    expect(["AA", "BB", "CC"]).toContain(block.rowLabels[own.rowIndex]);
    expect(own.seatIndex).not.toBeNull();
    expect(describeSeat(layout, own.seatIndex!)?.block.label).toBe("225");
    expect(own.eye.y).toBeGreaterThan(own.position.y);
    expect(layout.blocks.filter((b) => b.highlighted)).toHaveLength(1);
  });

  it("puts a front row lower than a back row of the same block (row A vs QQ on Level 5)", () => {
    const front = layoutFor(kaiTakStadium, parseSeat("Level 5 Block 520 Row A Seat 1"), 1_000_000).layout.ownSeat!;
    const back = layoutFor(kaiTakStadium, parseSeat("Level 5 Block 520 Row QQ Seat 1"), 1_000_000).layout.ownSeat!;
    expect(back.position.y).toBeGreaterThan(front.position.y);
  });

  it("gives an unconfirmed block (105) no own seat while the rest of the bowl still has seats", () => {
    const { layout: unconfirmed } = layoutFor(kaiTakStadium, parseSeat("Level 2 Block 105 Row A Seat 1"));
    expect(unconfirmed.ownSeat).toBeNull();
    expect(unconfirmed.blocks.some((b) => b.highlighted)).toBe(false);
    expect(unconfirmed.count).toBeGreaterThan(0);
  });

  it("samples every Nth seat per row under a cap, keeping every row and the venue's extent", () => {
    const capped = layoutFor(kaiTakStadium, KT_225, SEAT_DENSITY.mobile).layout;
    expect(capped.count).toBeLessThanOrEqual(SEAT_DENSITY.mobile);
    expect(capped.stride).toBeGreaterThan(1);
    expect(capped.totalGenerated).toBe(layout.totalGenerated);
    const rowsPerBlock = (l: typeof layout, label: string) => {
      const b = l.blocks.find((x) => x.label === label)!;
      return new Set(Array.from(l.rowIndex.subarray(b.seatStart, b.seatStart + b.seatCount))).size;
    };
    expect(rowsPerBlock(capped, "520")).toBe(rowsPerBlock(layout, "520"));
    const extent = (l: typeof layout) => {
      let max = 0;
      for (let s = 0; s < l.count; s++) max = Math.max(max, Math.abs(l.positions[s * 3]));
      return max;
    };
    expect(extent(capped)).toBeGreaterThan(extent(layout) * 0.97);
    // The own seat is still resolved even if sampling dropped its instance.
    expect(capped.ownSeat?.blockIndex).toBe(capped.blocks.findIndex((b) => b.label === "225"));

    expect(capped.rowStride).toBe(1);

    // A cap below one seat per row still terminates, thinning rows only as a last resort.
    const tiny = layoutFor(kaiTakStadium, KT_225, 1000).layout;
    expect(tiny.count).toBeLessThanOrEqual(1000);
    expect(tiny.count).toBeGreaterThan(0);
    expect(tiny.rowStride).toBeGreaterThan(1);
  });

  it("adds a decorative standing crowd on the unblocked floor plus ~70% of stand seats, none on the own seat", () => {
    const standing = layout.crowd.standing.reduce((a, b) => a + b, 0);
    const seated = layout.crowd.count - standing;
    expect(standing).toBeGreaterThan(1000);
    expect(seated / layout.count).toBeGreaterThan(0.6);
    expect(seated / layout.count).toBeLessThan(0.8);
    const own = layout.ownSeat!.position;
    let onOwnSeat = 0;
    for (let c = 0; c < layout.crowd.count; c++) {
      const d = Math.hypot(layout.crowd.positions[c * 3] - own.x, layout.crowd.positions[c * 3 + 2] - own.z);
      const dy = Math.abs(layout.crowd.positions[c * 3 + 1] - own.y);
      if (d < 0.6 && dy < 0.3) onOwnSeat++;
    }
    expect(onOwnSeat).toBe(0);
  });

  it("maps a point to the nearest seat within a block", () => {
    const b = layout.blocks.findIndex((x) => x.label === "225");
    const own = layout.ownSeat!;
    expect(nearestSeatInBlock(layout, b, own.position)).toBe(own.seatIndex);
  });
});

describe("buildSeatLayout3D — other layouts", () => {
  it("fills AWE-like floor blocks A-D with flat seats inside the floor, rows running away from the stage", () => {
    const { layout, model } = layoutFor(aweLikeArena, seatWith("B", "12"));
    const floor = layout.blocks.filter((b) => b.kind === "floor");
    expect(floor.map((b) => b.label)).toEqual(["A", "B", "C", "D"]);
    let outside = 0;
    for (const block of floor) {
      for (let s = block.seatStart; s < block.seatStart + block.seatCount; s++) {
        if (
          layout.positions[s * 3 + 1] >= 0.2 ||
          Math.abs(layout.positions[s * 3]) > model.pitch.width / 2 ||
          Math.abs(layout.positions[s * 3 + 2]) > model.pitch.length / 2
        ) outside++;
      }
    }
    expect(outside).toBe(0);
    const meanZ = (label: string) => {
      const b = floor.find((x) => x.label === label)!;
      let sum = 0;
      for (let s = b.seatStart; s < b.seatStart + b.seatCount; s++) sum += layout.positions[s * 3 + 2];
      return sum / b.seatCount;
    };
    expect(meanZ("A")).toBeLessThan(meanZ("D")); // A nearest the stage (-z)
    expect(layout.blocks[layout.ownSeat!.blockIndex].label).toBe("B");
    expect(layout.floorLines.length % 6).toBe(0);
    expect(layout.floorLines.length).toBeGreaterThan(0);
    // Balcony blocks 1-17 are stand blocks.
    expect(layout.blocks.filter((b) => b.kind === "stand")).toHaveLength(17);
  });

  it("wraps centre-stage aisle blocks 40-79 all the way round and resolves the own seat", () => {
    const { layout } = layoutFor(coliseumLike, seatWith("62", "K"));
    expect(layout.blocks).toHaveLength(40);
    expect(layout.blocks[layout.ownSeat!.blockIndex].label).toBe("62");
    // Seats on all four sides of the origin.
    const q = [false, false, false, false];
    for (let s = 0; s < layout.count; s++) {
      const x = layout.positions[s * 3];
      const z = layout.positions[s * 3 + 2];
      if (x > 25) q[0] = true;
      if (x < -25) q[1] = true;
      if (z > 25) q[2] = true;
      if (z < -25) q[3] = true;
    }
    expect(q).toEqual([true, true, true, true]);
  });

  it("builds an empty layout for a theatre (not projected)", () => {
    const { layout } = layoutFor(theatreLike, seatWith("Centre", "F"));
    expect(layout.count).toBe(0);
    expect(layout.blocks).toHaveLength(0);
    expect(layout.crowd.count).toBe(0);
    expect(layout.ownSeat).toBeNull();
  });
});

describe("buildSeatLayout3D — drafted real-venue configs", () => {
  it("lays out the wide Macpherson plan (stage on a long side) with a front-row-AA floor", () => {
    const { layout, model } = layoutFor(macphersonStadium, seatWith("Floor", "AA"));
    expect(layout.blocks.map((b) => b.label)).toEqual(["Floor", "8", "9", "10", "11", "12", "1", "2"]);
    const floor = layout.blocks[0];
    // Rows span the level's own documented sequence, AA (front) to SS (back).
    expect(floor.rowLabels[0]).toBe("AA");
    expect(floor.rowLabels[floor.rowLabels.length - 1]).toBe("SS");
    const own = layout.ownSeat!;
    expect(layout.blocks[own.blockIndex].label).toBe("Floor");
    expect(own.rowIndex).toBe(0);
    // Front row sits nearest the stage (-z).
    expect(own.position.z).toBeLessThan(0);
    expect(model.stage!.center.z).toBeLessThan(own.position.z);
    expect(layout.blocks.slice(1).every((b) => b.seatCount > 0)).toBe(true);
  });

  it("lays out the drafted AWE Arena and Coliseum with their own row sequences", () => {
    const awe = layoutFor(asiaWorldExpoArena, seatWith("9", "F")).layout;
    expect(awe.blocks.filter((b) => b.kind === "floor").map((b) => b.label)).toEqual(["A", "B", "C", "D"]);
    const balcony = awe.blocks[awe.ownSeat!.blockIndex];
    expect(balcony.label).toBe("9");
    // A-Z skipping I/O: no generated row is labelled with a skipped letter.
    expect(balcony.rowLabels).not.toContain("I");
    expect(balcony.rowLabels).not.toContain("O");
    expect(balcony.rowLabels[0]).toBe("A");

    const coliseum = layoutFor(hongKongColiseum, seatWith("62", "20")).layout;
    expect(coliseum.blocks).toHaveLength(40);
    const block = coliseum.blocks[coliseum.ownSeat!.blockIndex];
    expect(block.label).toBe("62");
    expect(block.rowLabels[0]).toBe("AA");
    expect(block.rowLabels[block.rowLabels.length - 1]).toBe("20");
    expect(coliseum.ownSeat!.rowIndex).toBe(block.rowLabels.length - 1);
    // Floor has no fixed blocks: only a decorative standing crowd, no floor seats.
    expect(coliseum.blocks.some((b) => b.kind === "floor")).toBe(false);
    expect(coliseum.crowd.standing.some((v) => v === 1)).toBe(true);
  });
});
