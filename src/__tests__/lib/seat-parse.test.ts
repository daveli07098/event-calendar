import { describe, it, expect } from "vitest";
import { parseSeat } from "@/lib/seat-parse";

// A realistic per-venue inference function used only in the opt-in tests
// below — mirrors the CONFIRMED Kai Tak Stadium seating chart (Level 2
// holds both 1xx and 2xx blocks, only 5xx is Level 5; no Level 1 tier
// exists at all), which is exactly why this module does not ship a
// "leading digit implies level" rule by default. See seat-parse.ts header.
function kaiTakLevelForBlock(block: string): number | null {
  const n = Number(block.match(/^\d+/)?.[0] ?? NaN);
  if (Number.isNaN(n)) return null;
  if (n >= 100 && n <= 110) return 2;
  if (n >= 201 && n <= 240) return 2;
  if (n >= 500 && n <= 599) return 5;
  return null;
}

describe("parseSeat", () => {
  describe("confirmed real Kai Tak Stadium examples", () => {
    it("parses 'Gate F Level 2 Block 225 Row BB Seat 101'", () => {
      const result = parseSeat("Gate F Level 2 Block 225 Row BB Seat 101");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.gate).toEqual({ value: "F", source: "stated" });
      expect(result.fields.level).toEqual({ value: 2, source: "stated" });
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
      expect(result.conflicts).toEqual([]);
      expect(result.raw).toBe("Gate F Level 2 Block 225 Row BB Seat 101");
    });

    it("parses 'Level 5 Block 519B Row M Seat 547' — letter suffix on block preserved verbatim", () => {
      const result = parseSeat("Level 5 Block 519B Row M Seat 547");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 5, source: "stated" });
      expect(result.fields.block).toEqual({ value: "519B", source: "stated" });
      expect(result.fields.row).toEqual({ value: "M", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "547", source: "stated" });
    });
  });

  describe("Section / Sec / Sect abbreviations", () => {
    it("parses 'Section 118, Row 12, Seat 5'", () => {
      const result = parseSeat("Section 118, Row 12, Seat 5");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.section).toEqual({ value: "118", source: "stated" });
      expect(result.fields.row).toEqual({ value: "12", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "5", source: "stated" });
      // Section carries no level tie-in, unlike Block — see header point 2.
      expect(result.fields.level).toBeUndefined();
    });

    it.each(["Sec 118, Row 12, Seat 5", "Sect 118, Row 12, Seat 5", "Sec. 118, Row 12, Seat 5"])(
      "parses the abbreviation '%s'",
      (input) => {
        const result = parseSeat(input);
        expect(result.status).toBe("parsed");
        if (result.status === "unparseable") throw new Error("unreachable");
        expect(result.fields.section).toEqual({ value: "118", source: "stated" });
      },
    );
  });

  describe("theatre naming", () => {
    it("parses 'Stalls Row H Seat 24'", () => {
      const result = parseSeat("Stalls Row H Seat 24");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: "Stalls", source: "stated" });
      expect(result.fields.row).toEqual({ value: "H", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "24", source: "stated" });
    });

    it("parses 'Dress Circle Row C Seat 11'", () => {
      const result = parseSeat("Dress Circle Row C Seat 11");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: "Dress Circle", source: "stated" });
      expect(result.fields.row).toEqual({ value: "C", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "11", source: "stated" });
    });

    it("parses standalone 'Upper Circle' as complete — no row/seat is promised", () => {
      const result = parseSeat("Upper Circle");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: "Upper Circle", source: "stated" });
      expect(result.fields.row).toBeUndefined();
      expect(result.fields.seat).toBeUndefined();
    });

    it("parses standalone 'Balcony' as complete", () => {
      const result = parseSeat("Balcony");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: "Balcony", source: "stated" });
    });
  });

  describe("arena / general admission", () => {
    it.each(["Standing", "General Admission", "GA Pit"])("parses standalone '%s' as complete", (input) => {
      const result = parseSeat(input);
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: input, source: "stated" });
      expect(result.fields.row).toBeUndefined();
      expect(result.fields.seat).toBeUndefined();
    });

    it("parses 'Floor A Row 3 Seat 12' — floor sub-label captured, not swallowed by Row", () => {
      const result = parseSeat("Floor A Row 3 Seat 12");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: "Floor A", source: "stated" });
      expect(result.fields.row).toEqual({ value: "3", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "12", source: "stated" });
    });
  });

  describe("bare / compact formats", () => {
    it("parses '2/225/BB/101' — positional level counts as stated, not inferred", () => {
      const result = parseSeat("2/225/BB/101");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 2, source: "stated" });
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
    });

    it("parses '225-BB-101' — block-row-seat, no level segment so level is absent by default", () => {
      const result = parseSeat("225-BB-101");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
      expect(result.fields.level).toBeUndefined();
    });

    it("parses 'Blk 225 R BB S 101' — abbreviated keywords", () => {
      const result = parseSeat("Blk 225 R BB S 101");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
    });

    it("rejects a numeric-row dash-compact that collides with an ISO date — '2026-08-18' is unparseable", () => {
      const result = parseSeat("2026-08-18");
      expect(result.status).toBe("unparseable");
    });
  });

  describe("Chinese and Japanese formats", () => {
    it("parses '2樓 225區 BB排 101號'", () => {
      const result = parseSeat("2樓 225區 BB排 101號");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 2, source: "stated" });
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
    });

    it("parses '第5層 519B區 M排 547號' — level with 第 prefix, letter-suffixed block", () => {
      const result = parseSeat("第5層 519B區 M排 547號");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 5, source: "stated" });
      expect(result.fields.block).toEqual({ value: "519B", source: "stated" });
      expect(result.fields.row).toEqual({ value: "M", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "547", source: "stated" });
    });

    it("parses Japanese '2階 225ブロック BB列 101番'", () => {
      const result = parseSeat("2階 225ブロック BB列 101番");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 2, source: "stated" });
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
    });

    it("does NOT extract a seat from a bare Hong Kong street address (號 with no other CJK seating marker)", () => {
      // 彌敦道363號 = "363 Nathan Road" — 號 here is a street number, not a
      // seat number. See header point 6.
      const result = parseSeat("彌敦道363號");
      expect(result.status).toBe("unparseable");
    });

    it("does NOT extract a seat from a Japanese address fragment (番 with no other CJK seating marker)", () => {
      const result = parseSeat("新宿区西新宿2丁目8番1号");
      expect(result.status).toBe("unparseable");
    });
  });

  describe("robustness: case, whitespace, punctuation", () => {
    it("parses an all-lowercase version, preserving the value case exactly as typed", () => {
      const result = parseSeat("gate f level 2 block 225 row bb seat 101");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.gate).toEqual({ value: "f", source: "stated" });
      expect(result.fields.row).toEqual({ value: "bb", source: "stated" });
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
    });

    it("tolerates extra internal whitespace", () => {
      const result = parseSeat("Gate   F    Level  2   Block   225   Row   BB   Seat   101");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
    });

    it("tolerates leading/trailing whitespace and a trailing period", () => {
      const result = parseSeat("  Section 118, Row 12, Seat 5.  ");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.seat).toEqual({ value: "5", source: "stated" });
      // raw preserves the untouched original, whitespace and all.
      expect(result.raw).toBe("  Section 118, Row 12, Seat 5.  ");
    });

    it("tolerates a trailing period on a compact delimited format", () => {
      const result = parseSeat("225-BB-101.");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
    });
  });

  describe("level inference opt-in (no default rule — see header point 1)", () => {
    it("'Block 225' alone yields NO level by default (no leading-digit guess)", () => {
      const result = parseSeat("Block 225");
      expect(result.status).toBe("partial"); // block found, no row — see classify()
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.level).toBeUndefined();
      expect(result.conflicts).toEqual([]);
    });

    it("uses a supplied inference function to derive an inferred level when none is stated", () => {
      const result = parseSeat("Block 225 Row BB Seat 101", { inferLevelFromBlock: kaiTakLevelForBlock });
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 2, source: "inferred" });
      expect(result.conflicts).toEqual([]);
    });

    it("a 1xx block correctly infers Level 2 via the supplied function, NOT 'Level 1' — the Kai Tak nuance", () => {
      const result = parseSeat("Block 105 Row A Seat 3", { inferLevelFromBlock: kaiTakLevelForBlock });
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 2, source: "inferred" });
    });

    it("surfaces a conflict and prefers the explicit level when it disagrees with the supplied inference", () => {
      const result = parseSeat("Level 3 Block 225 Row BB Seat 101", { inferLevelFromBlock: kaiTakLevelForBlock });
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      // Explicit value wins — never silently overridden by the derived one.
      expect(result.fields.level).toEqual({ value: 3, source: "stated" });
      expect(result.conflicts).toEqual([{ field: "level", stated: 3, impliedByBlock: 2 }]);
    });

    it("surfaces the same conflict through the compact slash template ('3/225/BB/101')", () => {
      const result = parseSeat("3/225/BB/101", { inferLevelFromBlock: kaiTakLevelForBlock });
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 3, source: "stated" });
      expect(result.conflicts).toEqual([{ field: "level", stated: 3, impliedByBlock: 2 }]);
    });

    it("no conflict when the explicit level and the supplied inference agree", () => {
      const result = parseSeat("Level 2 Block 225 Row BB Seat 101", { inferLevelFromBlock: kaiTakLevelForBlock });
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.level).toEqual({ value: 2, source: "stated" });
      expect(result.conflicts).toEqual([]);
    });
  });

  describe("row/block value preservation — no over-normalisation", () => {
    it("keeps 'BB' distinct from 'B' (doubled row letters are real, deep rows — not a typo of B)", () => {
      const bb = parseSeat("Block 225 Row BB Seat 101");
      const b = parseSeat("Block 225 Row B Seat 101");
      if (bb.status === "unparseable" || b.status === "unparseable") throw new Error("unreachable");
      expect(bb.fields.row?.value).toBe("BB");
      expect(b.fields.row?.value).toBe("B");
      expect(bb.fields.row?.value).not.toBe(b.fields.row?.value);
    });

    it("does not lose the letter suffix on '519B' or '524A' — distinct, meaningful sections", () => {
      const a = parseSeat("Block 519B Row M Seat 1");
      const b = parseSeat("Block 524A Row M Seat 1");
      if (a.status === "unparseable" || b.status === "unparseable") throw new Error("unreachable");
      expect(a.fields.block?.value).toBe("519B");
      expect(b.fields.block?.value).toBe("524A");
    });

    it("front row 'Row A' parses correctly (not swallowed by the stopword guard)", () => {
      const result = parseSeat("Row A Seat 5");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.row).toEqual({ value: "A", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "5", source: "stated" });
    });
  });

  describe("partial parses — some fields found, not enough to be confident", () => {
    it("'Row BB' alone (no block/section/area, no seat) is partial", () => {
      const result = parseSeat("Row BB");
      expect(result.status).toBe("partial");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toBeUndefined();
    });

    it("'Block 225 Row BB' (no seat) is partial", () => {
      const result = parseSeat("Block 225 Row BB");
      expect(result.status).toBe("partial");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toBeUndefined();
    });

    it("'Gate F' alone is partial", () => {
      const result = parseSeat("Gate F");
      expect(result.status).toBe("partial");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.gate).toEqual({ value: "F", source: "stated" });
    });
  });

  describe("garbage and empty input — never throws, never half-fills", () => {
    it("returns unparseable for an empty string", () => {
      const result = parseSeat("");
      expect(result).toEqual({ status: "unparseable", raw: "" });
    });

    it("returns unparseable for whitespace-only input", () => {
      const result = parseSeat("   ");
      expect(result.status).toBe("unparseable");
      expect(result.raw).toBe("   ");
    });

    it("returns unparseable for random gibberish rather than throwing", () => {
      expect(() => parseSeat("asdkfjhasdkfj12345!!!")).not.toThrow();
      const result = parseSeat("asdkfjhasdkfj12345!!!");
      expect(result.status).toBe("unparseable");
      expect(result.raw).toBe("asdkfjhasdkfj12345!!!");
    });

    it("returns unparseable for a bare unlabeled number — too ambiguous (ticket ID? price? postcode?)", () => {
      const result = parseSeat("12345");
      expect(result.status).toBe("unparseable");
    });

    it("does not throw for pathological input (very long string, only punctuation, emoji)", () => {
      expect(() => parseSeat("!".repeat(5000))).not.toThrow();
      expect(() => parseSeat("🎟️🎟️🎟️")).not.toThrow();
      expect(parseSeat("!".repeat(5000)).status).toBe("unparseable");
      expect(parseSeat("🎟️🎟️🎟️").status).toBe("unparseable");
    });
  });

  describe("decision: seat-like fragments embedded in unrelated prose ARE extracted", () => {
    // See seat-parse.ts header point 5 for the reasoning: real callers often
    // paste a full confirmation email/description rather than an isolated
    // seat string, so this module scans for keyword+value pairs anywhere in
    // the text instead of requiring the whole input to BE a seat descriptor.
    it("extracts a full seat descriptor embedded in a sentence", () => {
      const result = parseSeat(
        "Please meet your usher near Gate F Level 2 Block 225 Row BB Seat 101 before doors open at 7pm.",
      );
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.gate).toEqual({ value: "F", source: "stated" });
      expect(result.fields.level).toEqual({ value: 2, source: "stated" });
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "101", source: "stated" });
    });

    it("does not falsely match 'row' used as an ordinary English word with no seat-shaped value", () => {
      // "until" doesn't fit the row value shape (1-3 letters/digits), so no
      // row is extracted — the sentence stays unparseable rather than
      // fabricating a bogus "row: until".
      const result = parseSeat("Please wait in a row until you are called; there is no assigned seating.");
      expect(result.status).toBe("unparseable");
    });

    it("stopword guard rejects a short filler word directly after 'Row' in prose", () => {
      // "of" is short enough to fit the row value shape (1-3 letters) but is
      // filtered by the stopword guard rather than accepted as a row label,
      // so nothing else in the sentence matches either -> unparseable.
      const result = parseSeat("Take a seat in the front row of the theatre.");
      expect(result.status).toBe("unparseable");
    });

    it("contrast: the same sentence shape DOES match when a real seat-like token follows 'row'", () => {
      // Confirms the guard above is specifically a stopword rejection, not a
      // side effect of the row regex failing to fire on short words at all.
      const result = parseSeat("Please take your seat in the front row BB, thanks.");
      expect(result.status).toBe("partial");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.row).toEqual({ value: "BB", source: "stated" });
    });
  });
});
