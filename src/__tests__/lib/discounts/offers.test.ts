import { describe, it, expect } from "vitest";
import { filterConcreteOffers, applyConcretenessGate } from "@/lib/discounts/offers";
import { normalizeDiscountPercent } from "@/lib/discounts/percent";
import type { DiscountOffer, DiscountScanResult } from "@/lib/discounts/types";

function offer(overrides: Partial<DiscountOffer> = {}): DiscountOffer {
  return {
    label: "",
    detail: null,
    discountPercent: null,
    promoCode: null,
    minSpend: null,
    audience: null,
    url: null,
    ...overrides,
  };
}

describe("filterConcreteOffers", () => {
  // Real regression: nike.com returned hasDiscount:true, confidence:"high"
  // with offers built purely from nav/footer link text — no percentage,
  // code, or price anywhere on the page.
  it("drops nav-link-only offers with no digit/折/code claim (nike.com shape)", () => {
    const offers: DiscountOffer[] = [
      offer({ label: "Sale Shoes", detail: "Discounted footwear collection" }),
      offer({ label: "Student Discount" }),
      offer({ label: "Military Discount" }),
    ];
    // The AI's own "evidence" was just the nav-link text repeated back — no
    // digit/折 in it either, proving non-digit evidence doesn't rescue offers.
    const evidence = ["Sale Shoes", "Student Discount", "Military Discount"];
    expect(filterConcreteOffers(offers, evidence)).toEqual([]);
  });

  // Real shape: marathonsports.com-style page with genuine 折 claims.
  it("keeps offers with a concrete 折/percent claim (marathonsports shape)", () => {
    const offers: DiscountOffer[] = [
      offer({ label: "全場低至8折", detail: "低至8折" }),
      offer({ label: "指定貨品", detail: "2件85折" }),
    ];
    const evidence = ["低至8折", "2件85折"];
    const kept = filterConcreteOffers(offers, evidence);
    expect(kept).toHaveLength(2);
    expect(kept.map((o) => o.label)).toEqual(["全場低至8折", "指定貨品"]);
  });

  it("keeps an offer with no digit in label/detail but a promo code", () => {
    const offers: DiscountOffer[] = [offer({ label: "Storewide code", promoCode: "SAVE10" })];
    expect(filterConcreteOffers(offers, [])).toHaveLength(1);
  });

  it("keeps an offer whose own label/detail is vague but the page-wide evidence has a concrete quote", () => {
    const offers: DiscountOffer[] = [offer({ label: "Member pricing" })];
    const evidence = ["Members save an extra 10% at checkout"];
    expect(filterConcreteOffers(offers, evidence)).toHaveLength(1);
  });

  it("treats a fullwidth digit as concrete after NFKC normalization", () => {
    const offers: DiscountOffer[] = [offer({ label: "節慶優惠", detail: "省＄５０" })]; // fullwidth digits
    expect(filterConcreteOffers(offers, [])).toHaveLength(1);
  });
});

function scanResult(overrides: Partial<DiscountScanResult> = {}): Pick<
  DiscountScanResult,
  "hasDiscount" | "confidence" | "discountPercent" | "promoCode"
> {
  return {
    hasDiscount: true,
    confidence: "high",
    discountPercent: null,
    promoCode: null,
    ...overrides,
  };
}

describe("applyConcretenessGate", () => {
  it("forces hasDiscount:false, confidence:low when every offer was dropped and there's no headline percent/code (nike.com shape)", () => {
    const result = scanResult();
    const gated = applyConcretenessGate(result, []);
    expect(gated.hasDiscount).toBe(false);
    expect(gated.confidence).toBe("low");
  });

  it("keeps hasDiscount:true when offers survived filtering", () => {
    const result = scanResult();
    const kept: DiscountOffer[] = [offer({ label: "全場低至8折" })];
    const gated = applyConcretenessGate(result, kept);
    expect(gated.hasDiscount).toBe(true);
    expect(gated.confidence).toBe("high");
  });

  it("keeps hasDiscount:true when no offers survived but the headline has a concrete percent", () => {
    const result = scanResult({ discountPercent: "up to 20%" });
    const gated = applyConcretenessGate(result, []);
    expect(gated.hasDiscount).toBe(true);
  });

  it("keeps hasDiscount:true when no offers survived but the headline has a promo code", () => {
    const result = scanResult({ promoCode: "SAVE10" });
    const gated = applyConcretenessGate(result, []);
    expect(gated.hasDiscount).toBe(true);
  });
});

describe("filter + gate pipeline (as used by the scan route)", () => {
  it("nike.com shape: nav-link-only offers, no evidence, no headline percent -> hasDiscount:false", () => {
    const rawOffers: DiscountOffer[] = [
      offer({ label: "Sale Shoes", detail: "Discounted footwear collection" }),
      offer({ label: "Student Discount" }),
      offer({ label: "Military Discount" }),
    ];
    const evidence: string[] = [];
    const kept = filterConcreteOffers(rawOffers, evidence);
    const result = scanResult({ discountPercent: null, promoCode: null });
    const gated = applyConcretenessGate(result, kept);

    expect(kept).toEqual([]);
    expect(gated.hasDiscount).toBe(false);
    expect(gated.confidence).toBe("low");
  });

  it("marathonsports shape (低至8折, 2件85折): offers kept, headline stays 'up to 20%'", () => {
    const rawOffers: DiscountOffer[] = [
      offer({ label: "全場低至8折", detail: "低至8折" }),
      offer({ label: "指定貨品", detail: "2件85折" }),
    ];
    const evidence = ["低至8折", "2件85折"];
    const kept = filterConcreteOffers(rawOffers, evidence);
    // Headline percent derived the same way the route derives it — via the
    // 折-conversion module — rather than hardcoded, so this actually
    // exercises "低至8折" -> "up to 20% off".
    const headlinePercent = normalizeDiscountPercent(null, ["低至8折"]);
    expect(headlinePercent).toBe("up to 20%");
    const result = scanResult({ discountPercent: headlinePercent });
    const gated = applyConcretenessGate(result, kept);

    expect(kept).toHaveLength(2);
    expect(gated.hasDiscount).toBe(true);
    expect(gated.discountPercent).toBe("up to 20%");
  });
});
