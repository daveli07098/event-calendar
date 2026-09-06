/**
 * Link extraction/selection for the Discount Sale scanner. The AI is never
 * trusted to author URLs — it can only pick from links that actually
 * appeared on the scanned page (see selectDiscountCandidates + the route's
 * index-mapping), which are extracted here with a plain regex (no DOM lib
 * available server-side).
 */

// Sentences/links containing these terms are prioritised — shared with the
// text-extraction keyword filter in the route (moved here so both the link
// selector and the route can use the same list).
export const DISCOUNT_KEYWORDS =
  /sale|discount|%\s*off|\boff\b|promo|coupon|code|deal|save|clearance|outlet|markdown|折|優惠|減價|特價|清貨|促銷|限時|低至/i;

/** A link found on the scanned page, with its resolved absolute URL. */
export interface CandidateLink {
  href: string;
  text: string;
}

const ANCHOR_RE = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/** Decodes the handful of entities that show up in anchor text, plus numeric refs. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function textOf(innerHtml: string): string {
  const stripped = innerHtml.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(stripped);
  return decoded.replace(/\s{2,}/g, " ").trim().slice(0, 120);
}

/**
 * Extracts every anchor from raw HTML as an absolute http(s) URL + trimmed
 * text. Nav links are deliberately KEPT (unlike extractTextFromHtml, which
 * strips <nav> for the text prompt) because the promo/sale menu often lives
 * there.
 */
export function extractLinksFromHtml(html: string, baseUrl: string): CandidateLink[] {
  const seen = new Map<string, string>();
  let match: RegExpExecArray | null;
  ANCHOR_RE.lastIndex = 0;
  while ((match = ANCHOR_RE.exec(html))) {
    const [, rawHref, innerHtml] = match;
    const href = rawHref.trim();
    if (!href || href.startsWith("#") || /^javascript:/i.test(href) || /^mailto:/i.test(href)) {
      continue;
    }

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(resolved.protocol)) continue;

    resolved.hash = "";
    const key = resolved.toString();
    const text = textOf(innerHtml);

    const existing = seen.get(key);
    if (existing === undefined) {
      seen.set(key, text);
    } else if (!existing && text) {
      // Keep the first non-empty text for a href seen more than once.
      seen.set(key, text);
    }

    if (seen.size >= 400) break;
  }

  return Array.from(seen.entries()).map(([href, text]) => ({ href, text }));
}

/**
 * Narrows the full link list down to plausible discount/promo pages —
 * matched on link text or the URL's path+query — so the prompt only carries
 * a short, relevant candidate list. Same-origin links are listed first.
 */
export function selectDiscountCandidates(
  links: CandidateLink[],
  baseUrl: string,
  max = 40
): CandidateLink[] {
  let origin: string | null = null;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = null;
  }

  const matches = links.filter((link) => {
    if (DISCOUNT_KEYWORDS.test(link.text)) return true;
    try {
      const u = new URL(link.href);
      return DISCOUNT_KEYWORDS.test(u.pathname + u.search);
    } catch {
      return false;
    }
  });

  const sameOrigin: CandidateLink[] = [];
  const other: CandidateLink[] = [];
  for (const link of matches) {
    let linkOrigin: string | null = null;
    try {
      linkOrigin = new URL(link.href).origin;
    } catch {
      linkOrigin = null;
    }
    if (origin && linkOrigin === origin) sameOrigin.push(link);
    else other.push(link);
  }

  return [...sameOrigin, ...other].slice(0, max);
}

/** Normalises text for fuzzy item/link matching: NFKC, lowercase, collapsed spaces. */
function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// Bare brand names that show up as short, generic anchor text (nav/brand-page
// links) — a single word from this list must never, by itself, be treated as
// a specific-enough match for "anchor text is contained in the item name"
// (e.g. anchor "Adidas" must not match item "Adidas Adilette Comfort 2.0
// Argentina Slides 中性拖鞋" just because "adidas" is a substring of it).
const BRAND_WORDS = new Set([
  "adidas", "nike", "hoka", "puma", "asics", "reebok", "salomon", "brooks",
  "saucony", "mizuno", "skechers", "vans", "converse", "fila", "kappa",
  "timberland", "newbalance", "underarmour", "onrunning", "onitsuka",
]);

/**
 * Finds the link whose text best corresponds to a product name — either the
 * link text contains the item name, or (for long item names truncated in
 * link text) the item name contains the link text. Requires at least 6
 * characters of overlap to avoid matching on generic short link text.
 *
 * For the "item name contains the link text" direction specifically, short
 * generic anchors (e.g. a brand-page link whose text is just "Adidas") must
 * NOT count as a match even though they're technically a substring of a
 * longer product name — so that direction additionally requires the anchor
 * text to be either long (≥12 normalized chars) or made of 2+ words none of
 * which is a bare brand name on its own.
 */
export function matchItemLink(name: string, links: CandidateLink[]): string | null {
  const normName = normalize(name);
  if (!normName) return null;

  let best: { href: string; overlap: number } | null = null;
  for (const link of links) {
    const normText = normalize(link.text);
    if (!normText) continue;

    let overlap = 0;
    if (normText.includes(normName)) {
      overlap = normName.length;
    } else if (normName.includes(normText) && normText.length >= 6) {
      const words = normText.split(" ").filter(Boolean);
      const isSpecificEnough =
        normText.length >= 12 || (words.length >= 2 && !words.some((w) => BRAND_WORDS.has(w)));
      if (!isSpecificEnough) continue;
      overlap = normText.length;
    } else {
      continue;
    }

    if (overlap < 6) continue;
    if (!best || overlap > best.overlap) {
      best = { href: link.href, overlap };
    }
  }

  return best ? best.href : null;
}
