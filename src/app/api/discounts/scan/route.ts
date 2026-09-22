import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { aiExtractJson, hasAiProvider } from "@/lib/ai/client";
import { safeFetch, assertPublicUrl, UnsafeUrlError } from "@/lib/safe-fetch";
import {
  AI_DAILY_LIMIT,
  checkRemainingAiLimit,
  incrementAiLimit,
  remainingAiCalls,
  getResetAt,
} from "@/lib/ai/quota";
import { extractTextFromHtml } from "@/lib/ai/html";
import type { DiscountOffer, DiscountScanResult, DiscountItem, DiscountScanErrorReason } from "@/lib/discounts/types";
import { extractLinksFromHtml, selectDiscountCandidates, matchItemLink, DISCOUNT_KEYWORDS, type CandidateLink } from "@/lib/discounts/links";
import { normalizeDiscountPercent } from "@/lib/discounts/percent";
import { detectBlockReason } from "@/lib/discounts/blocked";
import { filterConcreteOffers, applyConcretenessGate } from "@/lib/discounts/offers";
import { looksLikeHtml, prioritizeAndTruncate } from "@/lib/discounts/text";

/** Hard cap on pasted `pageContent` — see the `pageContent` request field below. */
const MAX_PASTED_CONTENT_CHARS = 400_000;

// Re-exported so existing importers of the old locally-declared types keep working.
export type { DiscountOffer, DiscountScanResult };

/** JSON error response with both a human `error` string and a machine `reason`. */
function errorResponse(error: string, reason: DiscountScanErrorReason, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, reason, ...extra }, { status });
}

/** Best-effort hostname for an error message — falls back to the raw string on a malformed URL. */
function safeHost(urlStr: string): string {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return urlStr;
  }
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Accepts an AI-returned date only when it's a real calendar date in strict
 * "YYYY-MM-DD" form — anything else ("Ongoing", "TBD", "Sept 2026", or a
 * non-existent date like "2026-02-30") becomes null. The client persists
 * whatever this returns straight into localStorage and feeds it to
 * `Intl.DateTimeFormat`, which throws a RangeError on an Invalid Date — a
 * loose value here would crash-loop the whole Discount Sale section on every
 * mount of an already-saved result.
 */
function isoDateOnly(v: string | null): string | null {
  if (!v) return null;
  const m = ISO_DATE_RE.exec(v);
  if (!m) return null;
  const [, yStr, moStr, dStr] = m;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  // Reject dates that don't round-trip (e.g. "2026-02-30") rather than
  // trusting `new Date()`'s lenient month/day overflow rollover.
  const date = new Date(Date.UTC(y, mo - 1, d));
  const isReal = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return isReal ? v : null;
}

/** Normalises a string for exact-duplicate comparison: trim, lowercase, collapse internal whitespace. */
function dedupeKeyPart(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Drops offers that exactly duplicate an earlier one once label/detail/
 * discountPercent/promoCode are normalised — the AI sometimes restates the
 * same promotion twice (once per section/language of the page, or with only
 * whitespace/casing differences) instead of merging them into one entry.
 */
function dedupeOffers(offers: readonly DiscountOffer[]): DiscountOffer[] {
  const seen = new Set<string>();
  return offers.filter((o) => {
    const key = [o.label, o.detail, o.discountPercent, o.promoCode].map(dedupeKeyPart).join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Same idea as dedupeOffers() — DiscountItem has no separate "title" field, so name + url is the key. */
function dedupeItems(items: readonly DiscountItem[]): DiscountItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = [it.name, it.url].map(dedupeKeyPart).join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Builds the honest, non-retryable error response for a detected block reason. */
function blockErrorResponse(reason: "bot_protected" | "corporate_redirect", url: string, finalUrl: string) {
  if (reason === "bot_protected") {
    return errorResponse(
      "This site blocks automated access, so it can't be read from a server. Open it yourself, copy the page, and use Paste page.",
      reason,
      422
    );
  }
  const requestedHost = safeHost(url);
  const finalHost = safeHost(finalUrl);
  return errorResponse(
    `${requestedHost} redirects to a corporate site (${finalHost}) with no shop content — use the regional store URL instead (e.g. hk.puma.com).`,
    reason,
    422
  );
}

const DISCOUNT_PROMPT = (
  text: string,
  url: string,
  candidatesBlock: string
) => `You are a precise retail-deals analyst. Analyze the text of an e-commerce page and extract ALL active sale/discount promotions with supporting evidence.

Return ONLY a JSON object with this exact shape:
{
  "hasDiscount": boolean,
  "confidence": "high"|"medium"|"low",
  "title": string|null,
  "discountSummary": string|null,
  "discountPercent": string|null,
  "promoCode": string|null,
  "startDate": "YYYY-MM-DD"|null,
  "endDate": "YYYY-MM-DD"|null,
  "categories": string[],
  "url": number|null,
  "offers": [{ "label": string, "detail": string|null, "discountPercent": string|null, "promoCode": string|null, "minSpend": string|null, "audience": "all"|"members"|"new"|null, "url": number|null }],
  "evidence": string[],
  "items": [{ "name": string, "price": string|null, "originalPrice": string|null }]
}

Rules:
- "hasDiscount": true ONLY for explicit promotions (e.g. "Up to 50% off", "低至2折", clearance/outlet pricing, promo codes, "滿$900減$50"). Generic marketing ("Shop new arrivals", "Free shipping") is NOT a discount on its own.
- A navigation link or menu entry pointing at a "Sale"/"Outlet" section (e.g. anchor text "Sale Shoes", a footer link to /outlet) is NOT by itself an offer — links are navigation, not promotions. An offer requires a CONCRETE CLAIM stated in the page TEXT: a percentage off, a 折 number, a price shown next to a crossed-out was-price, a fixed money-off amount, or a promo code. Evergreen programmes ("Student Discount", "Military Discount", "Member pricing") only count as an offer when the page states the actual amount (e.g. "Students save 10%") — a bare link/heading naming the programme with no amount is NOT an offer. Every offer's claim must be quoted verbatim in "evidence". If nothing concrete exists anywhere on the page, return "hasDiscount": false and "offers": [].
- "confidence": "high" when the page clearly headlines a sale with concrete numbers/codes; "medium" when a deal is present but vague; "low" when only weak hints.
- "title": short promotion name in the site's own wording (e.g. "618 Mid-Year Sale", "End of Season Sale").
- "discountSummary": one punchy line capturing the headline deal.
- "discountPercent": the single best headline number, e.g. "50%", "20–60%", "as low as 20%". Must be percent OFF. Chinese N折 means paying N/10 of the price: 3折 = "70%", 85折 = "15%", 低至3折 = "up to 70%". Never report the raw N折 number as if it were the percent off.
- "categories": product groups on sale (e.g. ["Running shoes","Apparel"]). [] if not stated.
- "offers": EVERY distinct promotion as a separate entry — do not merge them. Capture minSpend (e.g. "$900") and audience (members/new-customer offers vs everyone).
- "evidence": 2-5 SHORT EXACT quotes copied verbatim from the page text that prove each deal (this is the "why"). e.g. ["618年中激賞低至2折","CODE: 618SALE","全單滿$900即減$50"]. Never invent — quote only what appears in the text.
- "promoCode"/"startDate"/"endDate": only when explicitly present; otherwise null.
- "items": up to 5 notable discounted products with prices when listed, else [].
- "url" (top-level, for the headline promotion) and "url" (per-offer): the NUMBER of the matching entry from the "Links on the page" list below, when that offer plainly has its own collection/landing page. Only use an index from the list; never invent URLs. Storewide or payment-method offers with no dedicated page get null.
- Match the page's language (Chinese/English) in all text fields.

Source URL: ${url}

${candidatesBlock}

Page text:
${text}`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uid = session.user.id;

  let body: { url?: string; pageContent?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", "invalid_url", 400);
  }

  const { url, pageContent } = body;
  if (!url || typeof url !== "string") {
    return errorResponse("url is required", "invalid_url", 400);
  }

  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return errorResponse("Invalid URL", "invalid_url", 400);
  }

  // Optional pasted page content: some sites — adidas.com/.hk, fanatics.com —
  // block server-side fetches outright (bot protection), and others
  // (hk.puma.com) are client-rendered so a fetch sees almost none of the
  // real page. The user's own browser is the one thing that reliably sees
  // the rendered page, so this lets them paste it in instead. Present and
  // non-blank means "skip the network entirely" for the rest of this
  // handler. Whitespace-only `pageContent` is treated as absent and falls
  // through to the normal fetch path below.
  const pastedContent =
    typeof pageContent === "string" && pageContent.trim() !== "" ? pageContent : null;

  if (pastedContent === null) {
    // Block private network requests (SSRF protection) — see
    // src/lib/safe-fetch.ts. Only relevant on the fetch path: the pasted-
    // content path never makes a request, so there's nothing to validate.
    try {
      await assertPublicUrl(url);
    } catch {
      return errorResponse("Private URLs are not allowed", "private_url", 400);
    }
  } else if (pastedContent.length > MAX_PASTED_CONTENT_CHARS) {
    // Reject oversized pastes up front — before the AI-provider/quota checks
    // below, so a too-large paste doesn't cost a DB round-trip (and a
    // no-provider deployment still answers 413, not 503, for it).
    return errorResponse(
      `Pasted content is too large (max ${MAX_PASTED_CONTENT_CHARS.toLocaleString()} characters) — copy a smaller section of the page.`,
      "content_too_large",
      413
    );
  }

  if (!hasAiProvider()) {
    return errorResponse("No AI provider configured — discount scanning requires AI", "no_ai", 503);
  }
  if (!(await checkRemainingAiLimit(uid))) {
    return errorResponse(`Daily AI limit reached (${AI_DAILY_LIMIT}/day)`, "quota", 429, {
      resetAt: getResetAt(),
    });
  }

  let allLinks: CandidateLink[] = [];
  let candidates: CandidateLink[] = [];
  let pageText: string;

  if (pastedContent !== null) {
    // Pasted-content path: nothing was fetched, so there's no HTTP status or
    // response body for detectBlockReason() to run against — the user's own
    // browser already got past whatever bot-protection/JS-rendering blocks
    // the server, so there's no block page to detect here.
    //
    // Detect whether the paste is HTML (deep-linkable, same extraction path
    // as a fetched page) or plain visible text (e.g. copied straight out of
    // a rendered page with no markup) — see looksLikeHtml() for why a stray
    // "<"/">" in ordinary text doesn't get misclassified as markup.
    if (looksLikeHtml(pastedContent)) {
      // Extract links from the RAW pasted html (extractTextFromHtml strips
      // all tags, including <nav>, so this must run first) so the AI can
      // point at a real on-page URL instead of inventing one — identical to
      // the fetch path below, just against pasted markup instead of a fetch
      // response body.
      allLinks = extractLinksFromHtml(pastedContent, url);
      candidates = selectDiscountCandidates(allLinks, url);
      pageText = extractTextFromHtml(pastedContent, DISCOUNT_KEYWORDS);
    } else {
      // Plain-text paste: no markup to extract links from, so allLinks/
      // candidates stay empty and every "url" field below resolves to
      // null — but it still gets the same keyword-priority truncation the
      // fetch path applies to HTML-derived text (see prioritizeAndTruncate),
      // so promo-relevant lines survive the 8000-char cap.
      pageText = prioritizeAndTruncate(pastedContent.trim(), DISCOUNT_KEYWORDS, 8000);
    }

    if (pageText.length < 100) {
      // Mirrors the fetch path's "thin_content" floor below, but aimed at a
      // paste: the fix is to go copy more of the page, not try another URL.
      console.warn(`[discounts/scan] pasted content too thin: ${url} → ${pageText.length} chars`);
      return errorResponse(
        "That paste doesn't have enough text to scan. Go back to the page, copy it again — including the promotion/sale text — and paste the full content in.",
        "empty_content",
        422
      );
    }

    console.log(`[discounts/scan] pasted content: ${url} → ${pastedContent.length} chars`);
  } else {
    // Fetch the page server-side. Browser-like UA — large retail sites
    // (Nike/adidas) reject obvious bot user agents. NOTE: deliberately NOT
    // adding full Chrome sec-ch-ua/sec-fetch-* headers — empirically, on sites
    // behind Akamai Bot Manager (adidas.com, adidas.com.hk, fanatics.com) that
    // flips the status from 403 to 200 but the body is still the ~2.5KB
    // JS-sensor block page, just harder to detect. detectBlockReason() below
    // catches that case by body shape instead of chasing headers.
    let html: string;
    let finalUrl: string;
    try {
      // SSRF guard: resolves + validates the hostname (and every redirect hop)
      // before fetching — see src/lib/safe-fetch.ts.
      const fetchRes = await safeFetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en,zh-HK;q=0.9,zh;q=0.8",
        },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      finalUrl = fetchRes.finalUrl;
      html = await fetchRes.text();
      if (!fetchRes.ok) {
        // 403/429 here usually means bot protection (Akamai/Cloudflare) on the
        // retailer, not a bug — log it so it's visible in the server console.
        console.warn(`[discounts/scan] fetch blocked: ${url} → HTTP ${fetchRes.status}`);
        const reason = detectBlockReason(fetchRes.status, html, finalUrl, url);
        if (reason) return blockErrorResponse(reason, url, finalUrl);
        return errorResponse(`Could not fetch site (HTTP ${fetchRes.status})`, "fetch_failed", 422);
      }
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return errorResponse("Private URLs are not allowed", "private_url", 400);
      }
      const msg = err instanceof Error ? err.message : "Fetch failed";
      console.warn(`[discounts/scan] fetch error: ${url} → ${msg}`);
      return errorResponse(`Could not fetch site: ${msg}`, "fetch_failed", 422);
    }

    // Same block detection on the OK-but-suspicious path: sites behind Akamai
    // Bot Manager return 200 with a spoofed Chrome UA, but the body is still
    // the tiny JS-sensor stub — must not be sent to the AI as real content.
    // Also catches a 200 that's actually a corporate/investor-site redirect
    // (e.g. www.puma.com → about.puma.com has no shop content).
    const blockReason = detectBlockReason(200, html, finalUrl, url);
    if (blockReason) {
      console.warn(`[discounts/scan] ${blockReason} served as 200: ${url} → ${finalUrl}`);
      return blockErrorResponse(blockReason, url, finalUrl);
    }

    // Extract links from the RAW html (extractTextFromHtml strips all tags,
    // including <nav>, so this must run first) so the AI can point at a real
    // on-page URL instead of inventing one.
    allLinks = extractLinksFromHtml(html, url);
    candidates = selectDiscountCandidates(allLinks, url);
    pageText = extractTextFromHtml(html, DISCOUNT_KEYWORDS);
    if (pageText.length < 100) {
      console.warn(`[discounts/scan] thin content: ${url} → ${pageText.length} chars (likely JS-rendered)`);
      return errorResponse(
        "This site builds its pages with JavaScript, so a server-side fetch sees no promotion text. Try a specific sale/landing page URL, or use Paste page.",
        "thin_content",
        422
      );
    }
  }

  const candidatesBlock =
    candidates.length > 0
      ? `Links on the page (use the number as "url" when an offer plainly has its own page; otherwise null):\n${candidates
          .map((c, i) => `[${i}] ${c.text || "(no text)"} → ${c.href}`)
          .join("\n")}`
      : `Links on the page: none found — every "url" field must be null.`;

  try {
    const { data, provider, tokensUsed } = await aiExtractJson(DISCOUNT_PROMPT(pageText, url, candidatesBlock));
    console.log(`[discounts/scan] ${url} → provider=${provider} tokens=${tokensUsed ?? "n/a"} hasDiscount=${Boolean(data.hasDiscount)}`);
    await incrementAiLimit(uid);
    const remaining = await remainingAiCalls(uid);

    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    const strArr = (v: unknown, max: number): string[] =>
      Array.isArray(v)
        ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, max)
        : [];
    const audienceOf = (v: unknown): DiscountOffer["audience"] =>
      v === "all" || v === "members" || v === "new" ? v : null;
    const confidenceOf = (v: unknown): DiscountScanResult["confidence"] =>
      v === "high" || v === "medium" || v === "low" ? v : null;
    // The AI may only point at a link WE gave it, by index — never accept a
    // string/URL from it directly. Anything that isn't an integer in range
    // resolves to null.
    const urlOf = (v: unknown): string | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v < candidates.length
        ? candidates[v].href
        : null;

    const evidence = strArr(data.evidence, 6);
    const rawOffers: DiscountOffer[] = Array.isArray(data.offers)
      ? (data.offers as Array<Record<string, unknown>>)
          .slice(0, 8)
          .map((o) => ({
            label: String(o.label ?? "").trim(),
            detail: str(o.detail),
            discountPercent: normalizeDiscountPercent(str(o.discountPercent), [str(o.detail), str(o.label)].filter((s): s is string => Boolean(s))),
            promoCode: str(o.promoCode),
            minSpend: str(o.minSpend),
            audience: audienceOf(o.audience),
            url: urlOf(o.url),
          }))
          .filter((o) => o.label)
      : [];
    // Drop offers with no concrete backing claim (digit/折/promo code) — the
    // AI sometimes manufactures "offers" from nav-link labels alone (e.g.
    // nike.com's "Sale Shoes", "Student Discount" menu entries with no
    // percentage/code/price anywhere on the page). See lib/discounts/offers.ts.
    const offers = dedupeOffers(filterConcreteOffers(rawOffers, evidence));
    const items: DiscountItem[] = dedupeItems(
      Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
            .slice(0, 5)
            .map((it) => ({
              name: String(it.name ?? "").trim(),
              price: str(it.price),
              originalPrice: str(it.originalPrice),
              url: null as string | null,
            }))
            .filter((it) => it.name)
            .map((it) => ({ ...it, url: matchItemLink(it.name, allLinks) }))
        : []
    );

    const title = str(data.title);
    const discountSummary = str(data.discountSummary);
    const headlineUrl = urlOf(data.url);

    // Headline 折 lookup is scoped to [discountSummary, title] — evidence
    // quotes can belong to a DIFFERENT offer (e.g. a members-only "85折"
    // quote sitting alongside a correct storewide "40%" headline), so
    // evidence is only consulted as a last resort: when the AI gave no
    // headline percent AND neither summary nor title yields a 折 value.
    let discountPercent = normalizeDiscountPercent(
      str(data.discountPercent),
      [discountSummary, title].filter((s): s is string => Boolean(s))
    );
    if (discountPercent === null) {
      // Raw was null AND neither summary nor title yielded a 折 value —
      // fall back to evidence as a last resort.
      discountPercent = normalizeDiscountPercent(null, evidence);
    }

    const rawResult: DiscountScanResult = {
      hasDiscount: Boolean(data.hasDiscount),
      confidence: confidenceOf(data.confidence),
      title,
      discountSummary,
      discountPercent,
      promoCode: str(data.promoCode),
      startDate: isoDateOnly(str(data.startDate)),
      endDate: isoDateOnly(str(data.endDate)),
      categories: strArr(data.categories, 8),
      offers,
      evidence,
      items,
      sourceUrl: url,
      url: headlineUrl ?? offers.find((o) => o.url)?.url ?? null,
      aiUsed: provider,
      tokensUsed,
      fromPastedContent: pastedContent !== null,
    };
    // If every offer got dropped above AND the headline itself has no
    // concrete percent/code, there's nothing left backing hasDiscount: true.
    const result = applyConcretenessGate(rawResult, offers);

    return NextResponse.json({
      result,
      aiQuota: {
        used: AI_DAILY_LIMIT - remaining,
        limit: AI_DAILY_LIMIT,
        remaining,
        resetAt: getResetAt(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI extraction failed";
    // Log the full provider-cascade failure so it's diagnosable in the backend
    // console (e.g. Gemini regional block, expired Copilot token, no Groq key).
    console.error(`[discounts/scan] AI cascade failed for ${url}: ${msg}`);
    return errorResponse(`AI extraction failed: ${msg}`, "ai_failed", 502);
  }
}
