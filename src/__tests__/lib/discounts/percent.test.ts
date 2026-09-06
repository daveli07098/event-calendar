import { describe, it, expect } from "vitest";
import { normalizeDiscountPercent } from "@/lib/discounts/percent";

describe("normalizeDiscountPercent", () => {
  it("converts a bare N折 (N<10) to percent off", () => {
    expect(normalizeDiscountPercent("3折", [])).toBe("70%");
  });

  it("converts a two-digit N折 (85折) to percent off", () => {
    expect(normalizeDiscountPercent("85折", [])).toBe("15%");
  });

  it("finds the 折 token embedded in other text", () => {
    expect(normalizeDiscountPercent("2件85折", [])).toBe("15%");
  });

  it("handles a one-decimal 折 value (8.5折 == 85折)", () => {
    expect(normalizeDiscountPercent("8.5折", [])).toBe("15%");
  });

  it("prefers a 折 token found in context over the AI's raw percent, with 'up to' prefix", () => {
    expect(normalizeDiscountPercent("30%", ["盤點清貨低至3折"])).toBe("up to 70%");
  });

  it("passes through a range unchanged when there is no 折 token", () => {
    expect(normalizeDiscountPercent("20–60%", [])).toBe("20–60%");
  });

  it("passes through 'as low as' phrasing unchanged when there is no 折 token", () => {
    expect(normalizeDiscountPercent("as low as 20%", [])).toBe("as low as 20%");
  });

  it("returns null for null raw with no context", () => {
    expect(normalizeDiscountPercent(null, [])).toBeNull();
  });

  it("passes through a plain percent when context has no 折", () => {
    expect(normalizeDiscountPercent("50%", ["Extra savings this week"])).toBe("50%");
  });

  it("finds a 折 token in context even when raw is null", () => {
    expect(normalizeDiscountPercent(null, ["低至3折"])).toBe("up to 70%");
  });

  it("applies the 'up to' prefix from raw even when the 折 token itself is matched in context", () => {
    expect(normalizeDiscountPercent("as low as 30%", ["3折"])).toBe("up to 70%");
  });

  it("does NOT apply 'up to' when a marker appears elsewhere in the string, not immediately before the 折 number (最低消費 = minimum spend, unrelated)", () => {
    expect(normalizeDiscountPercent(null, ["最低消費$500 全場85折"])).toBe("15%");
  });

  it("does NOT apply 'up to' from raw when its marker isn't immediately before its own percent number either", () => {
    expect(normalizeDiscountPercent("最低消費 30%", ["3折"])).toBe("70%");
  });

  // Mirrors the route's headline resolution: primary context is
  // [discountSummary, title] ONLY; evidence is consulted as a fallback ONLY
  // when that first call yields null. A correct English headline percent
  // must not be clobbered by an unrelated 折 quote living in evidence (e.g.
  // a members-only offer's evidence sitting alongside a storewide headline).
  it("headline pattern: evidence is not consulted when discountPercent + summary/title already resolve", () => {
    const raw = "40%";
    const discountSummary: string | null = null;
    const title = "Storewide Sale";
    const evidence = ["會員85折"];
    let result = normalizeDiscountPercent(raw, [discountSummary, title].filter((s): s is string => Boolean(s)));
    if (result === null) result = normalizeDiscountPercent(null, evidence);
    expect(result).toBe("40%");
  });

  // "10折" means paying 10/10 of the price — full price, not a 90%-off deal.
  it("treats a bare '10折' as no discount, not 90% off", () => {
    expect(normalizeDiscountPercent("10折", [])).toBeNull();
  });

  it("passes through a plain raw percent when the only 折 token found (in context) is the invalid '10折'", () => {
    expect(normalizeDiscountPercent("20%", ["10折"])).toBe("20%");
  });
});
