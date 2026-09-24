/**
 * Embedded promotional-text extraction for the Discount Sale scanner.
 *
 * Some storefronts (e.g. hk.puma.com, an 91app/NineYi build) render their
 * banner copy from a JSON state blob bootstrapped inside an inline
 * `<script>` — not from visible markup at all. extractTextFromHtml()
 * (src/lib/ai/html.ts) strips every `<script>` block wholesale (it has to:
 * the vast majority of script content is noise — analytics config, tracking
 * pixels, huge product catalogs), so a page whose ONLY promo text lives in
 * that JSON reads as near-empty and gets misreported as JS-rendered
 * (thin_content), even though a plain server-side GET saw the real HTML.
 *
 * This module re-scans the raw HTML's inline scripts (regex only — nothing
 * here is ever executed, eval'd, or parsed as a DOM) for JSON string
 * literals that look promotional, so that text can be appended to the AI
 * prompt alongside the normal tag-stripped text. It is deliberately
 * conservative: a string only survives if it matches a known "this is a
 * promo banner" key (high-confidence) or contains one of a short list of
 * concrete discount markers (折 / % off / 減$ / 滿$ / sale / 優惠 / promo
 * code / ...). This keeps a script full of thousands of plain product names
 * from polluting the prompt — see the noise-rejection test.
 */

/** Matches every inline (or external) `<script>` tag, capturing its attributes and body. */
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
/** An external script (`src="..."`) has no inline body worth scanning. */
const SRC_ATTR_RE = /\ssrc\s*=/i;

// Known "this holds banner/announcement copy" keys, nested one level deep
// under a `"text"` field — the shape 91app/NineYi storefronts use:
// `"topMessageData":{"text":"...",...}`. `[^{}]*?` deliberately refuses to
// cross into a NESTED object, so this only matches genuinely flat banner
// records, not an arbitrary deeply-nested blob that happens to contain a
// "text" key somewhere inside it.
const PRIORITY_NESTED_KEY_RE =
  /"(?:topMessageData|bannerData|promotionData|announcementData|marqueeData)"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:\\.|[^"\\]){1,300})"/gi;

// Known banner/announcement keys holding the string directly.
const PRIORITY_FLAT_KEY_RE =
  /"(?:promotion|promoText|promoMessage|announcement|announcementText|banner|bannerText|marquee|marqueeText|topMessage)"\s*:\s*"((?:\\.|[^"\\]){1,300})"/gi;

// Any JSON string literal, 4–200 raw (still-escaped) chars — the generic
// scan candidate pool, further filtered by PROMO_CONTENT_RE below.
const STRING_LITERAL_RE = /"((?:\\.|[^"\\]){4,200})"/g;

// Concrete discount markers — same spirit as DISCOUNT_KEYWORDS in links.ts,
// but tighter: this gates which of MANY string literals in a state blob are
// worth surfacing, so it favours precision (miss a borderline string) over
// recall (never let "offset"/"office" match "off").
const PROMO_CONTENT_RE =
  /折|%\s*off\b|%OFF|OFF%|減\s*\$|滿\s*\$|HK\$\s*\d+[^"\\]{0,15}(?:off|save|減)|\bsale\b|優惠|促銷|清貨|特價|限時|低至|\bpromo\s*code\b|\bcode[:：]\s*[A-Z0-9]{3,15}\b/i;

/** Cap on how many lines get surfaced — keeps a busy state blob from flooding the prompt. */
const MAX_LINES = 60;
/** Cap on total characters across all surfaced lines. */
const MAX_TOTAL_CHARS = 6000;
/** Per-script cap on how much raw text gets regex-scanned — bounds a pathologically huge inline blob. */
const MAX_SCRIPT_SCAN_CHARS = 500_000;

export const EMBEDDED_PROMO_HEADING = "Promotional text embedded in the page data:";

/** Decodes a JSON string literal's body (handles \uXXXX, \", \\, emoji surrogate pairs, ...). */
function decodeJsonStringLiteral(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    // Malformed escape (e.g. a stray backslash not from real JSON) — fall
    // back to the raw text rather than dropping it.
    return raw;
  }
}

/**
 * Normalises, length-gates, dedupes, and (for the generic pool) content-gates
 * a candidate string literal before it's added to `bucket`.
 */
function tryAdd(rawLiteral: string, bucket: string[], seen: Set<string>, requirePromoMatch: boolean): void {
  const decoded = decodeJsonStringLiteral(rawLiteral).replace(/\s+/g, " ").trim();
  if (decoded.length < 4 || decoded.length > 200) return;
  // Reject anything that still looks like raw JSON/JS structure rather than
  // prose — seen live on double-JSON-encoded state blobs (e.g. a
  // React-Server-Components push stream), where the inner quotes are
  // escaped (`\"`) and STRING_LITERAL_RE's `\\.` alternative happily treats
  // them as ordinary characters, so the "string literal" it thinks it found
  // actually spans several real key/value pairs (e.g.
  // `,"title":"精選優惠"},{"id":-1,...}]`). No genuine promo banner string
  // contains raw `{}[]` — reject on sight instead of surfacing the noise.
  if (/[{}[\]]/.test(decoded)) return;
  if (requirePromoMatch && !PROMO_CONTENT_RE.test(decoded)) return;
  const key = decoded.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  bucket.push(decoded);
}

/**
 * Scans `html`'s inline `<script>` bodies for promotional string literals —
 * known banner/announcement keys first (priority), then any other quoted
 * string matching a concrete discount marker. Returns a deduped, capped list
 * of decoded lines (possibly empty). Never executes or parses the script as
 * code — everything here is regex over the raw text.
 */
export function extractEmbeddedPromoLines(html: string): string[] {
  const priority: string[] = [];
  const general: string[] = [];
  const seen = new Set<string>();

  SCRIPT_RE.lastIndex = 0;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = SCRIPT_RE.exec(html))) {
    if (priority.length + general.length >= MAX_LINES) break;

    const [, attrs, body] = scriptMatch;
    if (SRC_ATTR_RE.test(attrs) || !body || !body.trim()) continue;
    const scanText = body.length > MAX_SCRIPT_SCAN_CHARS ? body.slice(0, MAX_SCRIPT_SCAN_CHARS) : body;

    PRIORITY_NESTED_KEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (priority.length < MAX_LINES && (m = PRIORITY_NESTED_KEY_RE.exec(scanText))) {
      tryAdd(m[1], priority, seen, false);
    }
    PRIORITY_FLAT_KEY_RE.lastIndex = 0;
    while (priority.length < MAX_LINES && (m = PRIORITY_FLAT_KEY_RE.exec(scanText))) {
      tryAdd(m[1], priority, seen, false);
    }

    if (priority.length + general.length >= MAX_LINES) continue;

    STRING_LITERAL_RE.lastIndex = 0;
    while (priority.length + general.length < MAX_LINES && (m = STRING_LITERAL_RE.exec(scanText))) {
      tryAdd(m[1], general, seen, true);
    }
  }

  const combined = [...priority, ...general];
  const capped: string[] = [];
  let total = 0;
  for (const line of combined) {
    if (total + line.length > MAX_TOTAL_CHARS) break;
    capped.push(line);
    total += line.length;
  }
  return capped;
}

/**
 * Formats extracted lines as an appendable text block, headed clearly so the
 * AI (and a human reading the prompt in logs) can tell this text came from
 * page-data JSON, not visible copy. Returns "" when `lines` is empty so
 * callers can unconditionally concatenate the result.
 */
export function formatEmbeddedPromoBlock(lines: string[]): string {
  if (lines.length === 0) return "";
  return `\n\n${EMBEDDED_PROMO_HEADING}\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
