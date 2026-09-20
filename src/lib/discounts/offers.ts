/**
 * Server-side "is this actually a discount" gate for the Discount Sale
 * scanner. The AI prompt tells the model not to manufacture offers from
 * navigation-link text alone (a "Sale Shoes" or "Student Discount" menu
 * entry is not itself a promotion), but models don't always comply — so this
 * module re-checks every offer against the page's own claims before the
 * result ever reaches the client.
 *
 * A real regression this guards against: nike.com returned
 * `hasDiscount: true, confidence: "high"` with offers "Sale Shoes —
 * Discounted footwear collection", "Student Discount", "Military Discount"
 * and NO percentage, code, or price anywhere on the page — those were nav/
 * footer links, not promotions.
 */
import type { DiscountOffer } from "./types";

// A fullwidth digit (e.g. from a Chinese percent-off phrase) counts as a
// digit for concreteness purposes, hence the NFKC normalize before testing.
const DIGIT_OR_ZHE_RE = /[\d折]/;

/** True when the string, once NFKC-normalized, contains a digit or a 折 token. */
function hasConcreteClaim(s: string | null | undefined): boolean {
  if (!s) return false;
  return DIGIT_OR_ZHE_RE.test(s.normalize("NFKC"));
}

/**
 * An offer is "concrete" — backed by an actual claim in the page text,
 * rather than invented from a nav-link label — when at least one of:
 *   - it has a promo code (an explicit, checkable claim on its own)
 *   - its label+detail contains a digit or 折 (a percentage, 折 number,
 *     price/was-price, or money-off amount)
 *   - at least one entry in the page's quoted `evidence` contains a digit or
 *     折 (the model captured a genuine quote backing SOME deal, even if it
 *     didn't restate the number in the offer's own label/detail)
 *
 * Evidence is checked page-wide rather than matched per-offer: `evidence` is
 * a short list of quotes for the whole page, not itemized per offer, so
 * requiring an exact per-offer match would reject correct AI extractions
 * that (accurately) summarized a number into the label instead of
 * re-quoting it. The `label+detail` digit check above is the ACTUAL per-offer
 * concreteness test; the evidence check is a fallback for pages where every
 * genuine offer share the page's one quoted number.
 */
function isConcreteOffer(offer: DiscountOffer, evidence: readonly string[]): boolean {
  if (offer.promoCode) return true;
  if (hasConcreteClaim(offer.label) || hasConcreteClaim(offer.detail)) return true;
  return evidence.some((e) => hasConcreteClaim(e));
}

/** Drops offers with no concrete backing claim (see module doc). */
export function filterConcreteOffers(
  offers: readonly DiscountOffer[],
  evidence: readonly string[]
): DiscountOffer[] {
  return offers.filter((o) => isConcreteOffer(o, evidence));
}

/**
 * When every offer got filtered out AND the headline itself carries no
 * concrete number (`discountPercent`) or code (`promoCode`), there is
 * nothing left backing `hasDiscount: true` — force it to `false` and drop
 * confidence to `"low"` rather than surfacing an empty-but-"confident" sale.
 */
export function applyConcretenessGate<
  T extends {
    hasDiscount: boolean;
    confidence: "high" | "medium" | "low" | null;
    discountPercent: string | null;
    promoCode: string | null;
  },
>(result: T, filteredOffers: readonly DiscountOffer[]): T {
  if (filteredOffers.length > 0 || result.discountPercent || result.promoCode) {
    return result;
  }
  return { ...result, hasDiscount: false, confidence: "low" };
}
