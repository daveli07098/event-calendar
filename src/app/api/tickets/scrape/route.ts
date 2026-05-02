import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// AI usage rate limiter — in-memory, resets daily per user
// Prevents quota burn if the token is misused or the page is hammered.
// ---------------------------------------------------------------------------
const AI_DAILY_LIMIT = 50; // max AI-powered scrapes per user per day

interface RateBucket { count: number; dayKey: string }
const rateLimitMap = new Map<string, RateBucket>();

function getDayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** Returns true if the user still has quota remaining (does NOT increment). */
function checkRemainingAiLimit(userId: string): boolean {
  const today = getDayKey();
  const bucket = rateLimitMap.get(userId);
  if (!bucket || bucket.dayKey !== today) return true;
  return bucket.count < AI_DAILY_LIMIT;
}

/** Increments the counter. Call only after a successful AI response. */
function incrementAiLimit(userId: string): void {
  const today = getDayKey();
  const bucket = rateLimitMap.get(userId);
  if (!bucket || bucket.dayKey !== today) {
    rateLimitMap.set(userId, { count: 1, dayKey: today });
  } else {
    bucket.count += 1;
  }
}

/** How many AI calls remain today for this user. */
function remainingAiCalls(userId: string): number {
  const today = getDayKey();
  const bucket = rateLimitMap.get(userId);
  if (!bucket || bucket.dayKey !== today) return AI_DAILY_LIMIT;
  return Math.max(0, AI_DAILY_LIMIT - bucket.count);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TicketData {
  title: string;
  date: string | null;
  time: string | null;
  venue: string | null;
  location: string | null;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string;
  aiUsed: string;
  // Ticket-specific fields
  ticketPrices: string[] | null;    // e.g. ["HK$688", "HK$888", "HK$1,288"]
  ticketPlatforms: string[] | null; // e.g. ["BOOKYAY", "大麥網"]
  saleDate: string | null;          // public general on-sale date
  saleFirstDate: string | null;     // earliest presale / fan-club / member sale date
}

// ---------------------------------------------------------------------------
// HTML text extraction (strips tags, keeps meaningful text for AI)
// ---------------------------------------------------------------------------
function extractTextFromHtml(html: string): string {
  // Remove script, style, head, nav, footer blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")           // remaining tags → space
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")            // collapse whitespace
    .trim();

  // Limit to ~6000 chars to stay within AI context budgets
  return text.slice(0, 6000);
}

// ---------------------------------------------------------------------------
// OG / Schema.org / JSON-LD meta fallback (no AI required)
// ---------------------------------------------------------------------------
interface MetaFallback {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  date: string | null;
  time: string | null;
  venue: string | null;
  location: string | null;
  saleDate: string | null;        // earliest public/general on-sale from JSON-LD
  saleFirstDate: string | null;   // earliest presale/fan-club date from JSON-LD
}

function extractMeta(html: string, pageUrl: string): MetaFallback {
  const get = (pattern: RegExp) => {
    const m = html.match(pattern);
    return m ? (m[1] ?? m[2] ?? null) : null;
  };

  // Decode common HTML entities in text extracted from meta tags
  function decodeHtml(str: string | null): string | null {
    if (!str) return null;
    return str
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  }

  // Open Graph
  const ogTitle = decodeHtml(
    get(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    ?? get(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
  );
  const ogDesc = decodeHtml(
    get(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
    ?? get(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i)
  );
  const ogImage = get(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    ?? get(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

  // Schema.org Event JSON-LD
  let schemaDate: string | null = null;
  let schemaTime: string | null = null;
  let schemaVenue: string | null = null;
  let schemaLocation: string | null = null;

  const jsonldMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];

  // Collect all valid Event entries, then pick the one with the latest startDate.
  // Timable and similar sites embed a separate Event JSON-LD block for every sale
  // window, so the first entry is often a presale date, not the actual show date.
  interface JsonLdEvent { startDate: string; dateObj: Date; raw: Record<string, unknown> }
  const allJsonLdEvents: JsonLdEvent[] = [];

  for (const block of jsonldMatches) {
    const json = block.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
    try {
      const data = JSON.parse(json);
      const events: Record<string, unknown>[] = Array.isArray(data)
        ? data.filter((d: Record<string, unknown>) => d["@type"] === "Event")
        : data["@type"] === "Event"
        ? [data]
        : [];

      for (const event of events) {
        if (event.startDate) {
          const sd = String(event.startDate);
          const d = new Date(sd);
          if (!isNaN(d.getTime())) {
            allJsonLdEvents.push({ startDate: sd, dateObj: d, raw: event });
          }
        }
      }
    } catch {
      /* ignore invalid JSON-LD */
    }
  }

  if (allJsonLdEvents.length > 0) {
    // Sort descending — the concert event is furthest in the future
    allJsonLdEvents.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
    const mainEvt = allJsonLdEvents[0];
    const parts = mainEvt.startDate.split("T");
    schemaDate = parts[0] ?? null;
    schemaTime = parts[1] ? parts[1].slice(0, 5) : null;

    if (mainEvt.raw.location) {
      const loc = mainEvt.raw.location as Record<string, unknown>;
      schemaVenue = String(loc.name ?? "");
      const addr = loc.address as Record<string, unknown> | string | undefined;
      if (addr && typeof addr === "object") {
        schemaLocation = [addr.streetAddress, addr.addressLocality, addr.addressCountry]
          .filter(Boolean)
          .join(", ");
      } else if (typeof addr === "string") {
        schemaLocation = addr;
      }
    }
  }

  // HTML <title> fallback
  const htmlTitle = decodeHtml(get(/<title[^>]*>([^<]+)<\/title>/i));

  // Eventbrite-specific date meta
  const eventDate = get(/<meta[^>]*name=["']event:start_time["'][^>]*content=["']([^"']+)["']/i);

  // Extract sale dates from non-concert JSON-LD Event blocks.
  // When AI is unavailable, these give us saleDate + saleFirstDate for free.
  let schemaSaleDate: string | null = null;
  let schemaSaleFirstDate: string | null = null;
  if (allJsonLdEvents.length > 1) {
    // Concert = latest (index 0 after desc sort). Rest are sale windows.
    const saleEvents = allJsonLdEvents.slice(1);
    // saleFirstDate = earliest non-concert event (fanclub / member presale)
    const earliest = saleEvents[saleEvents.length - 1];
    schemaSaleFirstDate = earliest.startDate.slice(0, 10);
    // saleDate = latest non-concert event (most likely public general sale)
    const latestSale = saleEvents[0];
    const latestSaleDate = latestSale.startDate.slice(0, 10);
    // Only set saleDate separately if it differs from saleFirstDate
    if (latestSaleDate !== schemaSaleFirstDate) {
      schemaSaleDate = latestSaleDate;
    } else {
      // Only one sale date — treat it as public sale, not presale
      schemaSaleDate = latestSaleDate;
      schemaSaleFirstDate = null;
    }
  }

  return {
    title: ogTitle ?? htmlTitle,
    description: decodeHtml(ogDesc),
    imageUrl: ogImage,
    date: schemaDate ?? (eventDate ? eventDate.split("T")[0] : null),
    time: schemaTime ?? (eventDate && eventDate.includes("T") ? eventDate.split("T")[1].slice(0, 5) : null),
    venue: schemaVenue || null,
    location: schemaLocation || null,
    saleDate: schemaSaleDate,
    saleFirstDate: schemaSaleFirstDate,
  };
}

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------
const EXTRACT_PROMPT = (text: string, url: string) => `
You are a ticket and event data extractor. Extract information from the following webpage text and return ONLY a valid JSON object with these fields:
- title (string, required — event/concert name)
- date (YYYY-MM-DD format if possible, or natural language like "May 9-10, 2026", nullable)
- time (HH:MM 24h format if possible, nullable)
- venue (venue/building name, nullable)
- location (city, address, or country, nullable)
- description (brief 1-2 sentence summary of the event, nullable)
- ticketPrices (array of ALL price strings found on the page including HK$, USD$, etc., e.g. ["HK$699", "HK$899", "HK$1,099"], null if none found)
- ticketPlatforms (array of ticketing platform/seller names, e.g. ["BOOKYAY", "大麥網 DAMAI", "膠紙座", "Cityline"], null if none found)
- saleDate (the PUBLIC general on-sale date — include EVEN IF already past, "YYYY-MM-DD HH:MM" format if possible, nullable. Use the public/general sale date, not the earliest presale.)
- saleFirstDate (the EARLIEST available sale date — earliest fanclub, member, priority, or presale date, only if DIFFERENT from saleDate, "YYYY-MM-DD HH:MM" format if possible, nullable)

Return ONLY the JSON object, no markdown code blocks, no extra text.

Source URL: ${url}

Page text:
${text}
`.trim();

async function callGemini(text: string, url: string): Promise<Partial<TicketData>> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const model = "gemini-2.0-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: EXTRACT_PROMPT(text, url) }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 512 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
}

async function callOpenAICompatible(
  text: string,
  url: string,
  endpoint: string,
  token: string,
  model: string,
  extraHeaders: Record<string, string> = {}
): Promise<Partial<TicketData>> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: EXTRACT_PROMPT(text, url),
        },
      ],
      max_tokens: 512,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(`AI API error: ${res.status}`);
  const data = await res.json();
  const raw: string = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
}

/**
 * Exchange a GitHub OAuth token (gho_) for a short-lived Copilot API token.
 * The gho_ token alone is NOT accepted by api.githubcopilot.com.
 */
async function getCopilotToken(githubToken: string): Promise<string> {
  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `token ${githubToken}`,
      "User-Agent": "GitHubCopilotChat/0.22.4",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Copilot token exchange failed: ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error("No token in Copilot token response");
  return data.token as string;
}

async function callCopilot(text: string, url: string, githubToken: string): Promise<Partial<TicketData>> {
  const copilotToken = await getCopilotToken(githubToken);
  return callOpenAICompatible(
    text,
    url,
    "https://api.githubcopilot.com/chat/completions",
    copilotToken,
    "gpt-4o",
    {
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot-chat/0.22.4",
    }
  );
}

// ---------------------------------------------------------------------------
// Text-based date/time fallback — for sites with poor OG/Schema markup
// ---------------------------------------------------------------------------
function extractDateFromText(text: string): { date: string | null; time: string | null } {
  // Chinese date patterns: 2026年5月9日, 2026年3月, etc.
  const cnDate = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cnDate) {
    const [, y, m, d] = cnDate;
    const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    // Try to find time near the date match
    const timeMatch = text.match(/(\d{1,2})[:：](\d{2})\s*(?:PM|AM|pm|am|下午|晚上)?/);
    let time: string | null = null;
    if (timeMatch) {
      let h = Number(timeMatch[1]);
      const min = timeMatch[2];
      // If PM or 下午/晚上 mentioned near the match, adjust
      if (/PM|pm|下午|晚上/.test(text.slice(text.indexOf(timeMatch[0]) - 10, text.indexOf(timeMatch[0]) + 20)) && h < 12) h += 12;
      time = `${String(h).padStart(2, "0")}:${min}`;
    }
    return { date, time };
  }

  // ISO / Western: May 9, 2026 / 9 May 2026 / 2026-05-09
  const months: Record<string, string> = {
    january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",
    july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",
  };
  const westernDate = text.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(202\d)/i);
  if (westernDate) {
    const [full, day, year] = westernDate;
    const monthStr = full.replace(/\s.*/, "").toLowerCase().slice(0, 3);
    const monthMap: Record<string,string> = {jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"};
    const month = monthMap[monthStr] ?? "01";
    return { date: `${year}-${month}-${day.padStart(2, "0")}`, time: null };
  }

  const isoDate = text.match(/(202\d)-(\d{2})-(\d{2})/);
  if (isoDate) return { date: isoDate[0], time: null };

  return { date: null, time: null };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { url?: string; method?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, method: extractMethod } = body;
  // "og-meta" forces OG/Schema only; anything else (including "auto") uses AI when available
  const forceOgMeta = extractMethod === "og-meta";
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Basic URL validation
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

  // Fetch the page server-side
  let html: string;
  try {
    const fetchRes = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; EventCalendarBot/1.0; +https://github.com/event-calendar)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
      // @ts-expect-error — Next.js fetch extension
      cache: "no-store",
    });
    if (!fetchRes.ok) {
      return NextResponse.json(
        { error: `Could not fetch URL (HTTP ${fetchRes.status})` },
        { status: 422 }
      );
    }
    html = await fetchRes.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    return NextResponse.json({ error: `Could not fetch URL: ${msg}` }, { status: 422 });
  }

  // Extract meta fallback (always run — used if AI not available / as supplement)
  const meta = extractMeta(html, url);

  // Determine which AI to use
  const geminiKey = process.env.GEMINI_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;
  const groqKey = process.env.GROQ_API_KEY;

  let aiResult: Partial<TicketData> = {};
  let aiUsed = forceOgMeta ? "og-meta (manual)" : "og-meta";

  const pageText = extractTextFromHtml(html);
  const uid = session.user.id;

  // Only check quota if at least one AI provider is configured AND user didn't request OG-meta only.
  // Falls back to OG-meta if the user has hit their limit or no AI key exists.
  const hasAiProvider = !forceOgMeta && !!(geminiKey || githubToken || groqKey);
  const withinLimit = hasAiProvider ? checkRemainingAiLimit(uid) : false;
  const remaining = remainingAiCalls(uid);

  let aiError: string | null = null;

  if (hasAiProvider && !withinLimit) {
    console.warn(`[tickets/scrape] User ${uid} hit daily AI limit (${AI_DAILY_LIMIT}/day) — using OG-meta fallback`);
    aiError = `Daily AI limit reached (${AI_DAILY_LIMIT}/day)`;
  } else if (geminiKey && withinLimit) {
    try {
      aiResult = await callGemini(pageText, url);
      aiUsed = "gemini-2.0-flash";
      incrementAiLimit(uid); // only count when AI actually succeeds
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gemini error";
      const is429 = msg.includes("429");
      if (is429) {
        console.warn("[tickets/scrape] Gemini quota exceeded (429) — falling back to OG-meta");
        aiError = "Gemini daily quota exceeded — results from OG-meta only";
      } else {
        console.error("[tickets/scrape] Gemini failed:", e);
        aiError = msg;
      }
    }
  } else if (githubToken && withinLimit) {
    try {
      // gho_/ghu_ tokens must be exchanged for a short-lived Copilot token first
      aiResult = await callCopilot(pageText, url, githubToken);
      aiUsed = "github-copilot";
      incrementAiLimit(uid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Copilot error";
      const is429 = msg.includes("429");
      if (is429) {
        console.warn("[tickets/scrape] Copilot quota exceeded (429) — falling back to OG-meta");
        aiError = "Copilot daily quota exceeded — results from OG-meta only";
      } else {
        console.error("[tickets/scrape] Copilot API failed:", e);
        aiError = msg;
      }
    }
  } else if (groqKey && withinLimit) {
    try {
      aiResult = await callOpenAICompatible(
        pageText,
        url,
        "https://api.groq.com/openai/v1/chat/completions",
        groqKey,
        "llama3-8b-8192"
      );
      aiUsed = "groq-llama3";
      incrementAiLimit(uid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Groq error";
      const is429 = msg.includes("429");
      if (is429) {
        console.warn("[tickets/scrape] Groq quota exceeded (429) — falling back to OG-meta");
        aiError = "Groq daily quota exceeded — results from OG-meta only";
      } else {
        console.error("[tickets/scrape] Groq failed:", e);
        aiError = msg;
      }
    }
  }

  // Text-based date fallback — kicks in when OG/Schema AND AI both miss the date
  const textDate = extractDateFromText(pageText);

  // Merge: AI > OG/Schema > text extraction
  const ticket: TicketData = {
    title: aiResult.title ?? meta.title ?? "Untitled Event",
    date: aiResult.date ?? meta.date ?? textDate.date,
    time: aiResult.time ?? meta.time ?? textDate.time,
    venue: aiResult.venue ?? meta.venue,
    location: aiResult.location ?? meta.location,
    description: aiResult.description ?? meta.description,
    imageUrl: meta.imageUrl,  // always use OG image
    sourceUrl: url,
    aiUsed,
    ticketPrices: (aiResult as Partial<TicketData>).ticketPrices ?? null,
    ticketPlatforms: (aiResult as Partial<TicketData>).ticketPlatforms ?? null,
    saleDate: (aiResult as Partial<TicketData>).saleDate ?? meta.saleDate ?? null,
    saleFirstDate: (aiResult as Partial<TicketData>).saleFirstDate ?? meta.saleFirstDate ?? null,
  };

  if (!ticket.title || ticket.title === "Untitled Event") {
    return NextResponse.json(
      { error: "Could not extract event information from this URL. Try a different page or ensure the URL is publicly accessible." },
      { status: 422 }
    );
  }

  return NextResponse.json({
    ...ticket,
    aiError, // null on success; error message string when AI failed and fell back to og-meta
    aiQuota: { used: AI_DAILY_LIMIT - remaining, limit: AI_DAILY_LIMIT, remaining },
  });
}
