/**
 * Synthetic (not researched) venue configs for the non-Kai-Tak seat-map layouts. Shapes only
 * loosely follow the real venues they're named after — they exist to exercise the layout code
 * paths, not to document those venues. Shared by the lib and component tests.
 */
import type { ParsedSeatFields, SeatParseResult } from "@/lib/seat-parse";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";

/** AsiaWorld-Expo-Arena-like: end stage, a flat floor with lettered blocks A-D (front to back),
 * and a balcony U numbered 1-17 clockwise from one stage end to the other. */
export const aweLikeArena: VenueSeatMapConfig = {
  id: "test-awe-arena",
  name: "Test Expo Arena",
  aliases: ["Test Expo Arena"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "bowl-end-stage",
  plan: { outer: { width: 200, height: 230 }, inner: { width: 120, height: 160 } },
  approxFloorM: { width: 45, length: 60 },
  levels: [
    {
      id: "floor",
      label: "Floor",
      tier: 0,
      kind: "floor",
      radiusRange: [0, 0.1],
      blockNumberRanges: [],
      blockLabelRanges: [{ labels: ["A", "B", "C", "D"], positionConfidence: "confirmed" }],
    },
    {
      id: "balcony",
      label: "Balcony",
      tier: 1,
      radiusRange: [0.1, 0.95],
      blockNumberRanges: [{ min: 1, max: 17, positionConfidence: "confirmed" }],
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
};

/** Coliseum-like: in the round, one stand level with aisle blocks 40-79 wrapping all four
 * sides of a near-square bowl. */
export const coliseumLike: VenueSeatMapConfig = {
  id: "test-coliseum",
  name: "Test Coliseum",
  aliases: ["Test Coliseum"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "bowl-centre-stage",
  plan: { outer: { width: 180, height: 196 }, inner: { width: 84, height: 96 } },
  approxFloorM: { width: 40, length: 44 },
  levels: [
    {
      id: "stand",
      label: "Stand",
      tier: 1,
      radiusRange: [0.05, 0.95],
      blockNumberRanges: [{ min: 40, max: 79, positionConfidence: "confirmed" }],
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
};

/** A stand level exercising `LevelConfig.rowSequence` in isolation, plus a second level with
 * BOTH `rowBankSplit` and `rowSequence` to exercise the documented precedence rule (bankSplit
 * tried first; rowSequence only as a fallback for a row outside either bank). See types.ts. */
export const standWithRowSchemes: VenueSeatMapConfig = {
  id: "test-stand-row-schemes",
  name: "Test Row-Schemes Stand",
  aliases: ["Test Row-Schemes Stand"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "bowl-end-stage",
  levels: [
    {
      id: "sequence-only",
      label: "Sequence Only",
      tier: 1,
      radiusRange: [0.2, 0.9],
      blockNumberRanges: [{ min: 1, max: 5, positionConfidence: "confirmed" }],
      // A front premium row plus numbered rows — same shape as Hong Kong Coliseum's stand.
      rowSequence: ["AA", "1", "2", "3", "4", "5"],
    },
    {
      id: "banked-plus-sequence",
      label: "Banked Plus Sequence",
      tier: 1,
      radiusRange: [0.2, 0.9],
      blockNumberRanges: [{ min: 6, max: 10, positionConfidence: "confirmed" }],
      // Two lettered banks with a real walkway break (A-C lower, AA-BB upper) PLUS a numbered
      // overflow row ("OV1") documented as sitting even further back, outside both banks — an
      // artificial but representative case for the bankSplit-then-rowSequence precedence rule.
      rowBankSplit: { lowerRows: ["A", "B", "C"], upperRows: ["AA", "BB"], confidence: "confirmed" },
      rowSequence: ["A", "B", "C", "AA", "BB", "OV1"],
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
};

export const theatreLike: VenueSeatMapConfig = {
  id: "test-theatre",
  name: "Test Concert Hall",
  aliases: ["Test Concert Hall"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "theatre",
  levels: [
    {
      id: "stalls",
      label: "Stalls",
      tier: 0,
      radiusRange: [0, 0.6],
      blockNumberRanges: [],
      blockLabelRanges: [{ labels: ["Left", "Centre", "Right"], positionConfidence: "confirmed" }],
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
};

/** Builds a parsed seat directly — letter blocks ("Block A") don't go through `parseSeat` in
 * these tests so they don't depend on seat-parse's own letter-block support. */
export function seatWith(block: string, row?: string): SeatParseResult {
  return {
    status: "parsed",
    raw: `Block ${block}${row ? ` Row ${row}` : ""}`,
    fields: {
      block: { value: block, source: "stated" },
      ...(row ? { row: { value: row, source: "stated" as const } } : {}),
    },
    conflicts: [],
    additionalSeatsDetected: 0,
  };
}

export function fieldsWith(block: string, row?: string) {
  const seat = seatWith(block, row);
  if (seat.status === "unparseable") throw new Error("unreachable");
  return seat.fields;
}

/** Builds parsed seat fields carrying only a named `area` (theatre tier, e.g. "Stalls") plus an
 * optional row — no `block` at all, mirroring how seat-parse maps 堂座/Stalls/樓座/Circle onto
 * `area` rather than `block` (see seat-parse.ts header point 10). */
export function fieldsWithArea(area: string, row?: string): ParsedSeatFields {
  return {
    area: { value: area, source: "stated" },
    ...(row ? { row: { value: row, source: "stated" as const } } : {}),
  };
}

/** Builds parsed seat fields carrying only a row (and optionally a seat) — no `block` and no
 * `area` at all, for the single-level theatre fallback (e.g. EKCC's sole "Main" level). */
export function fieldsRowOnly(row: string, seat?: string): ParsedSeatFields {
  return {
    row: { value: row, source: "stated" },
    ...(seat ? { seat: { value: seat, source: "stated" as const } } : {}),
  };
}
