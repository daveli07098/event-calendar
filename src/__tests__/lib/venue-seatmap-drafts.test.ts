import { describe, it, expect } from "vitest";
import { parseSeat } from "@/lib/seat-parse";
import { resolveSeatGeometry, THEATRE_HEDGE } from "@/lib/venue-seatmap/geometry";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";
// validate.ts already exists (another worker was drafting it in parallel) — assert every draft
// round-trips through it cleanly. If it's ever removed/renamed, update this import; per the
// brief this assertion may be skipped when the module doesn't exist yet.
import { validateSeatMapConfig } from "@/lib/venue-seatmap/validate";
import { fieldsRowOnly, fieldsWith, fieldsWithArea } from "./venue-seatmap-layout-fixtures";
import {
  VENUE_SEATMAP_DRAFTS,
  NOT_FOUND_VENUES,
  asiaWorldExpoArena,
  hongKongColiseum,
  macphersonStadium,
  xiquCentreGrandTheatre,
  ekccTheTheatre,
} from "../../../scripts/data/venue-seatmap-drafts";

function resolve(config: VenueSeatMapConfig, block: string, row?: string) {
  const geometry = resolveSeatGeometry(config, fieldsWith(block, row));
  if (!geometry) throw new Error(`expected block ${block} to resolve for ${config.name}`);
  return geometry;
}

const BARE_LANDMARK_ALIASES = ["AWE", "Hall", "Kai Tak", "Xiqu Centre", "亞洲國際博覽館", "東九文化中心"];

// ---- Structural invariants shared by every draft -------------------------------------

describe("VENUE_SEATMAP_DRAFTS — structural invariants", () => {
  it("has a unique id and venueName per draft, with no overlap against NOT_FOUND_VENUES", () => {
    const ids = VENUE_SEATMAP_DRAFTS.map((d) => d.config.id);
    const names = VENUE_SEATMAP_DRAFTS.map((d) => d.venueName);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);

    const notFoundNames = new Set(NOT_FOUND_VENUES.map((v) => v.venueName));
    for (const name of names) expect(notFoundNames.has(name)).toBe(false);
  });

  it("every draft is unconfirmed on orientation, sets an explicit layout, and cites its plan URL", () => {
    for (const draft of VENUE_SEATMAP_DRAFTS) {
      expect(draft.config.orientationConfidence).toBe("unconfirmed");
      expect(draft.config.layout).toBeDefined();
      const sourceUrls = (draft.config.seatingPlanSources ?? []).map((s) => s.url);
      expect(sourceUrls).toContain(draft.planUrl);
    }
  });

  it("never carries a bare landmark alias that could collide with a distinct nearby venue", () => {
    for (const draft of VENUE_SEATMAP_DRAFTS) {
      for (const alias of draft.config.aliases) {
        expect(BARE_LANDMARK_ALIASES).not.toContain(alias);
      }
    }
  });

  it("every draft's config validates ok via validateSeatMapConfig and round-trips unchanged", () => {
    for (const draft of VENUE_SEATMAP_DRAFTS) {
      const result = validateSeatMapConfig(draft.config);
      const errors = !result.ok ? result.errors : undefined;
      expect(result.ok, `${draft.venueName}: ${JSON.stringify(errors)}`).toBe(true);
      if (result.ok) {
        expect(result.config).toEqual(draft.config);
      }
    }
  });
});

describe("NOT_FOUND_VENUES", () => {
  it("gives every entry a non-empty reason and a tried[] array", () => {
    expect(NOT_FOUND_VENUES.length).toBeGreaterThan(0);
    for (const entry of NOT_FOUND_VENUES) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.tried)).toBe(true);
    }
  });

  it("keeps AWE's two similarly-named exhibition halls as distinct entries", () => {
    const names = NOT_FOUND_VENUES.map((v) => v.venueName);
    expect(names).toContain("亞洲國際博覽館 10號館");
    expect(names).toContain("亞洲國際博覽館 10號展館");
  });
});

// ---- 1. AsiaWorld-Expo Arena -----------------------------------------------------------

describe("AsiaWorld-Expo Arena draft", () => {
  it("resolves a floor seat (Block B Row K) onto the floor level", () => {
    const geometry = resolve(asiaWorldExpoArena, "B", "K");
    expect(geometry.levelId).toBe("floor");
    expect(geometry.blockNumeric).toBeNull(); // lettered block
    expect(geometry.angleFraction).toBe(0.5); // floor seats sit straight out from the stage
  });

  it("places balcony block 9 directly opposite the stage (angleFraction ~0.5)", () => {
    const geometry = resolve(asiaWorldExpoArena, "9");
    expect(geometry.levelId).toBe("arena-balcony");
    expect(geometry.angleFraction).toBeCloseTo(0.5, 5);
  });

  it("places balcony block 1 at a stage end (angleFraction ~0)", () => {
    const geometry = resolve(asiaWorldExpoArena, "1");
    expect(geometry.levelId).toBe("arena-balcony");
    expect(geometry.angleFraction).toBeCloseTo(0, 5);
  });

  it("orders balcony rows via the documented A-Z-skipping-I/O rowSequence, front to back", () => {
    const front = resolve(asiaWorldExpoArena, "9", "A");
    const back = resolve(asiaWorldExpoArena, "9", "Z");
    expect(front.rowDepthFraction).toBe(0);
    expect(back.rowDepthFraction).toBe(1);
    // "I" and "O" are documented as skipped — not in the balcony's row set at all.
    const skipped = resolve(asiaWorldExpoArena, "9", "I");
    expect(skipped.rowDepthFraction).toBeNull();
    expect(skipped.hedge.some((line) => line.includes("documented row set"))).toBe(true);
  });
});

// ---- 2. Hong Kong Coliseum -------------------------------------------------------------

describe("Hong Kong Coliseum draft", () => {
  it("resolves aisle 43 (Red gate group) and aisle 71 (Yellow gate group) with distinct angles", () => {
    const aisle43 = resolve(hongKongColiseum, "43");
    const aisle71 = resolve(hongKongColiseum, "71");
    expect(aisle43.levelId).toBe("stand");
    expect(aisle43.angleFraction).not.toBeNull();
    expect(aisle71.angleFraction).not.toBeNull();
    expect(aisle43.angleFraction).not.toBeCloseTo(aisle71.angleFraction!, 2);
  });

  it("orders the stand's documented rowSequence — front row AA, then numeric 1..20 — on a STAND level (point 1/2)", () => {
    const stand = hongKongColiseum.levels.find((l) => l.id === "stand")!;
    expect(stand.rowSequence).toEqual(["AA", ...Array.from({ length: 20 }, (_, i) => String(i + 1))]);
    expect(stand.rowBankSplit).toBeUndefined(); // no longer the rowBankSplit workaround

    const frontRow = resolve(hongKongColiseum, "43", "AA");
    const row1 = resolve(hongKongColiseum, "43", "1");
    const row20 = resolve(hongKongColiseum, "43", "20");
    expect(frontRow.rowDepthFraction).toBe(0);
    expect(row1.rowDepthFraction!).toBeGreaterThan(frontRow.rowDepthFraction!);
    expect(row20.rowDepthFraction).toBe(1);
  });
});

// ---- 3. Macpherson Stadium -------------------------------------------------------------

describe("Macpherson Stadium draft", () => {
  it("places section 10 (start of the far-end trio) on the far edge of the 3-sided perimeter", () => {
    const section10 = resolve(macphersonStadium, "10");
    const section9 = resolve(macphersonStadium, "9");
    const section1 = resolve(macphersonStadium, "1");
    expect(section10.levelId).toBe("stands");

    // Far-edge span of the 3-sided perimeter for this venue's plan rect, per pointOnPerimeter's
    // t1/t2 (see perimeter.ts): t1 = height/(2*height+width), t2 = (height+width)/(2*height+width).
    const { width, height } = macphersonStadium.plan!.outer;
    const total = 2 * height + width;
    const farStart = height / total;
    const farEnd = (height + width) / total;

    // 10, 11, 12 are the documented far-end trio (facing the stage) — 10 sits at the start of
    // that trio, roughly a third of the way around the arc, NOT dead-centre-opposite (that's
    // block 11). 9 and 1 are on the near long sides, outside the far-edge span.
    expect(section10.angleFraction).toBeCloseTo(1 / 3, 5);
    expect(section10.angleFraction!).toBeGreaterThanOrEqual(farStart);
    expect(section10.angleFraction!).toBeLessThanOrEqual(farEnd);
    expect(section9.angleFraction!).toBeLessThan(farStart);
    expect(section1.angleFraction!).toBeGreaterThan(farEnd);
  });

  it("orders floor rows AA (front) before SS (back) via the documented rowSequence, not the rowBankSplit workaround", () => {
    const floor = macphersonStadium.levels.find((l) => l.id === "floor")!;
    expect(floor.rowSequence).toEqual([
      "AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ",
      "KK", "LL", "MM", "NN", "OO", "PP", "QQ", "RR", "SS",
    ]);
    expect(floor.rowBankSplit).toBeUndefined(); // no longer the rowBankSplit workaround

    const front = resolve(macphersonStadium, "Floor", "AA");
    const back = resolve(macphersonStadium, "Floor", "SS");
    expect(front.rowDepthFraction).toBe(0); // full [0,1] span now, not the old compressed [0,0.4]
    expect(back.rowDepthFraction).toBe(1);
    expect(front.rowDepthFraction!).toBeLessThan(back.rowDepthFraction!);
  });
});

// ---- 4 & 5. Theatre-layout venues -------------------------------------------------------

describe("Theatre-layout drafts", () => {
  it("Xiqu Centre Grand Theatre: Stalls seat resolves with no position, just THEATRE_HEDGE", () => {
    const geometry = resolve(xiquCentreGrandTheatre, "Stalls", "AA");
    expect(geometry.angleFraction).toBeNull();
    expect(geometry.hedge).toContain(THEATRE_HEDGE);
  });

  it("Xiqu Centre Grand Theatre: Circle and Box blocks also resolve with THEATRE_HEDGE", () => {
    const circle = resolve(xiquCentreGrandTheatre, "Circle", "A");
    const box = resolve(xiquCentreGrandTheatre, "Box 1");
    expect(circle.hedge).toContain(THEATRE_HEDGE);
    expect(box.hedge).toContain(THEATRE_HEDGE);
  });

  it("East Kowloon Cultural Centre, The Theatre: resolves with no position, just THEATRE_HEDGE", () => {
    const geometry = resolve(ekccTheTheatre, "Main", "H");
    expect(geometry.angleFraction).toBeNull();
    expect(geometry.hedge).toContain(THEATRE_HEDGE);
  });

  // ---- Point 4: theatre resolution when seat-parse gives `area`, not `block` ------------

  it("resolves '堂座 F排 22號' (area only, no block) to Xiqu Centre's Stalls level via area-to-level matching", () => {
    const parsed = parseSeat("堂座 F排 22號");
    if (parsed.status === "unparseable") throw new Error("expected '堂座 F排 22號' to parse");
    expect(parsed.fields.block).toBeUndefined();
    expect(parsed.fields.area?.value).toBe("Stalls"); // 堂座 -> Stalls, per seat-parse point 10
    expect(parsed.fields.row?.value).toBe("F");

    const geometry = resolveSeatGeometry(xiquCentreGrandTheatre, parsed.fields);
    expect(geometry).not.toBeNull();
    expect(geometry?.levelId).toBe("stalls");
    expect(geometry?.angleFraction).toBeNull(); // still no position — theatre hedge only
    expect(geometry?.hedge).toContain(THEATRE_HEDGE);
    expect(geometry?.rowDepthFraction).not.toBeNull(); // F resolves via the Stalls rowBankSplit
  });

  it("resolves a bare area match against a level's blockLabelRanges label too (Circle)", () => {
    const geometry = resolveSeatGeometry(xiquCentreGrandTheatre, fieldsWithArea("Circle", "A"));
    expect(geometry).not.toBeNull();
    expect(geometry?.levelId).toBe("circle");
    expect(geometry?.hedge).toContain(THEATRE_HEDGE);
  });

  it("yields no geometry for an area with no matching level, never a guess", () => {
    expect(resolveSeatGeometry(xiquCentreGrandTheatre, fieldsWithArea("Balcony", "A"))).toBeNull();
  });

  it("EKCC's single 'Main' level resolves row+seat tickets with no block and no area at all", () => {
    const geometry = resolveSeatGeometry(ekccTheTheatre, fieldsRowOnly("H", "12"));
    expect(geometry).not.toBeNull();
    expect(geometry?.levelId).toBe("seating");
    expect(geometry?.block).toBe("Main");
    expect(geometry?.angleFraction).toBeNull();
    expect(geometry?.hedge).toContain(THEATRE_HEDGE);
  });

  it("never applies the theatre-only area/single-level fallback to a non-theatre layout", () => {
    // Hong Kong Coliseum is bowl-centre-stage, not theatre — a row-only, block-less/area-less
    // input must still yield no geometry rather than guessing a level.
    expect(resolveSeatGeometry(hongKongColiseum, fieldsRowOnly("AA"))).toBeNull();
  });
});

describe("section-as-block fallback", () => {
  it("resolves Macpherson 'Section 10 Row C Seat 20' to stand block 10", async () => {
    const { parseSeat } = await import("@/lib/seat-parse");
    const { resolveSeatGeometry } = await import("@/lib/venue-seatmap/geometry");
    const { VENUE_SEATMAP_DRAFTS } = await import("../../../scripts/data/venue-seatmap-drafts");
    const mac = VENUE_SEATMAP_DRAFTS.find((d) => d.venueName === "麥花臣場館")!.config;
    const parsed = parseSeat("Section 10 Row C Seat 20");
    expect(parsed.status).not.toBe("unparseable");
    const facts = resolveSeatGeometry(mac, parsed.status === "unparseable" ? null : parsed.fields);
    expect(facts?.block).toBe("10");
    expect(facts?.angleFraction).not.toBeNull();
  });
});
