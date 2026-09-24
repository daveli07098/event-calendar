/**
 * Tests for the two row-depth gaps found while drafting real venue configs (see project
 * brief): numeric rows resolving on `"stand"` levels, not just `"floor"` ones, and per-level
 * `LevelConfig.rowSequence` (with its documented precedence against `rowBankSplit`).
 */
import { describe, it, expect } from "vitest";
import { parseSeat } from "@/lib/seat-parse";
import { resolveSeatGeometry } from "@/lib/venue-seatmap/geometry";
import { sequenceRowDepthFraction } from "@/lib/venue-seatmap/rows";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";
import { kaiTakStadium } from "@/lib/venue-seatmap/venues/kai-tak";
import { coliseumLike, fieldsWith, standWithRowSchemes } from "./venue-seatmap-layout-fixtures";

function fieldsFor(raw: string) {
  const result = parseSeat(raw);
  if (result.status === "unparseable") throw new Error(`expected ${raw} to parse`);
  return result.fields;
}

function resolve(config: VenueSeatMapConfig, block: string, row?: string) {
  const geometry = resolveSeatGeometry(config, fieldsWith(block, row));
  if (!geometry) throw new Error(`expected block ${block} to resolve`);
  return geometry;
}

describe("numeric rows on stand levels (point 1)", () => {
  it("resolves a numeric row on a stand level (Coliseum-like, no documented scheme), hedged as approximate", () => {
    const front = resolve(coliseumLike, "45", "2");
    const back = resolve(coliseumLike, "45", "18");
    expect(front.rowDepthFraction).not.toBeNull();
    expect(back.rowDepthFraction).not.toBeNull();
    expect(back.rowDepthFraction!).toBeGreaterThan(front.rowDepthFraction!);
    expect(front.hedge.some((line) => line.includes("about 30 rows"))).toBe(true);
  });

  it("still yields no depth for a numeric row on a level with a documented rowBankSplit (Kai Tak Level 5) — a bank split IS a documented scheme", () => {
    const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 5 Block 519 Row 5 Seat 1"));
    expect(geometry).not.toBeNull();
    expect(geometry?.rowDepthFraction).toBeNull();
    expect(geometry?.hedge.some((line) => line.includes("documented row set"))).toBe(true);
    expect(geometry?.hedge.some((line) => line.includes("about 30 rows"))).toBe(false);
  });
});

describe("LevelConfig.rowSequence (point 2)", () => {
  it("orders a sequence-only level's rows by their index (AA front, 5 back)", () => {
    const front = resolve(standWithRowSchemes, "1", "AA");
    const back = resolve(standWithRowSchemes, "1", "5");
    expect(front.rowDepthFraction).toBe(0);
    expect(back.rowDepthFraction).toBe(1);
    expect(back.rowDepthFraction!).toBeGreaterThan(front.rowDepthFraction!);
  });

  it("hedges a row outside the documented rowSequence as unknown, without falling back to a numeric guess", () => {
    const geometry = resolve(standWithRowSchemes, "1", "99");
    expect(geometry.rowDepthFraction).toBeNull();
    expect(geometry.hedge.some((line) => line.includes("documented row set"))).toBe(true);
    expect(geometry.hedge.some((line) => line.includes("about 30 rows"))).toBe(false);
  });

  it("tries rowBankSplit first when a level has both, only falling back to rowSequence for a row outside either bank", () => {
    const lowerBankRow = resolve(standWithRowSchemes, "6", "A"); // in rowBankSplit.lowerRows
    const upperBankRow = resolve(standWithRowSchemes, "6", "AA"); // in rowBankSplit.upperRows
    const overflowRow = resolve(standWithRowSchemes, "6", "OV1"); // only in rowSequence

    expect(lowerBankRow.rowDepthFraction).not.toBeNull();
    expect(upperBankRow.rowDepthFraction).not.toBeNull();
    expect(overflowRow.rowDepthFraction).not.toBeNull();

    // The walkway break still applies to the two banked rows (upper strictly behind lower).
    expect(upperBankRow.rowDepthFraction!).toBeGreaterThan(lowerBankRow.rowDepthFraction!);
    // The overflow row is documented (via rowSequence) as the furthest-back row of all three.
    expect(overflowRow.rowDepthFraction!).toBeGreaterThan(upperBankRow.rowDepthFraction!);
  });

  it("sequenceRowDepthFraction is case-insensitive and returns null outside the sequence", () => {
    expect(sequenceRowDepthFraction("aa", ["AA", "1", "2"])).toBe(0);
    expect(sequenceRowDepthFraction("2", ["AA", "1", "2"])).toBe(1);
    expect(sequenceRowDepthFraction("99", ["AA", "1", "2"])).toBeNull();
  });
});
