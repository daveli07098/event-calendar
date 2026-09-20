import { describe, it, expect } from "vitest";
import { looksLikeHtml, prioritizeAndTruncate } from "@/lib/discounts/text";
import { DISCOUNT_KEYWORDS } from "@/lib/discounts/links";

describe("looksLikeHtml", () => {
  it("detects an obvious HTML fragment", () => {
    expect(looksLikeHtml('<div class="promo">Up to 50% off! <a href="/sale">Shop</a></div>')).toBe(true);
  });

  it("detects a bare tag pair with no attributes", () => {
    expect(looksLikeHtml("<b>bold</b> html snippet")).toBe(true);
  });

  it("does not misclassify plain text containing a stray '<' comparison", () => {
    // "< $50" — "<" is followed by a space, not a letter, so it can't start
    // a tag match even though a ">" appears later in the string.
    expect(looksLikeHtml("Selected styles are now priced < $50, hurry while supplies last.")).toBe(false);
  });

  it("does not misclassify plain text containing a stray '>' arrow", () => {
    // "->" — the "-" before "loset" prevents starting an "<letter" match near a "<" (there is none),
    // and the eventual ">" isn't preceded by a "<letter...".
    expect(looksLikeHtml("Revenue grew 10% -> 20% this quarter, save 3折 on select items.")).toBe(false);
  });

  it("does not misclassify plain text with both a stray '<' and a stray '>' when neither forms a tag", () => {
    expect(
      looksLikeHtml("Sale window: 10:00 < now, revenue -> up 20%, prices > lowered on clearance items.")
    ).toBe(false);
  });
});

describe("prioritizeAndTruncate", () => {
  it("moves keyword-matching sentences to the front", () => {
    const text = "Welcome to our store. We have new arrivals. Up to 50% off storewide! Thanks for visiting.";
    const result = prioritizeAndTruncate(text, DISCOUNT_KEYWORDS, 1000);
    expect(result.indexOf("50% off")).toBeLessThan(result.indexOf("Welcome to our store"));
  });

  it("truncates to maxLen after reordering", () => {
    const text = "Up to 50% off storewide! " + "x".repeat(500);
    const result = prioritizeAndTruncate(text, DISCOUNT_KEYWORDS, 20);
    expect(result.length).toBeLessThanOrEqual(20);
  });
});
