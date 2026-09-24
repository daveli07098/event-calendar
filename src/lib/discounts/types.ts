/**
 * Shared contract for the Discount Sale scanner — imported by BOTH
 * src/app/api/discounts/scan/route.ts (producer) and
 * src/components/tickets/DiscountSection.tsx (consumer) so the two can't drift.
 */

/** A single distinct promotion found on the page. */
export interface DiscountOffer {
  label: string;                                  // "Storewide sale", "New member offer"
  detail: string | null;                          // "低至2折", "Extra 10% off apparel"
  /**
   * Percent OFF as the page states it, normalised by the server: Chinese
   * "N折" (pay N/10 of the price) is converted to the equivalent "% off", so
   * "3折" → "70%", "85折" → "15%", "低至3折" → "up to 70%". Ranges like
   * "20–60%" pass through unchanged.
   */
  discountPercent: string | null;
  promoCode: string | null;                       // "618SALE"
  minSpend: string | null;                        // "$900", "HK$500"
  audience: "all" | "members" | "new" | null;     // who it applies to
  /**
   * Deep link to the promotion's own page (collection / landing page), when one
   * of the page's links plainly corresponds to this offer. Always an absolute
   * http(s) URL that appeared on the scanned page — never AI-authored. null when
   * the offer has no dedicated page (e.g. a storewide payment-method rebate).
   */
  url: string | null;
}

/** A notable discounted product listed on the page. */
export interface DiscountItem {
  name: string;
  price: string | null;
  originalPrice: string | null;
  /** Product page link when it appeared on the scanned page; otherwise null. */
  url: string | null;
}

/** AI-detected discount/sale promotion on a retail site. */
export interface DiscountScanResult {
  hasDiscount: boolean;
  confidence: "high" | "medium" | "low" | null;   // how clearly the page shows a deal
  title: string | null;
  discountSummary: string | null;
  /** Headline "% off", normalised the same way as DiscountOffer.discountPercent. */
  discountPercent: string | null;
  promoCode: string | null;                       // headline code
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
  categories: string[];                            // what's on sale ("Running shoes")
  offers: DiscountOffer[];                         // all distinct promotions
  evidence: string[];                              // exact phrases proving the deal (the "why")
  items: DiscountItem[];
  /**
   * The URL that was scanned (what the user added as a source). When the
   * scan came from pasted page content instead of a server-side fetch (see
   * `fromPastedContent`), this is just the label/base URL the user supplied
   * — nothing was actually fetched from it.
   */
  sourceUrl: string;
  /**
   * Best deep link for the headline promotion — the first offer's url, or the
   * most discount-like candidate link on the page. Falls back to null (the UI
   * then links to sourceUrl).
   */
  url: string | null;
  aiUsed: string;
  tokensUsed: number | null;
  /**
   * True when this result came from user-pasted page content (see the
   * `pageContent` request field) rather than a server-side fetch of `url` —
   * lets the UI label the result accordingly. Optional/defaults to false so
   * existing stored results (persisted before this field existed) still
   * satisfy the type.
   */
  fromPastedContent?: boolean;
  /**
   * Present when this result came from a fallback source (see
   * src/lib/discounts/fallback-sources.ts) rather than a scan of `sourceUrl`
   * itself — e.g. `sourceUrl` was Akamai-blocked, so a cashback/coupon
   * aggregator page for the same brand was scanned instead. `sourceUrl`
   * stays the URL the user actually asked about; `via.url` is what was
   * really fetched. `via.note` is a caveat to show alongside the result
   * (aggregator figures may be typical/stale rather than live — verify at
   * checkout).
   */
  via?: { url: string; label: string; note: string };
}

/**
 * Machine-readable reason code accompanying every scan-route error response,
 * alongside the existing human-readable `error` string. Consumers (the
 * DiscountSection UI) branch on this instead of pattern-matching `error` text.
 */
export type DiscountScanErrorReason =
  | "bot_protected"
  | "corporate_redirect"
  | "thin_content"
  | "fetch_failed"
  | "invalid_url"
  | "private_url"
  | "no_ai"
  | "quota"
  | "ai_failed"
  /** Pasted `pageContent` exceeded the 400,000-character cap. */
  | "content_too_large"
  /** Pasted `pageContent` yielded under 100 chars of usable text (mirrors "thin_content" for the paste path). */
  | "empty_content";
