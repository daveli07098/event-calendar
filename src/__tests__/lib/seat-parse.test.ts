import { describe, it, expect } from "vitest";
import { parseSeat, parseSeats } from "@/lib/seat-parse";

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

  describe("letter blocks — 'Block A', 'Blk C', 'Section D', 'Area A' (header point 9)", () => {
    it("fixes the dropped-block regression: 'Block B Row 12 Seat 5' keeps the block", () => {
      const result = parseSeat("Block B Row 12 Seat 5");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "B", source: "stated" });
      expect(result.fields.row).toEqual({ value: "12", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "5", source: "stated" });
    });

    it.each(["Block A", "BLOCK B", "Blk C"])("parses '%s' alone as a partial block", (input) => {
      const result = parseSeat(input);
      expect(result.status).toBe("partial");
      if (result.status === "unparseable") throw new Error("unreachable");
      const expected = input.match(/[A-Za-z]$/)?.[0];
      expect(result.fields.block).toEqual({ value: expected, source: "stated" });
      expect(result.fields.blockKind).toBeUndefined();
    });

    it("treats a letter after 'Section' as a block, not the numeric section field", () => {
      const result = parseSeat("Section D Row 4 Seat 9");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "D", source: "stated" });
      expect(result.fields.section).toBeUndefined();
    });

    it("still treats a digit after 'Section' as the numeric section field, not block (no regression)", () => {
      const result = parseSeat("Section 118, Row 12, Seat 5");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.section).toEqual({ value: "118", source: "stated" });
      expect(result.fields.block).toBeUndefined();
    });

    it("parses a short letter+digit block code like 'A1'", () => {
      const result = parseSeat("Block A1 Row 2 Seat 3");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "A1", source: "stated" });
    });

    it("does not lose a digit-led block's letter suffix now that letter blocks exist (no regression)", () => {
      const result = parseSeat("Level 5 Block 519B Row M Seat 547");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "519B", source: "stated" });
    });
  });

  describe("areas as block — 'Area A' (arena floor letter-section, header point 9)", () => {
    it("parses 'Area A Row 3 Seat 8' with block 'A', distinct from the named-tier 'area' field", () => {
      const result = parseSeat("Area A Row 3 Seat 8");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "A", source: "stated" });
      expect(result.fields.area).toBeUndefined();
    });

    it("parses the CJK letter-block form 'A區'", () => {
      const result = parseSeat("A區 Row 3 Seat 8");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "A", source: "stated" });
    });

    it("parses the CJK letter-block form with a space, 'A 區'", () => {
      const result = parseSeat("A 區 Row 3 Seat 8");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "A", source: "stated" });
    });

    it("parses the reversed tight CJK letter-block form '區A' (no whitespace)", () => {
      const result = parseSeat("區A 3排 8號");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "A", source: "stated" });
    });

    it("does not break the existing numeric '225區' CJK block (no regression)", () => {
      const result = parseSeat("225區 BB排 101號");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
    });
  });

  describe("aisles — Hong Kong Coliseum 紅館-style stand numbering (header point 9)", () => {
    it("parses 'Aisle 43' into block '43'", () => {
      const result = parseSeat("Aisle 43 Row 5 Seat 12");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "43", source: "stated" });
      expect(result.fields.blockKind).toBe("aisle");
    });

    it("parses the CJK aisle form '43段'", () => {
      const result = parseSeat("43段 5排 12號");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "43", source: "stated" });
      expect(result.fields.blockKind).toBe("aisle");
    });

    it("parses the reversed CJK aisle form '段43'", () => {
      const result = parseSeat("段43 5排 12號");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "43", source: "stated" });
      expect(result.fields.blockKind).toBe("aisle");
    });

    it("a bare Block does not get blockKind 'aisle' (metadata only set for actual aisle matches)", () => {
      const result = parseSeat("Block 225 Row BB Seat 101");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.blockKind).toBeUndefined();
    });

    it("does NOT extract an aisle block from a bare Taiwan road-address fragment (段 with no other CJK seating marker)", () => {
      // 忠孝東路4段100號 = "No. 100, Section 4, Zhongxiao East Road" — 段 here
      // marks a road section, not an aisle. See header point 9.
      const result = parseSeat("忠孝東路4段100號");
      expect(result.status).toBe("unparseable");
    });
  });

  describe("theatre-tier CJK equivalents extend `area` (header point 10)", () => {
    it("parses bare English 'Circle' (after Dress/Upper Circle, no regression — see the 'theatre naming' describe above)", () => {
      const result = parseSeat("Circle Row C Seat 11");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: "Circle", source: "stated" });
    });

    it.each([
      ["堂座", "Stalls"],
      ["樓座", "Circle"],
      ["廂座", "Box"],
      ["露台", "Balcony"],
      ["內場", "Floor"],
    ])("parses CJK theatre tier '%s' as area '%s'", (cjk, label) => {
      const result = parseSeat(`${cjk} Row 3 Seat 8`);
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: label, source: "stated" });
      expect(result.fields.level).toBeUndefined();
    });

    it("'Arena floor' already matches the existing bare Floor rule (no new rule needed)", () => {
      const result = parseSeat("Arena floor Row 3 Seat 8");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: "Floor", source: "stated" });
    });

    it("numeric rows and CJK numeric rows still work alongside the new area labels (no regression)", () => {
      const en = parseSeat("Circle Row 12 Seat 5");
      const cjk = parseSeat("堂座 12排 5號");
      if (en.status === "unparseable" || cjk.status === "unparseable") throw new Error("unreachable");
      expect(en.fields.row).toEqual({ value: "12", source: "stated" });
      expect(cjk.fields.row).toEqual({ value: "12", source: "stated" });
    });

    it("double-letter AA/BB rows still work alongside the new area labels (no regression)", () => {
      const result = parseSeat("露台 Row AA Seat 5");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.area).toEqual({ value: "Balcony", source: "stated" });
      expect(result.fields.row).toEqual({ value: "AA", source: "stated" });
    });
  });

  describe("middle-dot / no-space compact formats — letter variant (header point 9)", () => {
    it("keeps the existing numeric middle-dot format working: 'Block 225·RowJ·Seat78'", () => {
      const result = parseSeat("Block 225·RowJ·Seat78");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.fields.row).toEqual({ value: "J", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "78", source: "stated" });
    });

    it("parses the new letter variant 'Block A·Row12·Seat5'", () => {
      const result = parseSeat("Block A·Row12·Seat5");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "A", source: "stated" });
      expect(result.fields.row).toEqual({ value: "12", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "5", source: "stated" });
    });
  });

  describe("multiple tickets in one paste — additionalSeatsDetected (header point 11)", () => {
    it("a single-ticket input reports additionalSeatsDetected: 0", () => {
      const result = parseSeat("Gate F Level 2 Block 225 Row BB Seat 101");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.additionalSeatsDetected).toBe(0);
    });

    it("parseSeat on 'Block 109·RowJ·Seat223 Block 225·RowJ·Seat78' returns the FIRST ticket and flags one more", () => {
      const result = parseSeat("Block 109·RowJ·Seat223 Block 225·RowJ·Seat78");
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "109", source: "stated" });
      expect(result.fields.row).toEqual({ value: "J", source: "stated" });
      expect(result.fields.seat).toEqual({ value: "223", source: "stated" });
      expect(result.additionalSeatsDetected).toBe(1);
    });

    it("flags the correct count across three tickets", () => {
      const result = parseSeat(
        "Block 109·RowJ·Seat223 Block 225·RowJ·Seat78 Block 301·RowK·Seat14",
      );
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.additionalSeatsDetected).toBe(2);
    });

    it("does NOT over-count an ordinary single-ticket multi-line email as containing an additional seat", () => {
      // Regression guard: a marker-less line before/after the real ticket
      // line must not be mistaken for a second ticket.
      const result = parseSeat(
        "Your ticket details:\nBlock 225 Row BB Seat 101\nPlease arrive 30 minutes early.",
      );
      expect(result.status).toBe("parsed");
      if (result.status === "unparseable") throw new Error("unreachable");
      expect(result.fields.block).toEqual({ value: "225", source: "stated" });
      expect(result.additionalSeatsDetected).toBe(0);
    });
  });

  describe("negative cases — must not fabricate a seat", () => {
    it("does not yield a seat for a bare Hong Kong street address with no seating marker", () => {
      const result = parseSeat("彌敦道363號");
      expect(result.status).toBe("unparseable");
    });

    it("does not yield anything for 'Kai Tak' alone", () => {
      const result = parseSeat("Kai Tak");
      expect(result.status).toBe("unparseable");
    });
  });
});

describe("parseSeats", () => {
  it("returns a single-element array for a single-ticket input, matching parseSeat", () => {
    const results = parseSeats("Gate F Level 2 Block 225 Row BB Seat 101");
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("parsed");
    if (results[0].status === "unparseable") throw new Error("unreachable");
    expect(results[0].fields.block).toEqual({ value: "225", source: "stated" });
  });

  it("splits 'Block 109·RowJ·Seat223 Block 225·RowJ·Seat78' into two parsed tickets", () => {
    const results = parseSeats("Block 109·RowJ·Seat223 Block 225·RowJ·Seat78");
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("parsed");
    expect(results[1].status).toBe("parsed");
    if (results[0].status === "unparseable" || results[1].status === "unparseable") {
      throw new Error("unreachable");
    }
    expect(results[0].fields.block).toEqual({ value: "109", source: "stated" });
    expect(results[0].fields.seat).toEqual({ value: "223", source: "stated" });
    expect(results[1].fields.block).toEqual({ value: "225", source: "stated" });
    expect(results[1].fields.seat).toEqual({ value: "78", source: "stated" });
  });

  it("splits three tickets separated by newlines, one Block marker per line", () => {
    const results = parseSeats(
      "Block 109 Row J Seat 223\nBlock 225 Row J Seat 78\nBlock 301 Row K Seat 14",
    );
    expect(results).toHaveLength(3);
    for (const r of results) expect(r.status).toBe("parsed");
    if (results.some((r) => r.status === "unparseable")) throw new Error("unreachable");
    expect((results[0] as Extract<(typeof results)[number], { status: "parsed" }>).fields.block).toEqual({
      value: "109",
      source: "stated",
    });
    expect((results[2] as Extract<(typeof results)[number], { status: "parsed" }>).fields.seat).toEqual({
      value: "14",
      source: "stated",
    });
  });

  it("splits tickets by repeated CJK 區 markers", () => {
    const results = parseSeats("225區 BB排 101號 226區 CC排 102號");
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("parsed");
    expect(results[1].status).toBe("parsed");
    if (results[0].status === "unparseable" || results[1].status === "unparseable") {
      throw new Error("unreachable");
    }
    expect(results[0].fields.block).toEqual({ value: "225", source: "stated" });
    expect(results[1].fields.block).toEqual({ value: "226", source: "stated" });
  });

  it("splits tickets by repeated CJK letter-before block markers ('A區' form) without stranding the letter", () => {
    // Regression guard: the split point for a suffix-style CJK marker (區
    // comes AFTER its value) must back up over a preceding LETTER too, not
    // just a preceding digit run — otherwise "B區" is stranded at the start
    // of the second segment with its own block value already consumed by
    // segment one.
    const results = parseSeats("A區 3排 8號 B區 4排 9號");
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("parsed");
    expect(results[1].status).toBe("parsed");
    if (results[0].status === "unparseable" || results[1].status === "unparseable") {
      throw new Error("unreachable");
    }
    expect(results[0].fields.block).toEqual({ value: "A", source: "stated" });
    expect(results[1].fields.block).toEqual({ value: "B", source: "stated" });
  });
});
