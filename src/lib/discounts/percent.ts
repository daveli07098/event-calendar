/**
 * Normalises "percent off" values for the Discount Sale scanner.
 *
 * Chinese retail uses "N折" to mean "pay N/10 of the price" — the opposite
 * sense of a Western "% off". The AI regularly mistranslates this (e.g.
 * rendering "低至3折" as "30% OFF" instead of "up to 70% off"). When a 折
 * token is present anywhere in the raw value or its context, it WINS over
 * whatever number the AI returned, because that's exactly the bug this
 * module exists to fix.
 */

// Matches "3折", "85折", "8.5折" — one or two digits, optional one decimal.
const ZHE_RE = /(\d{1,2}(?:\.\d)?)\s*折/;

// "低至"/"最低" (Chinese) and "up to"/"as low as" (English) mean the stated
// number is a ceiling on a range, not a flat rate — but ONLY when the marker
// sits immediately before the number it qualifies (just whitespace between).
// A marker elsewhere in the string — e.g. "最低消費$500 ... 全場85折" — is
// unrelated ("minimum spend") and must NOT trigger the prefix.
const UP_TO_ZHE_RE = /(?:低至|最低|up to|as low as)\s*\d{1,2}(?:\.\d)?\s*折/i;
const UP_TO_PERCENT_RE = /(?:低至|最低|up to|as low as)\s*\d{1,2}(?:\.\d)?\s*%/i;

/** Converts a 折 number (e.g. 3, 85, 8.5) to the equivalent "% off" integer. */
function zheToPercentOff(n: number): number {
  // 10 <= n < 100 is already "out of 100" (e.g. 85折 == 8.5折 == pay 85%).
  const payFraction = n < 10 ? n * 10 : n;
  return Math.round(100 - payFraction);
}

/** Finds a 折 token in a string and returns its "% off" number, or null. */
function extractZheOff(s: string): number | null {
  const match = ZHE_RE.exec(s);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return null;
  // "10折" means paying 10/10 of the price — full price, i.e. NOT a
  // discount — never a 90%-off deal. Treat it (and, defensively, any other
  // n that resolves to a non-positive "% off") as "no discount here".
  if (n === 10) return null;
  const off = zheToPercentOff(n);
  if (off <= 0) return null;
  return off;
}

/**
 * Normalises a discount percent value. `raw` is the AI-returned percent
 * string for this offer/headline; `context` is other text (detail/label, or
 * discountSummary/title for the headline) to search for a 折 token when
 * `raw` itself doesn't contain one — the AI often puts the 折 phrase in the
 * surrounding text but a mistranslated "%" number in the percent field.
 *
 * The "up to " prefix is applied when a ceiling marker sits immediately
 * before the 折 number in whichever string it was matched from, OR — when
 * the 折 was found in `context` rather than `raw` — when `raw` itself has a
 * marker immediately before its own "%" number (the AI sometimes splits
 * "低至X%" into the raw percent field and the "N折" phrase into a separate
 * detail/label string).
 *
 * When `raw` itself contains a 折 token that turns out to be invalid/no-op
 * (currently just "10折" — full price), `raw` is NOT a plain percent string
 * to pass through verbatim, so the result is null rather than "10折".
 */
export function normalizeDiscountPercent(
  raw: string | null,
  context: readonly string[]
): string | null {
  const rawHasZheToken = Boolean(raw && ZHE_RE.test(raw));

  if (raw) {
    const off = extractZheOff(raw);
    if (off !== null) {
      const upTo = UP_TO_ZHE_RE.test(raw);
      return `${upTo ? "up to " : ""}${off}%`;
    }
  }

  for (const c of context) {
    if (!c) continue;
    const off = extractZheOff(c);
    if (off !== null) {
      const upTo = UP_TO_ZHE_RE.test(c) || (raw ? UP_TO_PERCENT_RE.test(raw) : false);
      return `${upTo ? "up to " : ""}${off}%`;
    }
  }

  if (rawHasZheToken) return null;

  return raw ? raw.trim() : null;
}
