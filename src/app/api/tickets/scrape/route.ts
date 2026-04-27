import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// AI usage rate limiter — in-memory, resets daily per user
// Prevents quota burn if the token is misused or the page is hammered.
// ---------------------------------------------------------------------------
const AI_DAILY_LIMIT = 20; // max AI-powered scrapes per user per day

interface RateBucket { count: number; dayKey: string }
const rateLimitMap = new Map<string, RateBucket>();

function getDayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** Returns true if the user is within their daily AI quota. Increments counter. */
function checkAndIncrementAiLimit(userId: string): boolean {
  const today = getDayKey();
  const bucket = rateLimitMap.get(userId);

  if (!bucket || bucket.dayKey !== today) {
    // New day or first use — reset
    rateLimitMap.set(userId, { count: 1, dayKey: today });
    return true;
  }

  if (bucket.count >= AI_DAILY_LIMIT) return false;

  bucket.count += 1;
  return true;
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
}

function extractMeta(html: string, pageUrl: string): MetaFallback {
  const get = (pattern: RegExp) => {
    const m = html.match(pattern);
    return m ? (m[1] ?? m[2] ?? null) : null;
  };

  // Open Graph
  const ogTitle = get(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    ?? get(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const ogDesc = get(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
    ?? get(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
  const ogImage = get(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    ?? get(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

  // Schema.org Event JSON-LD
  let schemaDate: string | null = null;
  let schemaTime: string | null = null;
  let schemaVenue: string | null = null;
  let schemaLocation: string | null = null;

  const jsonldMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
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
        if (!schemaDate && event.startDate) {
          const sd = String(event.startDate);
          const parts = sd.split("T");
          schemaDate = parts[0] ?? null;
          schemaTime = parts[1] ? parts[1].slice(0, 5) : null; // HH:MM
        }
        if (!schemaVenue && event.location) {
          const loc = event.location as Record<string, unknown>;
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
    } catch {
      /* ignore invalid JSON-LD */
    }
  }

  // HTML <title> fallback
  const htmlTitle = get(/<title[^>]*>([^<]+)<\/title>/i);

  // Eventbrite-specific date meta
  const eventDate = get(/<meta[^>]*name=["']event:start_time["'][^>]*content=["']([^"']+)["']/i);

  return {
    title: ogTitle ?? htmlTitle,
    description: ogDesc,
    imageUrl: ogImage,
    date: schemaDate ?? (eventDate ? eventDate.split("T")[0] : null),
    time: schemaTime ?? (eventDate && eventDate.includes("T") ? eventDate.split("T")[1].slice(0, 5) : null),
    venue: schemaVenue || null,
    location: schemaLocation || null,
  };
}

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------
const EXTRACT_PROMPT = (text: string, url: string) => `
You are an event data extractor. Extract event information from the following webpage text and return ONLY a valid JSON object with these fields:
- title (string, required)
- date (YYYY-MM-DD format if possible, or natural language, nullable)
- time (HH:MM 24h format if possible, nullable)
- venue (venue/building name, nullable)
- location (city, address, or country, nullable)
- description (brief 1-2 sentence summary, nullable)

Return ONLY the JSON object, no markdown code blocks, no extra text.

Source URL: ${url}

Page text:
${text}
`.trim();

async function callGemini(text: string, url: string): Promise<Partial<TicketData>> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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
  model: string
): Promise<Partial<TicketData>> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // Required by Copilot API
      "Copilot-Integration-Id": "vscode-chat",
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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  let aiUsed = "og-meta";

  const pageText = extractTextFromHtml(html);
  const uid = session.user.id;

  // Check daily AI quota before calling any AI provider.
  // Falls back to OG-meta if the user has hit their limit for today.
  const withinLimit = checkAndIncrementAiLimit(uid);
  const remaining = remainingAiCalls(uid);

  if (!withinLimit) {
    console.warn(`[tickets/scrape] User ${uid} hit daily AI limit (${AI_DAILY_LIMIT}/day) — using OG-meta fallback`);
  } else if (geminiKey) {
    try {
      aiResult = await callGemini(pageText, url);
      aiUsed = "gemini-1.5-flash";
    } catch (e) {
      console.error("[tickets/scrape] Gemini failed:", e);
    }
  } else if (githubToken) {
    try {
      aiResult = await callOpenAICompatible(
        pageText,
        url,
        "https://api.githubcopilot.com/chat/completions",
        githubToken,
        "gpt-4o"
      );
      aiUsed = "github-copilot";
    } catch (e) {
      console.error("[tickets/scrape] Copilot API failed:", e);
    }
  } else if (groqKey) {
    try {
      aiResult = await callOpenAICompatible(
        pageText,
        url,
        "https://api.groq.com/openai/v1/chat/completions",
        groqKey,
        "llama3-8b-8192"
      );
      aiUsed = "groq-llama3";
    } catch (e) {
      console.error("[tickets/scrape] Groq failed:", e);
    }
  }

  // Merge AI result with meta fallback (AI takes precedence)
  const ticket: TicketData = {
    title: aiResult.title ?? meta.title ?? "Untitled Event",
    date: aiResult.date ?? meta.date,
    time: aiResult.time ?? meta.time,
    venue: aiResult.venue ?? meta.venue,
    location: aiResult.location ?? meta.location,
    description: aiResult.description ?? meta.description,
    imageUrl: meta.imageUrl,  // always use OG image
    sourceUrl: url,
    aiUsed,
  };

  if (!ticket.title || ticket.title === "Untitled Event") {
    return NextResponse.json(
      { error: "Could not extract event information from this URL. Try a different page or ensure the URL is publicly accessible." },
      { status: 422 }
    );
  }

  return NextResponse.json({
    ...ticket,
    // Usage info shown in the UI
    aiQuota: { used: AI_DAILY_LIMIT - remaining, limit: AI_DAILY_LIMIT, remaining },
  });
}
