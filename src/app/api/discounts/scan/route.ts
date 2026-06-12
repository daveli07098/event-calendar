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

/** AI-detected discount/sale promotion on a retail site. */
export interface DiscountScanResult {
  hasDiscount: boolean;
  title: string | null;
  discountSummary: string | null;
  discountPercent: string | null;
  promoCode: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
  items: Array<{ name: string; price: string | null; originalPrice: string | null }>;
  sourceUrl: string;
  aiUsed: string;
  tokensUsed: number | null;
}

// Sentences containing these terms are prioritised before truncation so the
// promotion details survive the text-length limit.
const DISCOUNT_KEYWORDS =
  /sale|discount|%\s*off|\boff\b|promo|coupon|code|deal|save|clearance|outlet|markdown|折|優惠|減價|特價|清貨|促銷|限時|低至/i;

const DISCOUNT_PROMPT = (text: string, url: string) => `You are analyzing the text content of a retail/e-commerce website to detect ACTIVE sale or discount promotions.

Return ONLY a JSON object with this exact shape:
{
  "hasDiscount": boolean,
  "title": string|null,
  "discountSummary": string|null,
  "discountPercent": string|null,
  "promoCode": string|null,
  "startDate": "YYYY-MM-DD"|null,
  "endDate": "YYYY-MM-DD"|null,
  "items": [{ "name": string, "price": string|null, "originalPrice": string|null }]
}

Rules:
- "hasDiscount" is true ONLY for explicit promotions in the text (e.g. "Up to 50% off", "額外8折", clearance/outlet pricing, promo codes). Generic marketing like "Shop new arrivals" is NOT a discount.
- "title": short promotion name, e.g. "End of Season Sale". Use the site's own wording when present.
- "discountSummary": one line, e.g. "Up to 50% off selected styles + extra 10% with code".
- "discountPercent": headline number, e.g. "50%" or "20–60%".
- "startDate"/"endDate": only when explicitly stated; otherwise null.
- "items": up to 5 notable discounted products with prices when listed, else [].
- If multiple promotions exist, pick the most prominent as title and mention the rest in discountSummary.
- Match the page's language (Chinese/English) in text fields.

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
      return NextResponse.json(
        { error: `Could not fetch site (HTTP ${fetchRes.status})` },
        { status: 422 }
      );
    }
    html = await fetchRes.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    return NextResponse.json({ error: `Could not fetch site: ${msg}` }, { status: 422 });
  }

  const pageText = extractTextFromHtml(html, DISCOUNT_KEYWORDS);
  if (pageText.length < 100) {
    return NextResponse.json(
      { error: "Site returned no readable content (may require JavaScript or block bots)" },
      { status: 422 }
    );
  }

  try {
    const { data, provider, tokensUsed } = await aiExtractJson(DISCOUNT_PROMPT(pageText, url));
    await incrementAiLimit(uid);
    const remaining = await remainingAiCalls(uid);

    const result: DiscountScanResult = {
      hasDiscount: Boolean(data.hasDiscount),
      title: typeof data.title === "string" ? data.title : null,
      discountSummary: typeof data.discountSummary === "string" ? data.discountSummary : null,
      discountPercent: typeof data.discountPercent === "string" ? data.discountPercent : null,
      promoCode: typeof data.promoCode === "string" ? data.promoCode : null,
      startDate: typeof data.startDate === "string" ? data.startDate : null,
      endDate: typeof data.endDate === "string" ? data.endDate : null,
      items: Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
            .slice(0, 5)
            .map((it) => ({
              name: String(it.name ?? ""),
              price: typeof it.price === "string" ? it.price : null,
              originalPrice: typeof it.originalPrice === "string" ? it.originalPrice : null,
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
    return NextResponse.json({ error: `AI extraction failed: ${msg}` }, { status: 502 });
  }
}
