/**
 * Free-text venue matching against the shared `EventVenue` directory.
 *
 * `EventVenue` has no `userId` — it's a shared directory of physical venues — and events
 * only reference a venue by free text (`Event.location`, or a "Venue: ..." line inside
 * `Event.description`). This module is the pure, no-Prisma matching logic: normalize both
 * sides of the comparison the same way, then try an exact segment match before falling back
 * to a conservative substring match. Deliberately conservative, mirroring
 * `venue-seatmap/registry.ts`'s philosophy: a wrong match (e.g. "Kowloon Portal Plaza"
 * matching venue "PORTAL") is worse than no match, so short/single-word keys never match via
 * substring containment.
 */

// CJK ideograph + kana ranges used both to decide whether a key is "pure CJK" (eligible for
// substring containment at a shorter length) and to collapse spaces inserted between CJK
// characters (many Chinese venue names are written with or without a separating space
// interchangeably, e.g. "啟德體育園 主場館" vs "啟德體育園主場館").
const CJK_CHARS = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff";
const CJK_GAP_RE = new RegExp(`(?<=[${CJK_CHARS}])\\s+(?=[${CJK_CHARS}])`, "gu");
const CJK_ONLY_RE = new RegExp(`^[${CJK_CHARS}]+$`, "u");

// Fullwidth + halfwidth punctuation that shows up as separators inside venue names/locations.
// NFKC already folds some fullwidth forms (e.g. "，" → ",") but not all of these (e.g. the
// lenticular brackets 【】 have no compatibility decomposition), so they're normalized
// explicitly here rather than relied on to survive NFKC alone.
const PUNCT_RE = /[()（）[\]【】,，、·・\-–—/|]/g;

/**
 * Normalizes venue-name/location text for comparison: Unicode NFKC, lowercase, fullwidth
 * punctuation → ascii/space, collapse whitespace, and remove spaces between CJK characters
 * so "啟德體育園 主場館" and "啟德體育園主場館" compare equal.
 */
export function normalizeVenueText(s: string): string {
  let out = s.normalize("NFKC").toLowerCase();
  out = out.replace(PUNCT_RE, " ");
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(CJK_GAP_RE, "");
  return out.trim();
}

/**
 * All normalized keys a venue can be recognized by: its normalized name, its normalized
 * aliases, and — for names with a parenthesised part (e.g. "香港體育館 (紅館)") — the
 * parenthesised part on its own ("紅館") and the name with it stripped ("香港體育館"), since
 * both commonly appear alone in the wild.
 */
export function venueKeys(v: { name: string; aliases: string[] }): string[] {
  const keys = new Set<string>();

  const nameKey = normalizeVenueText(v.name);
  if (nameKey) keys.add(nameKey);

  for (const alias of v.aliases) {
    const aliasKey = normalizeVenueText(alias);
    if (aliasKey) keys.add(aliasKey);
  }

  const parenMatch = v.name.match(/[([（]([^)\]）]+)[)\]）]/);
  if (parenMatch) {
    const inner = normalizeVenueText(parenMatch[1]);
    if (inner) keys.add(inner);

    const withoutParen = normalizeVenueText(v.name.replace(/[([（][^)\]）]*[)\]）]/g, ""));
    if (withoutParen) keys.add(withoutParen);
  }

  return Array.from(keys);
}

export interface VenueMatch {
  venueId: string;
  via: "exact" | "alias";
}

interface MatchCandidate {
  venueId: string;
  key: string;
  /** "exact" when this key is literally the venue's normalized name; "alias" otherwise
   * (a declared alias, or a name-derived key like a parenthesised nickname). */
  kind: "exact" | "alias";
}

function isPureCjkKey(key: string): boolean {
  return CJK_ONLY_RE.test(key);
}

function wordCount(key: string): number {
  return key.split(/\s+/).filter(Boolean).length;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches free text (an event's location, or its "Venue: ..." description line) against the
 * shared venue directory.
 *
 * Pass 1: split the text on common separators and look for a segment that, once normalized,
 * equals one of a venue's keys exactly.
 * Pass 2 (only if pass 1 found nothing): look for a key contained anywhere in the whole
 * normalized text, but only for keys specific enough that containment is safe — pure-CJK
 * keys of at least 4 characters, or Latin/mixed keys of at least 2 words or 8 characters,
 * matched on word boundaries so e.g. venue "PORTAL" doesn't match "Kowloon Portal Plaza".
 * Longest matching key wins ties in both passes.
 */
export function matchVenue(
  locationText: string | null | undefined,
  venues: Array<{ id: string; name: string; aliases: string[] }>,
): VenueMatch | null {
  if (!locationText || !locationText.trim()) return null;

  const wholeNormalized = normalizeVenueText(locationText);
  if (!wholeNormalized) return null;

  const segments = locationText
    .split(/[,，;\n]/)
    .map((s) => normalizeVenueText(s))
    .filter(Boolean);

  const candidates: MatchCandidate[] = [];
  for (const v of venues) {
    const nameKey = normalizeVenueText(v.name);
    for (const key of venueKeys(v)) {
      candidates.push({ venueId: v.id, key, kind: key === nameKey ? "exact" : "alias" });
    }
  }

  // Pass 1: exact segment match.
  let best: MatchCandidate | null = null;
  for (const seg of segments) {
    for (const c of candidates) {
      if (c.key === seg && (!best || c.key.length > best.key.length)) {
        best = c;
      }
    }
  }
  if (best) return { venueId: best.venueId, via: best.kind };

  // Pass 2: conservative substring containment.
  let bestContains: MatchCandidate | null = null;
  for (const c of candidates) {
    const { key } = c;
    if (isPureCjkKey(key)) {
      if (key.length < 4) continue;
      if (!wholeNormalized.includes(key)) continue;
    } else {
      if (!(wordCount(key) >= 2 || key.length >= 8)) continue;
      const boundaryRe = new RegExp(`\\b${escapeRegExp(key)}\\b`);
      if (!boundaryRe.test(wholeNormalized)) continue;
    }
    if (!bestContains || key.length > bestContains.key.length) bestContains = c;
  }
  if (bestContains) return { venueId: bestContains.venueId, via: bestContains.kind };

  return null;
}

/**
 * The venue text for an event: the "Venue: ..." line from its description if present
 * (this is what the ticket-scraping flow writes), else its `location` field.
 */
export function extractVenueText(event: { location: string | null; description: string | null }): string | null {
  const fromDesc = event.description?.match(/^Venue:\s*(.+)$/m)?.[1]?.trim();
  if (fromDesc) return fromDesc;
  return event.location?.trim() || null;
}

// Bare city/country names that sometimes end up as an event's whole "venue" text (e.g. a
// scraped ticket page only gave a country, not a venue) — these are not venues themselves
// and shouldn't be reported as unmatched-venue data quality issues.
const PLACEHOLDER_LOCATIONS = new Set(
  [
    "hong kong", "香港", "hk", "kowloon", "九龍",
    "japan", "日本", "tokyo", "東京",
    "taiwan", "台灣", "taipei", "台北",
    "macau", "澳門",
    "singapore", "malaysia", "philippines",
    "korea", "韓國", "首爾", "seoul",
    "china", "中國",
  ].map((s) => normalizeVenueText(s)),
);

// Mirrors the "地點待定" (TBD) filtering already done in GET /api/venues — "待定" as a
// substring covers "地點待定" too, so it isn't listed separately.
const PLACEHOLDER_MARKER_RE = /tbd|tba|待定|coming soon|未定|to be announced/;

/**
 * True when `text` isn't a real venue reference: empty, a bare city/country name (e.g. "Hong
 * Kong"), or a TBD-style placeholder (e.g. "TBD (Coming Soon)"). Used to keep such texts out
 * of the "unmatched" report — they're not a venue we failed to match, they're not a venue at
 * all.
 */
export function isPlaceholderLocation(text: string): boolean {
  const normalized = normalizeVenueText(text);
  if (!normalized) return true;
  if (PLACEHOLDER_LOCATIONS.has(normalized)) return true;
  if (PLACEHOLDER_MARKER_RE.test(normalized)) return true;
  return false;
}
