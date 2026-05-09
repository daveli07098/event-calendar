import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// AI usage rate limiter — DB-backed, persists across hot reloads and restarts
// ---------------------------------------------------------------------------
const AI_DAILY_LIMIT = 250; // max AI-powered scrapes per user per day

function getDayKey() {
  // Use HKT (UTC+8) so quota resets at midnight Hong Kong time, not midnight UTC
  const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return hkt.toISOString().slice(0, 10); // "YYYY-MM-DD" in HKT
}

// In-memory fallback for quota (used when DB columns not yet migrated)
const rateLimitMap = new Map<string, { count: number; dayKey: string }>();

/** Returns true if the user still has quota remaining (does NOT increment). */
async function checkRemainingAiLimit(userId: string): Promise<boolean> {
  const today = getDayKey();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiQuotaDate: true, aiQuotaCount: true },
  }).catch(() => null);
  if (!user) {
    // DB unavailable — fall back to in-memory
    const bucket = rateLimitMap.get(userId);
    return !bucket || bucket.dayKey !== today || bucket.count < AI_DAILY_LIMIT;
  }
  if (user.aiQuotaDate !== today) return true;
  return user.aiQuotaCount < AI_DAILY_LIMIT;
}

/** Increments the counter by 1. Call only after a successful AI response. */
async function incrementAiLimit(userId: string): Promise<void> {
  const today = getDayKey();
  try {
    // Read current state first, then write atomically
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiQuotaDate: true, aiQuotaCount: true },
    });
    if (!user) return;
    if (user.aiQuotaDate !== today) {
      // New day — reset to 1
      await prisma.user.update({
        where: { id: userId },
        data: { aiQuotaDate: today, aiQuotaCount: 1 },
      });
    } else {
      // Same day — increment
      await prisma.user.update({
        where: { id: userId },
        data: { aiQuotaCount: { increment: 1 } },
      });
    }
  } catch {
    // DB unavailable — fall back to in-memory
    const bucket = rateLimitMap.get(userId);
    if (!bucket || bucket.dayKey !== today) {
      rateLimitMap.set(userId, { count: 1, dayKey: today });
    } else {
      bucket.count += 1;
    }
  }
}

/** How many AI calls remain today for this user (0–250). */
async function remainingAiCalls(userId: string): Promise<number> {
  const today = getDayKey();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiQuotaDate: true, aiQuotaCount: true },
  }).catch(() => null);
  if (!user) {
    // DB unavailable — fall back to in-memory
    const bucket = rateLimitMap.get(userId);
    if (!bucket || bucket.dayKey !== today) return AI_DAILY_LIMIT;
    return Math.max(0, AI_DAILY_LIMIT - bucket.count);
  }
  if (user.aiQuotaDate !== today) return AI_DAILY_LIMIT; // new day — full quota
  return Math.max(0, AI_DAILY_LIMIT - (user.aiQuotaCount ?? 0));
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
  endDate: string | null;           // event end date YYYY-MM-DD
  endTime: string | null;           // event end time HH:MM
  saleDate: string | null;          // public general on-sale date (kept for backward compat)
  saleFirstDate: string | null;     // earliest presale / fan-club / member sale date (kept for backward compat)
  saleDates: SaleWindow[] | null;   // all sale windows in chronological order
  sourceTimezone: string | null;    // IANA or ±HH:MM offset extracted from source (e.g. "+08:00" for HKT)
}

/** A single ticket-sale window with a date, optional time, and a human label. */
interface SaleWindow {
  date: string;         // YYYY-MM-DD
  time: string | null;  // HH:MM 24h or null
  label: string;        // e.g. "Fan Presale", "Public Sale", "Priority Sale"
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

  // Prioritise the most event-relevant content by surfacing sentences that
  // contain keywords (prices, sale dates, venue) right at the start of the
  // truncated text so they're never cut off by the 8000-char limit.
  const keywords = /HK\$|USD\$|price|ticket|sale|on.?sale|開售|售票|票價|presale|優先|venue|hall|arena|stadium|Cityline|KKTIX|Ticketmaster|Eventbrite|BOOKYAY|快達票|膠紙座/i;
  const sentences = text.split(/(?<=[.!?。！？\n])\s*/);
  const relevant = sentences.filter(s => keywords.test(s));
  const rest = sentences.filter(s => !keywords.test(s));
  // Put relevant sentences first, then the rest — keeps total within limit
  text = [...relevant, ...rest].join(" ").replace(/\s{2,}/g, " ").trim();

  // Limit to ~8000 chars (gemini-2.5-flash has large context; 8k covers most event pages)
  return text.slice(0, 8000);
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
  endDate: string | null;         // last night of multi-night concert
  endTime: string | null;         // time of last night
  venue: string | null;
  location: string | null;
  saleDate: string | null;        // earliest public/general on-sale from JSON-LD
  saleFirstDate: string | null;   // earliest presale/fan-club date from JSON-LD
  saleDates: Array<{ date: string; time: string | null; label: string }> | null;
  sourceTimezone: string | null;  // ±HH:MM offset detected from JSON-LD or URL domain
}

/** Extract ±HH:MM or "Z" timezone offset from the tail of an ISO datetime string. */
function extractTzFromIso(isoStr: string): string | null {
  const m = isoStr.match(/([+-]\d{2}:?\d{2}|Z)$/);
  return m ? m[1] : null;
}

/** Map known event-ticketing domains to their local timezone offset string. */
function detectTimezoneFromUrl(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    const h = hostname.toLowerCase();
    const hktDomains = [
      "timable.com", "cityline.com", "hkticketing.com", "ticketmaster.com.hk",
      "urbtix.hk", "ticketflap.com", "klook.com", "kktix.com",
    ];
    if (hktDomains.some((d) => h === d || h.endsWith(`.${d}`))) return "+08:00";
  } catch { /* ignore invalid URL */ }
  return null;
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
  let schemaEndDate: string | null = null;
  let schemaEndTime: string | null = null;
  let schemaTime: string | null = null;
  let schemaVenue: string | null = null;
  let schemaLocation: string | null = null;
  let sourceTz: string | null = null;
  // Strategy A sale-window events (non-location Event blocks from JSON-LD)
  const stratASaleWindows: Array<{ date: string; time: string | null; label: string }> = [];

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
    // Split by location presence:
    // Events WITH location = concert nights (have a venue)
    // Events WITHOUT location = sale windows (no venue)
    const concertEvents = allJsonLdEvents.filter((e) => e.raw.location);
    const saleWindowEvents = allJsonLdEvents.filter((e) => !e.raw.location);

    if (concertEvents.length > 0) {
      // Multi-night concerts: sort ascending → first night is start date, last night is end date
      concertEvents.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
      const firstNight = concertEvents[0]!;
      const lastNight = concertEvents[concertEvents.length - 1]!;

      const firstParts = firstNight.startDate.split("T");
      schemaDate = firstParts[0] ?? null;
      schemaTime = firstParts[1] ? firstParts[1].slice(0, 5) : null;
      if (firstParts[1]) sourceTz = extractTzFromIso(firstNight.startDate);

      // Multi-night: record endDate as the last night (different from first)
      if (concertEvents.length > 1 && lastNight.startDate.slice(0, 10) !== firstNight.startDate.slice(0, 10)) {
        const lastParts = lastNight.startDate.split("T");
        schemaEndDate = lastParts[0] ?? null;
        schemaEndTime = lastParts[1] ? lastParts[1].slice(0, 5) : null;
      }

      // Venue from the first concert night that has location data
      const locationEvent = firstNight;
      if (locationEvent.raw.location) {
        const locRaw = locationEvent.raw.location;
        if (typeof locRaw === "string") {
          // Plain string location — use directly as venue name
          schemaVenue = locRaw.trim() || null;
        } else {
          const loc = locRaw as Record<string, unknown>;
          schemaVenue = typeof loc.name === "string" ? loc.name.trim() : null;
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

      // Strategy A: non-location blocks are sale windows
      if (saleWindowEvents.length > 0) {
        const saleOnly = [...saleWindowEvents].sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
        for (let i = 0; i < saleOnly.length; i++) {
          const ev = saleOnly[i]!;
          const dStr = ev.startDate.slice(0, 10);
          // Skip dates that overlap with concert nights
          if (concertEvents.some((c) => c.startDate.slice(0, 10) === dStr)) continue;
          const tStr = ev.startDate.includes("T") ? ev.startDate.slice(11, 16) : null;
          const label = i === saleOnly.length - 1 ? "Public Sale" : "Priority Sale";
          if (!stratASaleWindows.some((w) => w.date === dStr)) stratASaleWindows.push({ date: dStr, time: tStr, label });
        }
      }
    } else {
      // No location data on any event block — fallback: latest date = concert (original behavior)
      allJsonLdEvents.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
      const mainEvt = allJsonLdEvents[0]!;
      const mainParts = mainEvt.startDate.split("T");
      schemaDate = mainParts[0] ?? null;
      schemaTime = mainParts[1] ? mainParts[1].slice(0, 5) : null;
      if (mainParts[1]) sourceTz = extractTzFromIso(mainEvt.startDate);
      // Can't distinguish concert vs sale without location — skip Strategy A
    }
  }

  // HTML <title> fallback
  const htmlTitle = decodeHtml(get(/<title[^>]*>([^<]+)<\/title>/i));

  // Eventbrite-specific date meta
  const eventDate = get(/<meta[^>]*name=["']event:start_time["'][^>]*content=["']([^"']+)["']/i);

  // Extract sale dates from JSON-LD.
  // Strategy A: multiple Event blocks where each block's startDate = sale window date
  // Strategy B: single Event block with offers[].validFrom = sale open dates
  // Strategy C: text-based fallback for Chinese pages (公開發售 / 會員優先)
  let schemaSaleDate: string | null = null;
  let schemaSaleFirstDate: string | null = null;
  let schemaSaleDates: Array<{ date: string; time: string | null; label: string }> = [];

  // Collect all offer validFrom dates + availability labels across ALL event blocks
  interface OfferWindow { dateObj: Date; dateStr: string; timeStr: string | null; label: string }
  const offerWindows: OfferWindow[] = [];

  for (const evt of allJsonLdEvents) {
    const offers = evt.raw.offers;
    if (!offers) continue;
    const offerList: Record<string, unknown>[] = Array.isArray(offers) ? offers : [offers];
    for (const offer of offerList) {
      if (offer.validFrom) {
        const d = new Date(String(offer.validFrom));
        if (!isNaN(d.getTime())) {
          const iso = String(offer.validFrom);
          const parts = iso.split("T");
          const dateStr = parts[0] ?? "";
          const timeStr = parts[1] ? parts[1].slice(0, 5) : null;
          // Derive label from availability or name field on the offer
          let label = "Sale";
          const avail = String((offer.availability ?? offer.name ?? "")).toLowerCase();
          if (avail.includes("presale") || avail.includes("fan") || avail.includes("member") || avail.includes("priority") || avail.includes("優先")) {
            label = "Priority Sale";
          } else if (avail.includes("public") || avail.includes("general") || avail.includes("公開")) {
            label = "Public Sale";
          }
          // Avoid duplicates by date string
          if (dateStr && !offerWindows.some(w => w.dateStr === dateStr)) {
            offerWindows.push({ dateObj: d, dateStr, timeStr, label });
          }
        }
      }
    }
  }

  if (offerWindows.length > 0) {
    // Strategy B: use offers.validFrom dates
    offerWindows.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime()); // chrono asc
    // Label last one "Public Sale" if still generic; earlier ones "Priority Sale"
    if (offerWindows.length > 1) {
      const last = offerWindows[offerWindows.length - 1]!;
      if (last.label === "Sale") last.label = "Public Sale";
      for (let i = 0; i < offerWindows.length - 1; i++) {
        if (offerWindows[i]!.label === "Sale") offerWindows[i]!.label = "Priority Sale";
      }
    }
    schemaSaleDates = offerWindows.map(w => ({ date: w.dateStr, time: w.timeStr, label: w.label }));
    schemaSaleFirstDate = offerWindows[0]!.dateStr;
    schemaSaleDate = offerWindows[offerWindows.length - 1]!.dateStr;
  } else {
    // Strategy A: use the non-location Event blocks identified during the concert/sale split
    if (stratASaleWindows.length > 0) {
      schemaSaleDates = stratASaleWindows;
      schemaSaleFirstDate = stratASaleWindows[0]!.date;
      schemaSaleDate = stratASaleWindows[stratASaleWindows.length - 1]!.date;
    }
  }

  // Strategy C: Chinese text fallback — scan page text for sale date patterns
  // e.g. "公開發售" near "2026年4月22日" or "4月22日"
  if (!schemaSaleDate) {
    // Look for ISO or Chinese dates near 公開 / on sale keywords
    const publicSaleMatch = html.match(
      /(?:公開發售|general sale|public sale)[\s\S]{0,200}?(\d{4})[年-](\d{1,2})[月-](\d{1,2})/i
    ) ?? html.match(
      /(\d{4})[年-](\d{1,2})[月-](\d{1,2})[日]?[^]*?(?:公開發售|公開|general sale)/i
    );
    if (publicSaleMatch) {
      const [, y, m, d] = publicSaleMatch;
      schemaSaleDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  if (!schemaSaleFirstDate) {
    const presaleMatch = html.match(
      /(?:會員優先|priority sale|presale|fan sale)[\s\S]{0,200}?(\d{4})[年-](\d{1,2})[月-](\d{1,2})/i
    ) ?? html.match(
      /(\d{4})[年-](\d{1,2})[月-](\d{1,2})[日]?[^]*?(?:會員優先|優先購票|priority)/i
    );
    if (presaleMatch) {
      const [, y, m, d] = presaleMatch;
      const candidate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const concertDate = schemaDate ?? (eventDate ? eventDate.split("T")[0] : null);
      // Exclude the concert date and the public sale date — neither is a presale
      if (candidate !== schemaSaleDate && candidate !== concertDate) schemaSaleFirstDate = candidate;
    }
  }

  // URL-based timezone fallback — kicks in when JSON-LD has no offset info
  if (!sourceTz) sourceTz = detectTimezoneFromUrl(pageUrl);

  return {
    title: ogTitle ?? htmlTitle,
    description: decodeHtml(ogDesc),
    imageUrl: ogImage,
    date: schemaDate ?? (eventDate ? eventDate.split("T")[0] : null),
    time: schemaTime ?? (eventDate && eventDate.includes("T") ? eventDate.split("T")[1].slice(0, 5) : null),
    endDate: schemaEndDate,
    endTime: schemaEndTime,
    venue: schemaVenue || null,
    location: schemaLocation || null,
    saleDate: schemaSaleDate,
    saleFirstDate: schemaSaleFirstDate,
    saleDates: schemaSaleDates.length > 0 ? schemaSaleDates : null,
    sourceTimezone: sourceTz,
  };
}

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------
// Compact prompt — fewer tokens, same structured output.
// Field names are self-explanatory; examples only where format is ambiguous.
const EXTRACT_PROMPT = (text: string, url: string) => `Extract event/ticket info from the page text below. Return ONLY a JSON object with these fields (null if not found):
{"title":"Event name","date":"YYYY-MM-DD","time":"HH:MM 24h","endDate":"YYYY-MM-DD if event ends on a different or specified date","endTime":"HH:MM 24h end time if stated","venue":"building name","location":"city or address","description":"1 sentence","ticketPrices":["HK$699","HK$899"],"ticketPlatforms":["Cityline","KKTIX"],"saleDate":"YYYY-MM-DD HH:MM public/general sale (not presale)","saleFirstDate":"YYYY-MM-DD HH:MM earliest presale/member sale if different from saleDate","saleDates":[{"date":"YYYY-MM-DD","time":"HH:MM or null","label":"Fan Presale / Priority Sale / Public Sale / etc"}]}
IMPORTANT for saleDates: list ALL sale windows found (presale, priority, member, public). Include every distinct date. Order chronologically earliest first.
URL: ${url}
${text}`.trim();

async function callGemini(text: string, url: string, model = "gemini-3-flash-preview"): Promise<Partial<TicketData> & { _tokensUsed: number | null }> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: EXTRACT_PROMPT(text, url) }] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048 },
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000)); // wait before retry
    res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok || res.status !== 503) break; // success or non-retryable error
  }

  if (!res || !res.ok) throw new Error(`Gemini API error: ${res?.status ?? "unknown"}`);
  const data = await res.json();
  const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const usage = data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;
  const tokensUsed = usage?.totalTokenCount ?? null;
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Truncated response — attempt to salvage by closing open braces/brackets
    const salvaged = cleaned.replace(/,\s*$/, "") + (cleaned.includes("{") ? "}" : "");
    try { parsed = JSON.parse(salvaged); } catch { parsed = {}; }
  }
  return { ...(parsed as Partial<TicketData>), _tokensUsed: tokensUsed };
}

async function callOpenAICompatible(
  text: string,
  url: string,
  endpoint: string,
  token: string,
  model: string,
  extraHeaders: Record<string, string> = {}
): Promise<Partial<TicketData> & { _tokensUsed: number | null }> {
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
      max_tokens: 2048,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(`AI API error: ${res.status}`);
  const data = await res.json();
  const raw: string = data.choices?.[0]?.message?.content ?? "{}";
  const usage = data.usage as { total_tokens?: number } | undefined;
  const tokensUsed = usage?.total_tokens ?? null;
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const salvaged = cleaned.replace(/,\s*$/, "") + (cleaned.includes("{") ? "}" : "");
    try { parsed = JSON.parse(salvaged); } catch { parsed = {}; }
  }
  return { ...(parsed as Partial<TicketData>), _tokensUsed: tokensUsed };
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

async function callCopilot(text: string, url: string, githubToken: string): Promise<Partial<TicketData> & { _tokensUsed: number | null }> {
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
  const withinLimit = hasAiProvider ? await checkRemainingAiLimit(uid) : false;
  // NOTE: remaining is read AFTER the AI call (below) so it reflects the post-increment value

  let aiError: string | null = null;
  let aiTokensUsed: number | null = null;

  // ---------------------------------------------------------------------------
  // AI cascade: multiple Gemini models → Groq → Copilot
  // Each Gemini model is tried in order; on 429 (quota) we fall through to next.
  // ---------------------------------------------------------------------------
  if (hasAiProvider && !withinLimit) {
    console.warn(`[tickets/scrape] User ${uid} hit daily AI limit (${AI_DAILY_LIMIT}/day) — using OG-meta fallback`);
    aiError = `Daily AI limit reached (${AI_DAILY_LIMIT}/day)`;
  } else if (hasAiProvider && withinLimit) {
    // Try each provider in order; skip to next on 429
    const providers: Array<() => Promise<{ result: Partial<TicketData>; name: string }>> = [];

    // Gemini models in priority order — all share GEMINI_API_KEY
    // Free-tier RPM from Google AI Studio rate limits (2026-05):
    const geminiModels = [
      "gemini-3-flash-preview",       // Gemini 3 Flash        — 5 RPM  free
      "gemini-3.1-flash-lite-preview", // Gemini 3.1 Flash Lite — 15 RPM free
      "gemini-2.5-flash",              // Gemini 2.5 Flash      — 5 RPM  free (stable)
      "gemini-2.5-flash-lite",         // Gemini 2.5 Flash Lite — 10 RPM free (stable)
      "gemma-4-31b-it",                // Gemma 4 31B           — 15 RPM free
      "gemma-4-26b-it",                // Gemma 4 26B           — 15 RPM free
    ];
    if (geminiKey) {
      for (const model of geminiModels) {
        const m = model; // capture for closure
        providers.push(async () => ({
          result: await callGemini(pageText, url, m),
          name: m,
        }));
      }
    }
    if (groqKey) {
      providers.push(async () => ({
        result: await callOpenAICompatible(
          pageText, url,
          "https://api.groq.com/openai/v1/chat/completions",
          groqKey,
          "llama3-8b-8192"
        ),
        name: "groq-llama3",
      }));
    }
    if (githubToken) {
      providers.push(async () => ({
        // gho_/ghu_ tokens must be exchanged for a short-lived Copilot token first
        result: await callCopilot(pageText, url, githubToken),
        name: "github-copilot",
      }));
    }

    for (const provider of providers) {
      let currentProviderName = "unknown";
      try {
        const { result, name } = await provider();
        currentProviderName = name;
        aiResult = result;
        aiUsed = name;
        aiError = null;
        aiTokensUsed = (result as Record<string, unknown>)._tokensUsed as number | null ?? null;
        if (aiTokensUsed) console.log(`[tickets/scrape] ${name} tokens used: ${aiTokensUsed}`);
        await incrementAiLimit(uid);
        break; // success — stop trying
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("429") || msg.includes("404") || msg.includes("503")) {
          const reason = msg.includes("404") ? "not found" : msg.includes("503") ? "unavailable (503)" : "quota exceeded (429)";
          console.warn(`[tickets/scrape] ${reason} for ${currentProviderName} — trying next provider`);
          aiError = "AI quota exceeded — results from OG-meta only";
          // continue to next provider
        } else {
          console.error(`[tickets/scrape] AI provider failed (${currentProviderName}):`, e);
          aiError = msg;
          break; // non-quota error — stop chain
        }
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
    endDate: (aiResult as Partial<TicketData>).endDate ?? meta.endDate ?? null,
    endTime: (aiResult as Partial<TicketData>).endTime ?? meta.endTime ?? null,
    saleDate: (aiResult as Partial<TicketData>).saleDate ?? meta.saleDate ?? null,
    saleFirstDate: (aiResult as Partial<TicketData>).saleFirstDate ?? meta.saleFirstDate ?? null,
    saleDates: (aiResult as Partial<TicketData>).saleDates?.length
      ? (aiResult as Partial<TicketData>).saleDates!
      : meta.saleDates ?? null,
    // sourceTimezone comes only from meta (JSON-LD / URL domain) — AI doesn't return it
    sourceTimezone: meta.sourceTimezone,
  };

  if (!ticket.title || ticket.title === "Untitled Event") {
    return NextResponse.json(
      { error: "Could not extract event information from this URL. Try a different page or ensure the URL is publicly accessible." },
      { status: 422 }
    );
  }

  // Read remaining AFTER potential increment so badge reflects actual post-scan value
  const remaining = await remainingAiCalls(uid);

  return NextResponse.json({
    ...ticket,
    aiError,
    aiTokensUsed,
    aiQuota: { used: AI_DAILY_LIMIT - remaining, limit: AI_DAILY_LIMIT, remaining },
  });
}

// ---------------------------------------------------------------------------
// GET /api/tickets/scrape — return current AI quota without performing a scrape
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uid = session.user.id;
  const remaining = await remainingAiCalls(uid);
  return NextResponse.json({
    aiQuota: {
      used: AI_DAILY_LIMIT - remaining,
      limit: AI_DAILY_LIMIT,
      remaining,
    },
  });
}
