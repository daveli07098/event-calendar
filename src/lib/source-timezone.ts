/**
 * Shared source-timezone resolver for ticket scrape/add/update/refix routes.
 *
 * Historically this logic was hardcoded independently in THREE places
 * (`scrape/route.ts`, `refix/route.ts`, and effectively duplicated again as a
 * comment-only stub in `add/route.ts`) as an 8-domain Hong Kong allowlist that
 * returned a static "+08:00" string and `null` for everything else — including
 * Japan, Korea, and all of Europe. That silently starved `add/route.ts`'s
 * otherwise-correct sourceTimezone > tzOffsetMinutes > fallback precedence,
 * so non-HK events fell back to the *client's* timezone instead of the
 * venue's — a real data-corruption bug (see CHANGELOG).
 *
 * This module fixes that by reusing the country knowledge that already exists
 * for two other features, rather than inventing a fourth map:
 *  - `detect-country.ts`'s DOMAIN_COUNTRY / TLD_COUNTRY (domain → country)
 *  - `event-timezone.ts`'s LOCATION_TAG_TIME_ZONE (country → IANA zone)
 *
 * Composing those gets Japan, Korea, Taiwan, Singapore, and more "for free".
 * Crucially, the result is an IANA zone, not a fixed offset — the actual
 * ±HH:MM offset is derived per the *specific event date* via
 * Intl.DateTimeFormat, so DST-observing regions (Europe) resolve correctly
 * instead of being permanently wrong half the year.
 */
import { detectCountry } from "./detect-country";
import { LOCATION_TAG_TIME_ZONE } from "./event-timezone";

// detectCountry's TLD map spells this "UK"; LOCATION_TAG_TIME_ZONE (shared with
// the calendar's venue-time display) spells it "United Kingdom". Alias here
// rather than changing either existing map's keys for an unrelated concern.
const COUNTRY_TO_LOCATION_TAG: Record<string, string> = {
  UK: "United Kingdom",
};

// The original hardcoded 8-domain allowlist, preserved verbatim so these exact
// domains keep resolving to +08:00 byte-for-byte. Two of them (klook.com,
// kktix.com) aren't Hong Kong at all in `detect-country.ts` (klook.com isn't
// mapped there yet; kktix.com is tagged "Taiwan") — folding them in here
// avoids changing detect-country.ts's country-enrichment behavior (a
// different feature, used for the Event `location` field) as a side effect
// of this timezone fix. Hong Kong and Taiwan share the same +08:00 offset
// with no DST, so this is behaviorally identical either way.
const LEGACY_HKT_DOMAINS = [
  "timable.com", "cityline.com", "hkticketing.com", "ticketmaster.com.hk",
  "urbtix.hk", "ticketflap.com", "klook.com", "kktix.com",
];

function legacyZoneForUrl(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (LEGACY_HKT_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))) return "Asia/Hong_Kong";
  } catch { /* ignore invalid URL */ }
  return null;
}

function countryZoneForUrl(url: string): string | null {
  const country = detectCountry(url);
  if (!country) return null;
  return LOCATION_TAG_TIME_ZONE[COUNTRY_TO_LOCATION_TAG[country] ?? country] ?? null;
}

/**
 * Format the ±HH:MM UTC offset for an IANA zone at a given instant, via
 * Intl.DateTimeFormat's "shortOffset" — this is what makes DST correct (a
 * static offset table would be permanently wrong for e.g. Europe/London
 * half the year).
 */
function offsetStringForZoneAt(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  // raw looks like "GMT+8", "GMT+9:30", "GMT-5", or bare "GMT" (UTC).
  const m = raw.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return "+00:00";
  const sign = m[1]!.startsWith("-") ? "-" : "+";
  const hh = String(Math.abs(Number(m[1]))).padStart(2, "0");
  const mm = (m[2] ?? "00").padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * Resolve a ticket source URL's local UTC offset, e.g. "+09:00" for a
 * livenationhip.co.jp show. Returns `null` when the source's country/zone
 * can't be determined — callers should fall back to the client's
 * tzOffsetMinutes (or an explicit tz parsed off JSON-LD) in that case, per
 * the existing sourceTimezone > tzOffsetMinutes > fallback precedence.
 *
 * `eventDate` should be the actual event/sale-window date when known — the
 * offset is DST-sensitive for zones like Europe/London, so "now" (the
 * default) is only a safe stand-in when no event date is available yet.
 */
export function detectTimezoneFromUrl(url: string, eventDate: Date = new Date()): string | null {
  const zone = legacyZoneForUrl(url) ?? countryZoneForUrl(url);
  if (!zone) return null;
  return offsetStringForZoneAt(zone, eventDate);
}
