/**
 * Detects when a fetched page is actually a bot-protection challenge
 * (Akamai/Cloudflare/PerimeterX/Incapsula) or a corporate redirect away from
 * shop content, rather than real page content — so the scan route can report
 * an honest, non-retryable reason instead of silently feeding a block page
 * to the AI as if it were the retailer's page.
 *
 * Empirically established (see prisma-adjacent task notes, not re-tested
 * here): adidas.com, adidas.com.hk and fanatics.com sit behind Akamai Bot
 * Manager and are unfetchable server-side. Their 403 body carries
 * `"page_owner":"AKAMAI"`, sets `bm_s`/`bm_so` cookies referenced by the
 * sensor script, and serves `/_es_/fo/customdeny/`. Spoofing full Chrome
 * `sec-ch-ua`/`sec-fetch-*` headers flips the status to 200 but returns a
 * ~2.5KB JS-sensor stub — the SAME block page with a different status code —
 * so this module treats a small body matching these markers as blocked
 * regardless of status.
 */

/** Markers that show up in bot-protection challenge/interstitial pages. */
const CHALLENGE_MARKERS: RegExp[] = [
  /page_owner"\s*:\s*"AKAMAI/i,
  /bm_s/, // Akamai's bm_s* sensor cookie family (bm_s, bm_so, bm_sz, bm_sv, bm_ss, ...)
  /customdeny/i, // Akamai's /_es_/fo/customdeny/ deny-page path
  /_Incapsula_/i,
  /cf-browser-verification/i, // Cloudflare's JS challenge
  /Just a moment\.\.\./i, // Cloudflare's challenge interstitial copy
  /Checking your browser/i,
  /Access Denied/i,
  /I am not a robot/i, // reCAPTCHA / PerimeterX challenge copy
];

// Real block/interstitial pages from these vendors are tiny (a few KB of JS
// sensor bootstrap); a genuine product/landing page that happens to contain
// one of these words (e.g. a "Checking your browser" blog post) will be far
// larger, so size-gating avoids false positives on real content.
const MAX_CHALLENGE_BYTES = 8 * 1024;

/** True when `html` is small enough AND matches a known challenge-page marker. */
function looksLikeChallengePage(html: string): boolean {
  if (Buffer.byteLength(html, "utf8") >= MAX_CHALLENGE_BYTES) return false;
  return CHALLENGE_MARKERS.some((re) => re.test(html));
}

/** Hostname prefixes that indicate a corporate/investor site, not a storefront. */
const CORPORATE_HOST_PREFIXES = ["about.", "corporate."];

export type BlockReason = "bot_protected" | "corporate_redirect" | null;

/**
 * Classifies why a fetched page isn't usable as real retail content.
 *
 * - `"bot_protected"`: the response was 403/429 (near-universal bot-block
 *   statuses), OR the body is small and matches a known challenge-page
 *   marker even when the status is 200 (the spoofed-headers case above).
 * - `"corporate_redirect"`: the final URL (after redirects) lands on a
 *   different host than requested, and that host is a corporate/investor
 *   subdomain (e.g. `www.puma.com` → `about.puma.com`) rather than the shop.
 * - `null`: no known block signature detected.
 */
export function detectBlockReason(
  status: number,
  html: string,
  finalUrl: string,
  requestedUrl: string
): BlockReason {
  if (status === 403 || status === 429) return "bot_protected";
  if (looksLikeChallengePage(html)) return "bot_protected";

  try {
    const finalHost = new URL(finalUrl).hostname.toLowerCase();
    const requestedHost = new URL(requestedUrl).hostname.toLowerCase();
    if (finalHost !== requestedHost && CORPORATE_HOST_PREFIXES.some((p) => finalHost.startsWith(p))) {
      return "corporate_redirect";
    }
  } catch {
    // Malformed URL — not a signal we can act on.
  }

  return null;
}
