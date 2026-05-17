/**
 * Country detection for ticket event sources.
 *
 * Priority:
 *  1. Known domain map (fastest, most reliable)
 *  2. TLD-based detection (.jp, .hk, .tw, etc.)
 *  3. AI-extracted country passed as `aiCountry` (already in the scrape prompt)
 *  4. null — no country determined
 *
 * Used by scrape, add, and update routes to enrich the Event `location` field
 * so that calendar entries clearly show the country (e.g. "埼玉県, Japan").
 */

// Specific domains → country (checked before TLD, covers cases like .com sites for a specific country)
const DOMAIN_COUNTRY: Record<string, string> = {
  // Japan
  "collabo-cafe.com": "Japan",
  "eplus.jp": "Japan",
  "pia.jp": "Japan",
  "l-tike.com": "Japan",
  "lawson-ticket.com": "Japan",
  "loppi.jp": "Japan",
  "7ticket.jp": "Japan",
  "ticket.cocacola.jp": "Japan",
  "toho-tix.jp": "Japan",
  "animate.co.jp": "Japan",
  // Hong Kong
  "timable.com": "Hong Kong",
  "cityline.com": "Hong Kong",
  "hkticketing.com": "Hong Kong",
  "ticketmaster.com.hk": "Hong Kong",
  "urbtix.hk": "Hong Kong",
  "ticketflap.com": "Hong Kong",
  // Taiwan
  "kktix.com": "Taiwan",
  "ezding.com.tw": "Taiwan",
  "ibon.com.tw": "Taiwan",
  // South Korea
  "melon.com": "South Korea",
  "interpark.com": "South Korea",
  "yes24.com": "South Korea",
  // Singapore
  "sistic.com.sg": "Singapore",
  "apactix.com": "Singapore",
  // USA / global (no country tag — ambiguous)
  "ticketmaster.com": "",
  "eventbrite.com": "",
  "axs.com": "",
};

// TLD → country (fallback when domain map has no entry)
const TLD_COUNTRY: Record<string, string> = {
  jp: "Japan",
  hk: "Hong Kong",
  tw: "Taiwan",
  kr: "South Korea",
  sg: "Singapore",
  uk: "UK",
  au: "Australia",
  nz: "New Zealand",
  fr: "France",
  de: "Germany",
  cn: "China",
  th: "Thailand",
  my: "Malaysia",
  ph: "Philippines",
  id: "Indonesia",
};

/**
 * Detect the country from a source URL.
 * Returns a country string (e.g. "Japan") or null if undetectable.
 * Returns "" (empty string) for known ambiguous global domains — treat as null.
 */
export function detectCountry(sourceUrl: string): string | null {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");

    // 1. Check known domain map (exact match or subdomain match)
    for (const [domain, country] of Object.entries(DOMAIN_COUNTRY)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return country || null; // empty string means "known ambiguous global"
      }
    }

    // 2. TLD fallback
    const tld = hostname.split(".").pop() ?? "";
    if (TLD_COUNTRY[tld]) return TLD_COUNTRY[tld];
  } catch {
    // Invalid URL — skip
  }
  return null;
}

/**
 * Append country to a raw location string if not already present.
 *
 * @param rawLocation  Combined "venue, city" string (may be null)
 * @param sourceUrl    Event source URL for domain-based detection
 * @param aiCountry    Country returned by AI extraction (used if domain detection fails)
 * @returns            Enriched location string, e.g. "東武動物公園, 埼玉県, Japan"
 */
export function enrichLocationWithCountry(
  rawLocation: string | null,
  sourceUrl: string,
  aiCountry?: string | null,
): string | null {
  const country = detectCountry(sourceUrl) ?? aiCountry ?? null;
  if (!country) return rawLocation || null;

  if (!rawLocation) return country;

  // Don't append if the country (or a close variant) is already in the string
  const lower = rawLocation.toLowerCase();
  if (lower.includes(country.toLowerCase())) return rawLocation;

  // Avoid duplicate "Hong Kong" variants
  if (country === "Hong Kong" && (lower.includes("hong kong") || rawLocation.includes("香港"))) {
    return rawLocation;
  }

  return `${rawLocation}, ${country}`;
}
