import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { aiExtractJson, hasAiProvider } from "@/lib/ai/client";
import {
  AI_DAILY_LIMIT,
  checkRemainingAiLimit,
  incrementAiLimit,
  remainingAiCalls,
  getResetAt,
} from "@/lib/ai/quota";
import { extractTextFromHtml } from "@/lib/ai/html";

/** A single distinct promotion found on the page. */
export interface DiscountOffer {
  label: string;                                  // "Storewide sale", "New member offer"
  detail: string | null;                          // "低至2折", "Extra 10% off apparel"
  discountPercent: string | null;                 // "20%", "10%"
  promoCode: string | null;                       // "618SALE"
  minSpend: string | null;                        // "$900", "HK$500"
  audience: "all" | "members" | "new" | null;     // who it applies to
}

/** AI-detected discount/sale promotion on a retail site. */
export interface DiscountScanResult {
  hasDiscount: boolean;
  confidence: "high" | "medium" | "low" | null;   // how clearly the page shows a deal
  title: string | null;
  discountSummary: string | null;
  discountPercent: string | null;                 // headline number
  promoCode: string | null;                       // headline code
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
  categories: string[];                            // what's on sale ("Running shoes")
  offers: DiscountOffer[];                         // all distinct promotions
  evidence: string[];                              // exact phrases proving the deal (the "why")
  items: Array<{ name: string; price: string | null; originalPrice: string | null }>;
  sourceUrl: string;
  aiUsed: string;
  tokensUsed: number | null;
}

// Sentences containing these terms are prioritised before truncation so the
// promotion details survive the text-length limit.
const DISCOUNT_KEYWORDS =
  /sale|discount|%\s*off|\boff\b|promo|coupon|code|deal|save|clearance|outlet|markdown|折|優惠|減價|特價|清貨|促銷|限時|低至/i;

const DISCOUNT_PROMPT = (text: string, url: string) => `You are a precise retail-deals analyst. Analyze the text of an e-commerce page and extract ALL active sale/discount promotions with supporting evidence.

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
  "offers": [{ "label": string, "detail": string|null, "discountPercent": string|null, "promoCode": string|null, "minSpend": string|null, "audience": "all"|"members"|"new"|null }],
  "evidence": string[],
  "items": [{ "name": string, "price": string|null, "originalPrice": string|null }]
}

Rules:
- "hasDiscount": true ONLY for explicit promotions (e.g. "Up to 50% off", "低至2折", clearance/outlet pricing, promo codes, "滿$900減$50"). Generic marketing ("Shop new arrivals", "Free shipping") is NOT a discount on its own.
- "confidence": "high" when the page clearly headlines a sale with concrete numbers/codes; "medium" when a deal is present but vague; "low" when only weak hints.
- "title": short promotion name in the site's own wording (e.g. "618 Mid-Year Sale", "End of Season Sale").
- "discountSummary": one punchy line capturing the headline deal.
- "discountPercent": the single best headline number, e.g. "50%", "20–60%", "as low as 20%".
- "categories": product groups on sale (e.g. ["Running shoes","Apparel"]). [] if not stated.
- "offers": EVERY distinct promotion as a separate entry — do not merge them. Capture minSpend (e.g. "$900") and audience (members/new-customer offers vs everyone).
- "evidence": 2-5 SHORT EXACT quotes copied verbatim from the page text that prove each deal (this is the "why"). e.g. ["618年中激賞低至2折","CODE: 618SALE","全單滿$900即減$50"]. Never invent — quote only what appears in the text.
- "promoCode"/"startDate"/"endDate": only when explicitly present; otherwise null.
- "items": up to 5 notable discounted products with prices when listed, else [].
- Match the page's language (Chinese/English) in all text fields.

Source URL: ${url}

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

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Block private network requests (SSRF protection)
  const hostname = parsedUrl.hostname.toLowerCase();
  const isPrivate =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.") ||
    hostname.endsWith(".local");
  if (isPrivate) {
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
    const fetchRes = await fetch(url, {
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
    const msg = err instanceof Error ? err.message : "Fetch failed";
    console.warn(`[discounts/scan] fetch error: ${url} → ${msg}`);
    return NextResponse.json({ error: `Could not fetch site: ${msg}` }, { status: 422 });
  }

  const pageText = extractTextFromHtml(html, DISCOUNT_KEYWORDS);
  if (pageText.length < 100) {
    console.warn(`[discounts/scan] thin content: ${url} → ${pageText.length} chars (likely JS-rendered)`);
    return NextResponse.json(
      { error: "Site returned no readable content (may require JavaScript or block bots)" },
      { status: 422 }
    );
  }

  try {
    const { data, provider, tokensUsed } = await aiExtractJson(DISCOUNT_PROMPT(pageText, url));
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

    const result: DiscountScanResult = {
      hasDiscount: Boolean(data.hasDiscount),
      confidence: confidenceOf(data.confidence),
      title: str(data.title),
      discountSummary: str(data.discountSummary),
      discountPercent: str(data.discountPercent),
      promoCode: str(data.promoCode),
      startDate: str(data.startDate),
      endDate: str(data.endDate),
      categories: strArr(data.categories, 8),
      offers: Array.isArray(data.offers)
        ? (data.offers as Array<Record<string, unknown>>)
            .slice(0, 8)
            .map((o) => ({
              label: String(o.label ?? "").trim(),
              detail: str(o.detail),
              discountPercent: str(o.discountPercent),
              promoCode: str(o.promoCode),
              minSpend: str(o.minSpend),
              audience: audienceOf(o.audience),
            }))
            .filter((o) => o.label)
        : [],
      evidence: strArr(data.evidence, 6),
      items: Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
            .slice(0, 5)
            .map((it) => ({
              name: String(it.name ?? "").trim(),
              price: str(it.price),
              originalPrice: str(it.originalPrice),
            }))
            .filter((it) => it.name)
        : [],
      sourceUrl: url,
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
