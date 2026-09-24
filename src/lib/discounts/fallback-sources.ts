/**
 * Static host → fallback-source map for the Discount Sale scanner. Some
 * retailers can't be read server-side at all no matter what this codebase
 * does (adidas.com/.hk and fanatics.com sit behind Akamai Bot Manager — see
 * src/lib/discounts/blocked.ts's module doc), and hk.puma.com's real store
 * sometimes still yields no concrete offers even once its page data is
 * readable. Rather than dead-ending, the scan route falls back to a
 * server-fetchable page that reliably carries the same brand's current
 * promo — a cashback/coupon aggregator, or (for puma) the actual regional
 * storefront when the corporate site redirected away from it.
 *
 * This is intentionally a small, hand-curated, static table — NOT a
 * search/discovery mechanism — every URL here was verified server-fetchable
 * with real offer text at investigation time. See DiscountScanResult.via for
 * how the route surfaces which fallback (if any) produced a result.
 */

export interface FallbackSource {
  /** Fully-qualified http(s) URL of the fallback page to scan instead. */
  url: string;
  /** Short human label for the source, shown to the user via DiscountScanResult.via.label. */
  label: string;
  /** Caveat shown alongside the result — aggregator figures may be stale/typical, not live. */
  note: string;
}

const AGGREGATOR_NOTE =
  "This figure comes from a cashback/coupon aggregator, not the retailer's own page (which blocks automated access) — it may be a typical/recent offer rather than what's live right now. Check the exact terms at checkout.";

const REGIONAL_STORE_NOTE =
  "The requested site redirected to a corporate/investor page with no shop content — this is the brand's actual Hong Kong storefront instead.";

/**
 * Host → ordered list of fallback sources, first = tried first. Only ONE
 * fallback is ever scanned per request (see the scan route) — the array
 * shape is kept for future ordering flexibility, not to chain multiple
 * fallback attempts in one call.
 */
const FALLBACK_SOURCES: Record<string, FallbackSource[]> = {
  "fanatics.com": [
    {
      url: "https://www.coupons.com/coupon-codes/fanatics",
      label: "Coupons.com — Fanatics",
      note: AGGREGATOR_NOTE,
    },
  ],
  "www.fanatics.com": [
    {
      url: "https://www.coupons.com/coupon-codes/fanatics",
      label: "Coupons.com — Fanatics",
      note: AGGREGATOR_NOTE,
    },
  ],
  "adidas.com.hk": [
    { url: "https://www.shopback.com.hk/adidas", label: "ShopBack HK — adidas", note: AGGREGATOR_NOTE },
  ],
  "www.adidas.com.hk": [
    { url: "https://www.shopback.com.hk/adidas", label: "ShopBack HK — adidas", note: AGGREGATOR_NOTE },
  ],
  "adidas.com": [
    { url: "https://www.shopback.com.hk/adidas", label: "ShopBack HK — adidas", note: AGGREGATOR_NOTE },
  ],
  "www.adidas.com": [
    { url: "https://www.shopback.com.hk/adidas", label: "ShopBack HK — adidas", note: AGGREGATOR_NOTE },
  ],
  // The real regional storefront — hk.puma.com's own page data is usually
  // readable now (see src/lib/discounts/embedded.ts), so this only fires
  // when the primary scan is blocked/thin OR comes back with zero offers.
  "hk.puma.com": [
    { url: "https://www.shopback.com.hk/puma", label: "ShopBack HK — PUMA", note: AGGREGATOR_NOTE },
  ],
  "puma.com": [
    { url: "https://www.shopback.com.hk/puma", label: "ShopBack HK — PUMA", note: AGGREGATOR_NOTE },
  ],
  // www.puma.com's corporate_redirect lands on about.puma.com (no shop
  // content) — the fix here is the REAL regional store, not an aggregator.
  "www.puma.com": [
    { url: "https://hk.puma.com/", label: "PUMA Hong Kong (regional store)", note: REGIONAL_STORE_NOTE },
  ],
};

/** Returns the ordered fallback sources configured for `hostname` (case-insensitive), or []. */
export function getFallbackSources(hostname: string): FallbackSource[] {
  return FALLBACK_SOURCES[hostname.toLowerCase()] ?? [];
}
