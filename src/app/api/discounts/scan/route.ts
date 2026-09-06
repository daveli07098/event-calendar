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
import type { DiscountOffer, DiscountScanResult, DiscountItem } from "@/lib/discounts/types";
import { extractLinksFromHtml, selectDiscountCandidates, matchItemLink, DISCOUNT_KEYWORDS } from "@/lib/discounts/links";
import { normalizeDiscountPercent } from "@/lib/discounts/percent";

// Re-exported so existing importers of the old locally-declared types keep working.
export type { DiscountOffer, DiscountScanResult };

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

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Block private network requests (SSRF protection) — see src/lib/safe-fetch.ts.
  try {
    await assertPublicUrl(url);
  } catch {
    return NextResponse.json({ error: "Private URLs are not allowed" }, { status: 400 });
  }

  if (!hasAiProvider()) {
    return NextResponse.json(
      { error: "No AI provider configured — discount scanning requires AI" },
      { status: 503 }
    );
  }
  if (!(await checkRemainingAiLimit(uid))) {
    return NextResponse.json(
      { error: `Daily AI limit reached (${AI_DAILY_LIMIT}/day)`, resetAt: getResetAt() },
      { status: 429 }
    );
  }

  // Fetch the page server-side. Browser-like UA — large retail sites
  // (Nike/adidas) reject obvious bot user agents.
  let html: string;
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
    if (!fetchRes.ok) {
      // 403/429 here usually means bot protection (Akamai/Cloudflare) on the
      // retailer, not a bug — log it so it's visible in the server console.
      console.warn(`[discounts/scan] fetch blocked: ${url} → HTTP ${fetchRes.status}`);
      const hint = fetchRes.status === 403 ? " — site blocks automated requests" : "";
      return NextResponse.json(
        { error: `Could not fetch site (HTTP ${fetchRes.status})${hint}` },
        { status: 422 }
      );
    }
    html = await fetchRes.text();
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return NextResponse.json({ error: "Private URLs are not allowed" }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : "Fetch failed";
    console.warn(`[discounts/scan] fetch error: ${url} → ${msg}`);
    return NextResponse.json({ error: `Could not fetch site: ${msg}` }, { status: 422 });
  }

  // Extract links from the RAW html (extractTextFromHtml strips all tags,
  // including <nav>, so this must run first) so the AI can point at a real
  // on-page URL instead of inventing one.
  const allLinks = extractLinksFromHtml(html, url);
  const candidates = selectDiscountCandidates(allLinks, url);
  const candidatesBlock =
    candidates.length > 0
      ? `Links on the page (use the number as "url" when an offer plainly has its own page; otherwise null):\n${candidates
          .map((c, i) => `[${i}] ${c.text || "(no text)"} → ${c.href}`)
          .join("\n")}`
      : `Links on the page: none found — every "url" field must be null.`;

  const pageText = extractTextFromHtml(html, DISCOUNT_KEYWORDS);
  if (pageText.length < 100) {
    console.warn(`[discounts/scan] thin content: ${url} → ${pageText.length} chars (likely JS-rendered)`);
    return NextResponse.json(
      { error: "Site returned no readable content (may require JavaScript or block bots)" },
      { status: 422 }
    );
  }

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
    const offers: DiscountOffer[] = Array.isArray(data.offers)
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
    const items: DiscountItem[] = Array.isArray(data.items)
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
      : [];

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

    const result: DiscountScanResult = {
      hasDiscount: Boolean(data.hasDiscount),
      confidence: confidenceOf(data.confidence),
      title,
      discountSummary,
      discountPercent,
      promoCode: str(data.promoCode),
      startDate: str(data.startDate),
      endDate: str(data.endDate),
      categories: strArr(data.categories, 8),
      offers,
      evidence,
      items,
      sourceUrl: url,
      url: headlineUrl ?? offers.find((o) => o.url)?.url ?? null,
      aiUsed: provider,
      tokensUsed,
    };

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
    return NextResponse.json({ error: `AI extraction failed: ${msg}` }, { status: 502 });
  }
}
