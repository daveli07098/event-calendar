import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { classifySingleEvent } from "@/lib/classify-event";
import { detectCountry } from "@/lib/detect-country";

// ---------------------------------------------------------------------------
// AI usage rate limiter — DB-backed, persists across hot reloads and restarts
// ---------------------------------------------------------------------------
const AI_DAILY_LIMIT = 250; // max AI-powered scrapes per user per day

function getDayKey() {
  // Use HKT (UTC+8) so quota resets at midnight Hong Kong time, not midnight UTC
  const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return hkt.toISOString().slice(0, 10); // "YYYY-MM-DD" in HKT
}

/** ISO UTC string of the next HKT midnight (quota reset point). */
function getResetAt(): string {
  const hktMs = Date.now() + 8 * 60 * 60 * 1000;
  // Start of current HKT day (ms), then add one day to get next midnight HKT
  const nextMidnightHktMs = Math.floor(hktMs / 86400000) * 86400000 + 86400000;
  return new Date(nextMidnightHktMs - 8 * 60 * 60 * 1000).toISOString();
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
  slots: EventSlot[];               // grouped performance timeslots (empty when ≤1)
  category: string | null;          // AI-detected category: concert|exhibition|theatre|sports|festival|anime|popup|comedy|film|food|other
  country: string | null;           // detected country: domain-based primary, AI fallback
  venueRuns: VenueRun[] | null;     // multi-venue tour runs (null when single venue)
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
  const keywords = /HK\$|USD\$|price|ticket|sale|on.?sale|開售|售票|票價|presale|優先|venue|hall|arena|stadium|Cityline|KKTIX|Ticketmaster|Eventbrite|BOOKYAY|快達票|膠紙座|klook|accupass|開催場所|開催期間|会場|開催日|開催地/i;
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

/** A single grouped performance timeslot (after consecutive same-time nights are merged). */
export interface EventSlot {
  date: string;           // YYYY-MM-DD (first night)
  endDate: string | null; // YYYY-MM-DD (last night if range, null if single day)
  time: string | null;    // HH:MM
  endTime: string | null; // HH:MM from JSON-LD endDate if available
  label: string;          // human-readable e.g. "Jun 13–14 · 19:30"
}

/** A single venue run for a multi-venue tour (e.g. exhibition touring Tokyo then Osaka). */
export interface VenueRun {
  venue: string;       // venue name e.g. "有楽町マルイ"
  location: string | null; // city/prefecture for this specific venue, if different
  date: string;        // YYYY-MM-DD start date for this venue
  endDate: string;     // YYYY-MM-DD end date for this venue
  label: string;       // human-readable e.g. "有楽町マルイ: Mar 14–Mar 29"
}

interface MetaFallback {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  date: string | null;
  dateConfident: boolean;         // true when date came from a JSON-LD concert block (with location)
  time: string | null;
  endDate: string | null;         // last night of multi-night concert
  endTime: string | null;         // time of last night
  venue: string | null;
  location: string | null;
  saleDate: string | null;        // earliest public/general on-sale from JSON-LD
  saleFirstDate: string | null;   // earliest presale/fan-club date from JSON-LD
  saleDates: Array<{ date: string; time: string | null; label: string }> | null;
  ticketPlatforms: string[] | null; // e.g. ["快達票 HK Ticketing", "Cityline"]
  sourceTimezone: string | null;  // ±HH:MM offset detected from JSON-LD or URL domain
  slots: EventSlot[];             // grouped performance timeslots (empty when ≤1 unique slot)
}

// ---------------------------------------------------------------------------
// Multi-slot grouping: consecutive same-time nights → date range
// ---------------------------------------------------------------------------
function buildSlotLabel(date: string, endDate: string | null, time: string | null, endTime: string | null = null): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmt = (d: string) => {
    const parts = d.split("-");
    const m = parseInt(parts[1] ?? "1", 10);
    const day = parseInt(parts[2] ?? "1", 10);
    return `${months[m - 1]} ${day}`;
  };
  const datePart = endDate ? `${fmt(date)}–${fmt(endDate)}` : fmt(date);
  if (!time) return datePart;
  return endTime ? `${datePart} · ${time}–${endTime}` : `${datePart} · ${time}`;
}

/** Build a short human-readable label for a venue run, e.g. "有楽町マルイ: Mar 14–Mar 29" */
function buildVenueRunLabel(venue: string, date: string, endDate: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmt = (d: string) => {
    const parts = d.split("-");
    const m = parseInt(parts[1] ?? "1", 10);
    const day = parseInt(parts[2] ?? "1", 10);
    return `${months[m - 1]} ${day}`;
  };
  return `${venue}: ${fmt(date)}–${fmt(endDate)}`;
}

/**
 * Parses a Japanese date range string like "2026年7月17日〜9月6日" or
 * "2026年6月26日〜2026年7月27日" into a { date, endDate } object.
 * Returns null if no range pattern is found.
 */
function parseJpDateRange(text: string): { date: string; endDate: string } | null {
  const pad = (n: string) => n.padStart(2, "0");
  // YYYY年M月D日〜YYYY年M月D日 (both years explicit)
  let m = /(\d{4})年(\d{1,2})月(\d{1,2})日[〜～~](\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text);
  if (m) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, endDate: `${m[4]}-${pad(m[5])}-${pad(m[6])}` };
  // YYYY年M月D日〜M月D日 (endDate inherits year from start)
  m = /(\d{4})年(\d{1,2})月(\d{1,2})日[〜～~](\d{1,2})月(\d{1,2})日/.exec(text);
  if (m) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, endDate: `${m[1]}-${pad(m[4])}-${pad(m[5])}` };
  return null;
}

/**
 * Extracts multi-venue tour runs directly from raw HTML using the Japanese
 * 【city/region label】 bracket pattern common on event info pages:
 *   開催場所: 【東京】アニメイト池袋本店 / 【大阪】アニメイト大阪日本橋別館
 *   開催期間: 【東京】2026年6月26日〜7月27日 / 【大阪】2026年8月28日〜9月28日
 *
 * Returns null if the pattern is absent or only a single venue is found.
 * This is the primary (non-AI) source for venueRuns; AI result is the fallback.
 */
function extractVenueRunsFromHtml(html: string): VenueRun[] | null {
  // Strip HTML tags from a cell, replacing <br> with newline
  const plainCell = (s: string) =>
    s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
     .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<")
     .replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

  // Parse 【label】content pairs from plain text (may be separated by newline or space)
  const parseBracketed = (text: string): Map<string, string> => {
    const map = new Map<string, string>();
    for (const m of text.matchAll(/【([^】]+)】\s*([^【\n]+)/g)) {
      map.set(m[1].trim(), m[2].trim());
    }
    return map;
  };

  // Parse Japanese date range like "2026年6月26日〜7月27日" — delegates to shared helper
  const parseJpRange = parseJpDateRange;

  // Extract all table rows as {label, value} pairs
  const rows: Array<{ label: string; value: string }> = [];
  for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowM[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => plainCell(c[1]));
    if (cells.length >= 2) rows.push({ label: cells[0], value: cells[1] });
  }

  // Find 開催場所 (venue) and 開催期間 (period) rows
  const venueRow = rows.find(r => /開催場所|会場|開催会場/.test(r.label));
  const periodRow = rows.find(r => /開催期間|期間|開催日/.test(r.label));
  if (!venueRow || !periodRow) return null;

  // Both must have ≥2 【label】content pairs (single-venue events only have one)
  const venues = parseBracketed(venueRow.value);
  const periods = parseBracketed(periodRow.value);
  if (venues.size < 2 || periods.size < 2) return null;

  // Correlate by matching label key (e.g. "東京", "大阪")
  const runs: VenueRun[] = [];
  for (const [label, venue] of venues) {
    // Try exact match first, then partial match
    const periodText = periods.get(label) ?? [...periods.entries()].find(([k]) => k.includes(label) || label.includes(k))?.[1];
    if (!periodText) continue;
    const range = parseJpRange(periodText);
    if (!range) continue;
    runs.push({
      venue,
      location: null,
      date: range.date,
      endDate: range.endDate,
      label: buildVenueRunLabel(venue, range.date, range.endDate),
    });
  }

  return runs.length >= 2 ? runs.sort((a, b) => a.date.localeCompare(b.date)) : null;
}

function groupIntoSlots(concertEvents: Array<{ startDate: string; dateObj: Date; raw: Record<string, unknown> }>): EventSlot[] {
  if (concertEvents.length === 0) return [];

  // Build per-night info, expanding multi-day JSON-LD events into individual nights.
  // e.g. a single JSON-LD event with startDate=Jun 13 and endDate=Jun 14 at 19:30 becomes
  // two entries (Jun 13 · 19:30 and Jun 14 · 19:30) so they merge into the correct "Jun 13–14" run.
  const nights: Array<{ date: string; time: string | null; endTime: string | null; dateObj: Date }> = [];
  for (const ev of concertEvents) {
    const parts = ev.startDate.split("T");
    const date = parts[0] ?? ev.startDate.slice(0, 10);
    const time = parts[1] ? parts[1].slice(0, 5) : null;
    const rawEnd = typeof ev.raw.endDate === "string" ? ev.raw.endDate : null;
    const endTime = rawEnd?.includes("T") ? rawEnd.split("T")[1]?.slice(0, 5) ?? null : null;
    const endDateOnly = rawEnd ? (rawEnd.split("T")[0] ?? null) : null;

    if (endDateOnly && endDateOnly > date) {
      // Multi-day event: expand into one entry per night
      let cur = date;
      let step = 0;
      while (cur <= endDateOnly && step < 366) {
        nights.push({ date: cur, time, endTime, dateObj: new Date(cur + "T12:00:00Z") });
        step++;
        const d = new Date(cur + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        cur = d.toISOString().slice(0, 10);
      }
    } else {
      nights.push({ date, time, endTime, dateObj: ev.dateObj });
    }
  }

  // Sort ascending
  nights.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

  // Group by HH:MM time key
  const groups = new Map<string, typeof nights>();
  for (const n of nights) {
    const key = n.time ?? "__allday__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  const slots: EventSlot[] = [];
  for (const [timeKey, group] of groups) {
    const time = timeKey === "__allday__" ? null : timeKey;
    // Find runs of consecutive calendar days within this time group
    let i = 0;
    while (i < group.length) {
      const runStart = group[i]!;
      let j = i + 1;
      while (j < group.length) {
        const diffDays = Math.round(
          (group[j]!.dateObj.getTime() - group[j - 1]!.dateObj.getTime()) / 86_400_000
        );
        if (diffDays === 1) j++;
        else break;
      }
      const runEnd = group[j - 1]!;
      const endDate = runStart.date !== runEnd.date ? runEnd.date : null;
      slots.push({
        date: runStart.date,
        endDate,
        time,
        endTime: runStart.endTime,
        label: buildSlotLabel(runStart.date, endDate, time, runStart.endTime),
      });
      i = j;
    }
  }

  // Sort slots chronologically
  slots.sort((a, b) => a.date.localeCompare(b.date));
  // Only return when there are genuinely multiple distinct timeslots
  return slots.length > 1 ? slots : [];
}

/** Extract ±HH:MM or "Z" timezone offset from the tail of an ISO datetime string. */
function extractTzFromIso(isoStr: string): string | null {
  const m = isoStr.match(/([+-]\d{2}:?\d{2}|Z)$/);
  return m ? m[1] : null;
}

/**
 * Convert a UTC Date to local date+time strings using a tz offset like "+08:00" or "-05:00".
 * This avoids showing UTC values when the source data stores times in UTC but the sale
 * window is in the local timezone (e.g. 04:00 UTC = 12:00 noon HKT).
 */
function utcToLocalStrings(d: Date, tz: string, originalIso?: string): { date: string; time: string } {
  // Timezone-naive string (e.g. "2026-05-14T12:00:00" — no Z or ±offset) is already stored
  // in local time. Do NOT add the timezone offset or we'd double-count it (12:00 + 8h = 20:00).
  if (originalIso?.includes("T")) {
    const hasTzSuffix = /Z$|[+-]\d{2}:?\d{2}$/.test(originalIso.trim());
    if (!hasTzSuffix) {
      const [datePart, timePart = ""] = originalIso.split("T");
      return { date: datePart!, time: timePart.slice(0, 5) };
    }
  }
  const sign = tz.startsWith("-") ? -1 : 1;
  const [hh = "0", mm = "0"] = tz.replace(/[+-]/, "").split(":");
  const offsetMs = sign * (parseInt(hh, 10) * 60 + parseInt(mm, 10)) * 60_000;
  const local = new Date(d.getTime() + offsetMs);
  return {
    date: local.toISOString().slice(0, 10),
    time: `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`,
  };
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
  // Initialise sourceTz early from URL domain so Strategy A + B can use it even
  // when the concert JSON-LD block has no embedded tz offset. JSON-LD processing
  // below may override this with a more precise value.
  let sourceTz: string | null = detectTimezoneFromUrl(pageUrl);
  // Strategy A sale-window events (non-location Event blocks from JSON-LD)
  const stratASaleWindows: Array<{ date: string; time: string | null; label: string }> = [];
  // All concert-night events (with location) — hoisted so groupIntoSlots can use them
  let concertEvents: Array<{ startDate: string; dateObj: Date; raw: Record<string, unknown> }> = [];

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

  // Returns true when a JSON-LD event represents a ticket-sale window rather than a
  // performance. Timable and similar sites attach `location` to EVERY event block,
  // including presale/priority/public-sale slots, so we can't rely solely on location
  // presence. We inspect the event `name` for sale-related keywords AND ticketing
  // platform names (e.g. "購票通 Cityline", "大麥網 DAMAI") — those blocks are always
  // sale windows, not concert nights.
  const isSaleWindow = (e: { startDate: string; dateObj: Date; raw: Record<string, unknown> }) => {
    if (!e.raw.location) return true; // no location → definitely a sale window
    const name = typeof e.raw.name === "string" ? e.raw.name : "";
    // Sale-type keywords (presale / priority / member / public-sale terms)
    const hasSaleKeywords = /presale|pre-sale|priority|優先|訂票|pre.?order|on.?sale|public.?sale|公開發售|fan.?club|會員|member.?sale|vip(?!\s*area)|visa|mastercard|credit.?card|信用卡/i.test(name);
    // Ticketing platform names — sale events on Timable are often named after the platform
    const hasPlatformName = /購票通|cityline|大麥網|damai|快達票|hk.?ticketing|ticketmaster|kktix|urbtix|klook|eventbrite|bookyay|accupass|膠紙座|trip\.?com/i.test(name);
    return hasSaleKeywords || hasPlatformName;
  };

  if (allJsonLdEvents.length > 0) {
    // Split: concert nights (actual performance) vs sale windows (ticketing availability)
    concertEvents = allJsonLdEvents.filter((e) => !isSaleWindow(e));
    const saleWindowEvents = allJsonLdEvents.filter(isSaleWindow);

    if (concertEvents.length > 0) {
      // Reclassify any location-less event that falls inside the concert's date range.
      // Some ticketing sites (e.g. Timable) omit the `location` field on matinee /
      // secondary-slot JSON-LD blocks — they would otherwise be misclassified as sale windows.
      const concertStartDate0 = concertEvents.reduce(
        (min, e) => (e.startDate.slice(0, 10) < min ? e.startDate.slice(0, 10) : min),
        concertEvents[0]!.startDate.slice(0, 10)
      );
      const concertRangeEnd0 = concertEvents.reduce((max, e) => {
        const rawEnd = typeof e.raw.endDate === "string" ? e.raw.endDate : null;
        const tail = (rawEnd ?? e.startDate).slice(0, 10);
        return tail > max ? tail : max;
      }, concertStartDate0);
      const reclassified = saleWindowEvents.filter(
        (e) => e.startDate.slice(0, 10) >= concertStartDate0 && e.startDate.slice(0, 10) <= concertRangeEnd0
      );
      if (reclassified.length > 0) concertEvents = [...concertEvents, ...reclassified];

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

      // Single-night or any concert: extract end time from JSON-LD endDate field when available.
      // Timable and other structured sites include endDate so we can show "8:00 PM–10:30 PM" in the form.
      if (!schemaEndTime) {
        const firstConcertRawEnd = typeof firstNight.raw.endDate === "string" ? firstNight.raw.endDate : null;
        if (firstConcertRawEnd?.includes("T")) {
          const endDateOnly = firstConcertRawEnd.slice(0, 10);
          const endT = firstConcertRawEnd.split("T")[1]?.slice(0, 5) ?? null;
          if (endDateOnly === schemaDate) {
            // Same-day end — capture the end time
            schemaEndTime = endT;
          } else if (schemaDate && endDateOnly > schemaDate && !schemaEndDate) {
            // Late-night show crossing midnight (e.g. ends 00:30 next day)
            schemaEndDate = endDateOnly;
            schemaEndTime = endT;
          }
        }
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
        // Pre-compute concert dates in local timezone so overlap check is tz-consistent
        const concertLocalDates = new Set(
          concertEvents.map((c) => sourceTz ? utcToLocalStrings(c.dateObj, sourceTz, c.startDate).date : c.startDate.slice(0, 10))
        );
        const saleOnly = [...saleWindowEvents].sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
        for (let i = 0; i < saleOnly.length; i++) {
          const ev = saleOnly[i]!;
          // Convert UTC timestamp to local timezone (pass originalIso to avoid double-converting
          // timezone-naive strings like "2026-05-14T12:00:00" which are already in local time)
          const { date: dStr, time: localTime } = sourceTz
            ? utcToLocalStrings(ev.dateObj, sourceTz, ev.startDate)
            : { date: ev.startDate.slice(0, 10), time: ev.startDate.includes("T") ? ev.startDate.slice(11, 16) : "" };
          // Skip dates that overlap with concert nights
          if (concertLocalDates.has(dStr)) continue;
          const tStr = ev.startDate.includes("T") ? (localTime || null) : null;
          // Prefer the JSON-LD event name (e.g. "DBS 信用卡預訂") as the human label; fall back to positional
          const evName = typeof ev.raw.name === "string" && ev.raw.name.trim() ? ev.raw.name.trim() : null;
          const label = evName ?? (i === saleOnly.length - 1 ? "Public Sale" : "Priority Sale");
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
          // Convert to source timezone so sale times show in local time (not UTC)
          // e.g. "2026-05-14T04:00:00Z" → date="2026-05-14" time="12:00" for HKT (+08:00)
          let dateStr: string;
          let timeStr: string | null;
          if (sourceTz) {
            const local = utcToLocalStrings(d, sourceTz, iso);
            dateStr = local.date;
            timeStr = iso.includes("T") ? local.time : null;
          } else {
            const parts = iso.split("T");
            dateStr = parts[0] ?? "";
            timeStr = parts[1] ? parts[1].slice(0, 5) : null;
          }
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

  // Merge Strategy B (offers.validFrom) + Strategy A (sale-window JSON-LD events).
  // Strategy A event-name labels are more descriptive (e.g. "DBS 信用卡預訂") so they override
  // generic positional labels from Strategy B when the same date appears in both.
  {
    const saleDateMap = new Map<string, { date: string; time: string | null; label: string }>();

    if (offerWindows.length > 0) {
      offerWindows.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
      if (offerWindows.length > 1) {
        const last = offerWindows[offerWindows.length - 1]!;
        if (last.label === "Sale") last.label = "Public Sale";
        for (let i = 0; i < offerWindows.length - 1; i++) {
          if (offerWindows[i]!.label === "Sale") offerWindows[i]!.label = "Priority Sale";
        }
      }
      for (const w of offerWindows) saleDateMap.set(w.dateStr, { date: w.dateStr, time: w.timeStr, label: w.label });
    }

    // Strategy A entries override generic B labels when dates overlap
    for (const w of stratASaleWindows) {
      const existing = saleDateMap.get(w.date);
      if (!existing || ["Sale", "Priority Sale", "Public Sale"].includes(existing.label)) {
        saleDateMap.set(w.date, w);
      }
    }

    if (saleDateMap.size > 0) {
      schemaSaleDates = Array.from(saleDateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      schemaSaleFirstDate = schemaSaleDates[0]!.date;
      schemaSaleDate = schemaSaleDates[schemaSaleDates.length - 1]!.date;
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

  // Strategy D: Timable-style "{platform} YYYY年MM月DD日 HH:MM AM/PM ... 開始" pattern.
  // Timable HK generates one vendor section per ticketing platform, each showing the sale-open
  // date for that vendor. There is no JSON-LD for these, so we extract them directly from the
  // stripped HTML text. This runs unconditionally and merges into schemaSaleDates.
  {
    const STRAT_D_PLATFORMS: Array<[RegExp, string]> = [
      [/klook/i,                     "Klook"],
      [/膠紙座/,                      "膠紙座"],
      [/cityline/i,                  "Cityline"],
      [/快達票|hk\s*ticketing/i,      "快達票 HK Ticketing"],
      [/\bkktix\b/i,                 "KKTIX"],
      [/\burbtix\b/i,                "URBTIX"],
      [/ticketmaster/i,              "Ticketmaster"],
      [/\bbookyay\b/i,               "BOOKYAY"],
      [/\baccupass\b/i,              "Accupass"],
    ];
    const platformAlt = STRAT_D_PLATFORMS.map(([re]) => re.source).join("|");
    // Strip tags once for this strategy
    const strippedD = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ");
    // Pattern: platform name … YYYY年MM月DD日 … (optional HH:MM AM/PM) … 開始
    const stratDRe = new RegExp(
      `(${platformAlt})[\\s\\S]{0,120}?(\\d{4})年(\\d{1,2})月(\\d{1,2})日[\\s\\S]{0,80}?開始`,
      "gi"
    );
    for (const m of strippedD.matchAll(stratDRe)) {
      const [fullMatch, platformRaw, y, mo, d] = m;
      const dateStr = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      // Skip if this date is the concert date (already confirmed by JSON-LD or textSlots)
      if (schemaDate && dateStr === schemaDate) continue;
      if (schemaSaleDates.some((w) => w.date === dateStr)) continue;
      // Extract time from the matched window
      const timePart = fullMatch.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      let timeStr: string | null = null;
      if (timePart) {
        let h = Number(timePart[1]);
        if (/pm/i.test(timePart[3]!) && h < 12) h += 12;
        if (/am/i.test(timePart[3]!) && h === 12) h = 0;
        timeStr = `${String(h).padStart(2, "0")}:${timePart[2]}`;
      }
      // Resolve canonical platform name
      let canonicalPlatform = (platformRaw ?? "").trim();
      for (const [re, name] of STRAT_D_PLATFORMS) {
        if (re.test(canonicalPlatform)) { canonicalPlatform = name; break; }
      }
      schemaSaleDates.push({ date: dateStr, time: timeStr, label: canonicalPlatform });
    }
    if (schemaSaleDates.length > 0) {
      schemaSaleDates.sort((a, b) => a.date.localeCompare(b.date));
      schemaSaleFirstDate ??= schemaSaleDates[0]!.date;
      schemaSaleDate ??= schemaSaleDates[schemaSaleDates.length - 1]!.date;
    }
  }

  // URL-based timezone was already set at the start; this keeps the override from JSON-LD if set
  if (!sourceTz) sourceTz = detectTimezoneFromUrl(pageUrl);

  // ---------------------------------------------------------------------------
  // Ticket platform extraction
  // 1. JSON-LD offer.seller.name and offer.url domain → canonical platform name
  // 2. HTML text scan for known platform names (fallback when JSON-LD has nothing)
  // ---------------------------------------------------------------------------
  const PLATFORM_URL_MAP: Array<[RegExp, string]> = [
    [/hkticketing\.com/i, "快達票 HK Ticketing"],
    [/cityline\.com/i, "Cityline"],
    [/urbtix\.hk/i, "URBTIX"],
    [/ticketmaster\.com\.hk/i, "Ticketmaster"],
    [/kktix\.com/i, "KKTIX"],
    [/klook\.com/i, "Klook"],
    [/eventbrite\.com/i, "Eventbrite"],
    [/damai\.cn/i, "大麥網"],
    [/bookyay\.com/i, "BOOKYAY"],
  ];
  const PLATFORM_TEXT_PATTERNS: Array<[RegExp, string]> = [
    [/快達票|HK\s*Ticketing/i, "快達票 HK Ticketing"],
    [/cityline/i, "Cityline"],
    [/\bURBTIX\b/i, "URBTIX"],
    [/ticketmaster/i, "Ticketmaster"],
    [/\bKKTIX\b/i, "KKTIX"],
    [/\bklook\b/i, "Klook"],
    [/eventbrite/i, "Eventbrite"],
    [/大麥網?|\bdamai\b/i, "大麥網"],
    [/\bBOOKYAY\b/i, "BOOKYAY"],
    [/\bAccupass\b/i, "Accupass"],
  ];

  const platformSet = new Set<string>();
  for (const evt of allJsonLdEvents) {
    const offers = evt.raw.offers;
    if (!offers) continue;
    const offerList: Record<string, unknown>[] = Array.isArray(offers) ? offers : [offers];
    for (const offer of offerList) {
      // seller.name
      const seller = offer.seller as Record<string, unknown> | null | undefined;
      const sellerName = seller && typeof seller.name === "string" ? seller.name.trim() : null;
      if (sellerName) platformSet.add(sellerName);
      // offer URL → canonical platform name
      if (typeof offer.url === "string") {
        try {
          const domain = new URL(offer.url).hostname.toLowerCase();
          for (const [re, name] of PLATFORM_URL_MAP) {
            if (re.test(domain)) { platformSet.add(name); break; }
          }
        } catch { /* invalid URL */ }
      }
    }
  }

  // Text-scan fallback — useful when JSON-LD offers don't include seller/URL info
  if (platformSet.size === 0) {
    for (const [re, name] of PLATFORM_TEXT_PATTERNS) {
      if (re.test(html)) platformSet.add(name);
    }
  }

  const metaPlatforms = platformSet.size > 0 ? Array.from(platformSet) : null;

  return {
    title: ogTitle ?? htmlTitle,
    description: decodeHtml(ogDesc),
    imageUrl: ogImage,
    date: schemaDate ?? (eventDate ? eventDate.split("T")[0] : null),
    dateConfident: concertEvents.length > 0,
    time: schemaTime ?? (eventDate && eventDate.includes("T") ? eventDate.split("T")[1].slice(0, 5) : null),
    endDate: schemaEndDate,
    endTime: schemaEndTime,
    venue: schemaVenue || null,
    location: schemaLocation || null,
    saleDate: schemaSaleDate,
    saleFirstDate: schemaSaleFirstDate,
    saleDates: schemaSaleDates.length > 0 ? schemaSaleDates : null,
    ticketPlatforms: metaPlatforms,
    sourceTimezone: sourceTz,
    slots: groupIntoSlots(concertEvents),
  };
}

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------
// Compact prompt — fewer tokens, same structured output.
// Field names are self-explanatory; examples only where format is ambiguous.
const EXTRACT_PROMPT = (text: string, url: string) => `Extract event/ticket info from the page text below. Return ONLY a JSON object with these fields (null if not found):
{"title":"Event name","date":"YYYY-MM-DD","time":"HH:MM 24h","endDate":"YYYY-MM-DD last day if multi-day/multi-night","endTime":"HH:MM 24h end time if stated (e.g. from '8:00 PM – 10:30 PM' → 22:30)","venue":"building/hall name","location":"city or address","country":"country name in English (e.g. Japan, Hong Kong, Taiwan) or null if unknown","description":"1 sentence","ticketPrices":["HK$699","HK$899"],"ticketPlatforms":["Cityline","KKTIX"],"saleDate":"YYYY-MM-DD HH:MM public/general on-sale","saleFirstDate":"YYYY-MM-DD HH:MM earliest presale/priority (must be BEFORE the performance date)","saleDates":[{"date":"YYYY-MM-DD","time":"HH:MM or null","label":"exact label from page"}],"venueRuns":[{"venue":"venue name","location":"city or null","date":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}],"category":"one of: concert|exhibition|theatre|sports|festival|anime|popup|kuji|crane|comedy|film|food|other"}

CRITICAL — performance date vs sale dates:
  • "date" = the day the show/concert/match PHYSICALLY HAPPENS at the venue. NEVER a sale/presale date.
  • Sale dates are weeks or months BEFORE the show. If the page shows e.g. show on Sep 30 and sales starting Mar 20, then date=Sep 30, saleDates start Mar 20.
  • saleFirstDate MUST be earlier than "date". If your saleFirstDate equals "date", you have confused the concert date with a sale date — set saleFirstDate to null instead.
  • On Timable and similar HK ticketing pages, each ticket vendor (Klook, 膠紙座, Cityline, etc.) has its own section showing when THAT VENDOR'S sale opens. "YYYY年MM月DD日 HH:MM 開始" under a vendor name means the SALE opens on that date — NOT when the show happens. Add those as saleDates entries, not as the event date.

CRITICAL — extract ALL sale windows into saleDates (one entry per distinct date/type):
  Common sale types to look for (use the EXACT label shown on the page, Chinese or English):
    • VIP / Exclusive priority  (快達票 VIP 優先訂票, VIP Presale, VIP Priority)
    • Credit card priority       (信用卡優先訂票, Visa/Mastercard Priority)
    • Ticketing-platform priority(快達票優先訂票, HK Ticketing Priority, Cityline Priority)
    • Fan-club / member presale  (官方球迷會會員預訂, Fan Club Presale, Member Sale)
    • General public on-sale     (公開發售, General Sale, Public Sale)
  Each type is a separate saleDates entry with its own date and label.
  Order saleDates chronologically (earliest first). Also set saleFirstDate = saleDates[0].date and saleDate = saleDates[last].date.

CRITICAL — venueRuns: when the SAME event tours MULTIPLE venues with DIFFERENT date ranges (exhibition, collab café tour, etc.), list each venue separately. Example: Tokyo venue Mar 14–29, Osaka venue Apr 25–May 10 → two entries. "date"/"endDate" at top level = overall first/last date. Set venueRuns=null for single-venue events or when venues share the same dates.

CRITICAL — multi-night concerts: if multiple performance dates are listed (e.g. "5月16日及17日", "May 16 & 17", "Aug 6–16"), set date=FIRST night and endDate=LAST night.
CRITICAL — endTime: extract from patterns like "7:30 PM – 10:10 PM" (→ 22:10) or JSON-LD endDate.

CRITICAL — category: choose the single best fit from: concert (live music/bands), exhibition (art/gallery/museum), theatre (play/musical/opera/dance), sports (matches/tournaments), festival (cultural fair/parade), anime (anime/manga/IP/character merch), popup (pop-up store/limited retail), kuji (ichiban kuji/一番くじ/one-kuji lottery merchandise raffle), crane (crane game/UFO catcher/arcade prize merchandise/クレーンゲームプライズ), comedy (stand-up), film (screening/premiere), food (food fair/dining event), ticket (ticket sale / presale reminder with no physical performance on that date), other.

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
function extractDateFromText(text: string): { date: string | null; endDate: string | null; time: string | null } {
  // Japanese date range first: 2026年7月17日〜9月6日 → start + end
  const jpRange = parseJpDateRange(text);
  if (jpRange) {
    // Try to find a time nearby
    const timeMatch = text.match(/(\d{1,2})[:：](\d{2})\s*(?:PM|AM|pm|am|下午|晚上)?/);
    let time: string | null = null;
    if (timeMatch) {
      let h = Number(timeMatch[1]);
      const min = timeMatch[2];
      if (/PM|pm|下午|晚上/.test(text.slice(text.indexOf(timeMatch[0]) - 10, text.indexOf(timeMatch[0]) + 20)) && h < 12) h += 12;
      time = `${String(h).padStart(2, "0")}:${min}`;
    }
    return { date: jpRange.date, endDate: jpRange.endDate, time };
  }

  // Chinese/Japanese single date: 2026年5月9日
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
    return { date, endDate: null, time };
  }

  // ISO / Western: May 9, 2026 / 9 May 2026 / 2026-05-09
  const westernDate = text.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(202\d)/i);
  if (westernDate) {
    const [full, day, year] = westernDate;
    const monthStr = full.replace(/\s.*/, "").toLowerCase().slice(0, 3);
    const monthMap: Record<string,string> = {jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"};
    const month = monthMap[monthStr] ?? "01";
    return { date: `${year}-${month}-${day.padStart(2, "0")}`, endDate: null, time: null };
  }

  const isoDate = text.match(/(202\d)-(\d{2})-(\d{2})/);
  if (isoDate) return { date: isoDate[0], endDate: null, time: null };

  return { date: null, endDate: null, time: null };
}

/**
 * Extract EventSlots from Chinese date-range patterns in page text.
 * Always runs — used as primary slot source when JSON-LD has no concert blocks,
 * and as a supplement to enrich endTimes when JSON-LD only covers one time group
 * (e.g. only the matinee 14:30–17:10 block has location, but the page text also
 * shows an evening 19:30–22:10 row for the same date range).
 *
 * Multiple time rows for the same date range are merged into one slot:
 *   time    = earliest start (14:30)
 *   endTime = latest end    (22:10)
 *
 * Handles two Timable formats:
 *   Cross-month : "2026年7月31至8月1日 7:30 PM – 10:10 PM"
 *   Same-month  : "2026年8月4至5日 7:30 PM – 10:10 PM"
 *
 * @param text         Plain text extracted from the page HTML.
 * @param excludeDates YYYY-MM-DD strings of known sale-window dates to exclude.
 */
function extractTextSlots(text: string, excludeDates: string[]): EventSlot[] {
  const excludeSet = new Set(excludeDates);
  // Key: "startDate_endDate" — merge rows with the same date range
  const rawMap = new Map<string, { date: string; endDate: string | null; time: string; endTime: string | null }>();

  const to24h = (h: number, period: string) => {
    if (period.toLowerCase() === "pm" && h < 12) return h + 12;
    if (period.toLowerCase() === "am" && h === 12) return 0;
    return h;
  };
  const pad2 = (n: number) => String(n).padStart(2, "0");

  const upsert = (startDate: string, rawEnd: string | null, time: string, endTime: string | null) => {
    const endDate = rawEnd && rawEnd > startDate ? rawEnd : null;
    const key = `${startDate}_${endDate ?? ""}`;
    const existing = rawMap.get(key);
    if (!existing) {
      rawMap.set(key, { date: startDate, endDate, time, endTime });
    } else {
      // Merge: keep earliest start time and latest end time
      if (time < existing.time) existing.time = time;
      if (endTime && (!existing.endTime || endTime > existing.endTime)) existing.endTime = endTime;
    }
  };

  // 1. Cross-month range: "2026年7月31至8月1日 7:30 PM" (optionally "– 10:10 PM")
  const crossRe = /(\d{4})年(\d{1,2})月(\d{1,2})至(\d{1,2})月(\d{1,2})日[^0-9\n]{0,15}(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*[–—\-]\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/gi;
  for (const m of text.matchAll(crossRe)) {
    const [, y, m1, d1, m2, d2, h, min, period, endH, endMin, endPeriod] = m;
    const startDate = `${y}-${pad2(+m1!)}-${pad2(+d1!)}`;
    const endDate   = `${y}-${pad2(+m2!)}-${pad2(+d2!)}`;
    const time = `${pad2(to24h(+h!, period!))}:${min}`;
    const endTime = endH && endMin && endPeriod ? `${pad2(to24h(+endH!, endPeriod!))}:${endMin}` : null;
    upsert(startDate, endDate, time, endTime);
  }

  // 2. Same-month range: "2026年8月4至5日 7:30 PM" (optionally "– 10:10 PM")
  const sameRe = /(\d{4})年(\d{1,2})月(\d{1,2})至(\d{1,2})日[^0-9\n]{0,15}(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*[–—\-]\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/gi;
  for (const m of text.matchAll(sameRe)) {
    const [, y, mo, d1, d2, h, min, period, endH, endMin, endPeriod] = m;
    const startDate = `${y}-${pad2(+mo!)}-${pad2(+d1!)}`;
    const endDate   = `${y}-${pad2(+mo!)}-${pad2(+d2!)}`;
    const time = `${pad2(to24h(+h!, period!))}:${min}`;
    const endTime = endH && endMin && endPeriod ? `${pad2(to24h(+endH!, endPeriod!))}:${endMin}` : null;
    upsert(startDate, endDate, time, endTime);
  }

  // Filter out known sale-window dates and sort chronologically.
  // Return even a single slot — the date-range pattern ("至") is specific to
  // concert/exhibition runs and is reliable enough to set meta.dateConfident=true,
  // which overrides a potentially-wrong AI date (e.g. Timable platform sale dates).
  const slots = Array.from(rawMap.values())
    .filter((s) => !excludeSet.has(s.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({
      date: s.date,
      endDate: s.endDate,
      time: s.time,
      endTime: s.endTime,
      label: buildSlotLabel(s.date, s.endDate, s.time, s.endTime),
    }));

  return slots;
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

  // HTML-based venue run extraction (non-AI, reliable for 【city】 bracket pattern)
  const htmlVenueRuns = extractVenueRunsFromHtml(html);

  // Determine which AI to use
  const geminiKey = process.env.GEMINI_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;
  const groqKey = process.env.GROQ_API_KEY;

  let aiResult: Partial<TicketData> = {};
  let aiUsed = forceOgMeta ? "og-meta (manual)" : "og-meta";

  const pageText = extractTextFromHtml(html);
  const uid = session.user.id;

  // Text-based slot extraction — always runs:
  //   a) Primary: when JSON-LD had no concert blocks, use text as the slot source
  //   b) Supplement: when JSON-LD has slots (e.g. only the 14:30 matinee block), enrich
  //      each slot's endTime using the later 19:30–22:10 evening row from page text
  {
    const saleDateStrs = (meta.saleDates ?? []).map((d) => d.date);
    const textSlots = extractTextSlots(pageText, saleDateStrs);
    if (textSlots.length > 0) {
      if (!meta.dateConfident && meta.slots.length === 0) {
        // Full fallback: use text slots as the primary source
        meta.dateConfident = true;
        meta.date = textSlots[0]!.date;
        meta.time = textSlots[0]!.time;
        meta.endDate = textSlots[0]!.endDate;
        meta.slots = textSlots;
      } else if (meta.slots.length > 0) {
        // Supplement: enrich existing slots with endTimes where text extraction provides a later time
        const textByKey = new Map(textSlots.map((s) => [`${s.date}_${s.endDate ?? ""}`, s]));
        meta.slots = meta.slots.map((s) => {
          const match = textByKey.get(`${s.date}_${s.endDate ?? ""}`);
          const betterEndTime =
            match?.endTime && (!s.endTime || match.endTime > s.endTime) ? match.endTime : null;
          const endTime = betterEndTime ?? s.endTime;
          // Re-build label whenever endTime changed or was previously omitted
          if (endTime !== s.endTime || (endTime && !s.label.includes("–" + endTime))) {
            return { ...s, endTime, label: buildSlotLabel(s.date, s.endDate, s.time, endTime) };
          }
          return s;
        });
      }
    } else if (meta.slots.length > 0) {
      // No text slots — still re-build labels to include any endTime already in the slot
      meta.slots = meta.slots.map((s) =>
        s.endTime ? { ...s, label: buildSlotLabel(s.date, s.endDate, s.time, s.endTime) } : s
      );
    }
  }

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
      "gemini-3.5-flash",             // Gemini 3.5 Flash      — 5 RPM  free
      "gemini-3.1-flash-lite",        // Gemini 3.1 Flash Lite — 15 RPM free
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
        // Transient errors: HTTP 400 (bad request / model not available),
        // 429/503 (quota/unavailable), 404 (model not found),
        // and any network-level failure (socket closed, connection refused, fetch failed).
        const isTransient =
          msg.includes("400") ||
          msg.includes("429") ||
          msg.includes("503") ||
          msg.includes("404") ||
          msg.toLowerCase().includes("fetch failed") ||
          msg.toLowerCase().includes("socket") ||
          msg.toLowerCase().includes("econnrefused") ||
          msg.toLowerCase().includes("etimedout") ||
          msg.toLowerCase().includes("network");
        if (isTransient) {
          const reason = msg.includes("400") ? "bad request / model unavailable (400)"
            : msg.includes("429") ? "quota exceeded (429)"
            : msg.includes("404") ? "not found (404)"
            : msg.includes("503") ? "unavailable (503)"
            : "network error";
          console.warn(`[tickets/scrape] ${reason} for ${currentProviderName} — trying next provider`);
          aiError = "AI temporarily unavailable — trying next provider";
          // continue to next provider
        } else {
          console.error(`[tickets/scrape] AI provider failed (${currentProviderName}):`, e);
          aiError = msg;
          break; // non-transient error — stop chain
        }
      }
    }
  }

  // Text-based date fallback — kicks in when OG/Schema AND AI both miss the date
  const textDate = extractDateFromText(pageText);

  // Merge: AI > OG/Schema > text extraction
  const ticket: TicketData = {
    title: aiResult.title ?? meta.title ?? "Untitled Event",
    // Prefer meta.date when it came from a JSON-LD concert block (has location) — those are
    // structurally reliable and can't be confused with sale-window dates the way AI can be.
    date: (meta.dateConfident ? meta.date : null) ?? aiResult.date ?? meta.date ?? textDate.date,
    time: aiResult.time ?? meta.time ?? textDate.time,
    venue: aiResult.venue ?? meta.venue,
    location: aiResult.location ?? meta.location,
    description: aiResult.description ?? meta.description,
    imageUrl: meta.imageUrl,  // always use OG image
    sourceUrl: url,
    aiUsed,
    ticketPrices: (aiResult as Partial<TicketData>).ticketPrices ?? null,
    // Prefer meta.ticketPlatforms (structurally extracted from JSON-LD / HTML) as the reliable source;
    // AI extraction is used as a supplement when meta found nothing.
    ticketPlatforms: (() => {
      const ai = (aiResult as Partial<TicketData>).ticketPlatforms;
      const mt = meta.ticketPlatforms;
      if (mt?.length && ai?.length) {
        // Merge without exact duplicates (case-insensitive)
        const merged = [...mt];
        for (const p of ai) {
          if (!merged.some(m => m.toLowerCase() === p.toLowerCase())) merged.push(p);
        }
        return merged;
      }
      return mt ?? ai ?? null;
    })(),
    endDate: (aiResult as Partial<TicketData>).endDate ?? meta.endDate ?? textDate.endDate ?? null,
    endTime: (aiResult as Partial<TicketData>).endTime ?? meta.endTime ?? null,
    saleDate: (aiResult as Partial<TicketData>).saleDate ?? meta.saleDate ?? null,
    saleFirstDate: (aiResult as Partial<TicketData>).saleFirstDate ?? meta.saleFirstDate ?? null,
    // Merge AI + meta saleDates: meta has structurally extracted all windows (with descriptive labels);
    // AI may catch extra windows meta missed. Union by date, meta label wins on conflict.
    saleDates: (() => {
      const ai = (aiResult as Partial<TicketData>).saleDates;
      const mt = meta.saleDates;
      if (mt?.length && ai?.length) {
        const merged = [...mt];
        for (const d of ai) {
          if (!merged.some(m => m.date === d.date)) merged.push(d);
        }
        return merged.sort((a, b) => a.date.localeCompare(b.date));
      }
      return ai?.length ? ai : mt ?? null;
    })(),
    // sourceTimezone comes only from meta (JSON-LD / URL domain) — AI doesn't return it
    sourceTimezone: meta.sourceTimezone,
    slots: meta.slots,
    // category: AI-detected from main prompt; fall back to the shared classify logic if missing
    category: (aiResult as Partial<TicketData>).category ?? null,
    // country: domain/TLD detection first; AI-extracted country used as fallback
    country: detectCountry(url) ?? ((aiResult as Partial<TicketData> & { country?: string | null }).country ?? null),
    // venueRuns: populated below after validation
    venueRuns: null,
  };

  // --- Venue runs: multi-venue tour detection ---
  // Priority: HTML-extracted (reliable, regex-based) > AI-extracted (may miss or hallucinate)
  // Append tour schedule note to description so each separate event has the full context.
  type RawVenueRun = { venue?: string; location?: string | null; date?: string; endDate?: string };
  const aiVenueRuns = ((aiResult as Partial<TicketData> & { venueRuns?: RawVenueRun[] | null }).venueRuns ?? null);

  // Use HTML-extracted runs if available; otherwise validate and use AI-extracted runs
  let resolvedRuns: VenueRun[] | null = htmlVenueRuns;
  if (!resolvedRuns && Array.isArray(aiVenueRuns) && aiVenueRuns.length >= 2) {
    const valid: VenueRun[] = aiVenueRuns
      .filter((r) =>
        !!(r.venue && r.date && r.endDate && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate)))
      .map(r => ({
        venue: r.venue,
        location: r.location ?? null,
        date: r.date,
        endDate: r.endDate,
        label: buildVenueRunLabel(r.venue, r.date, r.endDate),
      }));
    // Only keep if we have 2+ runs with genuinely different start dates
    const uniqueStarts = new Set(valid.map(r => r.date));
    if (valid.length >= 2 && uniqueStarts.size >= 2) {
      resolvedRuns = valid.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  if (resolvedRuns) {
    ticket.venueRuns = resolvedRuns;
    // Append a tour schedule summary to the description so every created event has the full context
    const scheduleLines = resolvedRuns.map(r => `  【${r.venue}】${r.date}〜${r.endDate}`).join("\n");
    const scheduleNote = `📍 Tour Schedule:\n${scheduleLines}`;
    ticket.description = ticket.description
      ? `${ticket.description}\n\n${scheduleNote}`
      : scheduleNote;
  }

  // Post-build sanitization: remove any sale-window dates that equal the concert date.
  // The AI occasionally outputs the performance date as saleFirstDate — this is always wrong.
  if (ticket.date) {
    const perfDate = ticket.date;
    if (ticket.saleFirstDate === perfDate) ticket.saleFirstDate = null;
    if (ticket.saleDate === perfDate) ticket.saleDate = null;
    if (ticket.saleDates?.length) {
      ticket.saleDates = ticket.saleDates.filter((w) => w.date !== perfDate);
      if (ticket.saleDates.length === 0) ticket.saleDates = null;
    }
  }

  // Rescue: when text-slot extraction overrode the AI's event date (meta.dateConfident),
  // the AI's date field may actually be the ticket sale-open date that it mistook for the
  // event date (e.g. Timable HK showing "Klook 2026-05-21 開始" before the concert listing).
  // If aiResult.date is earlier than the confirmed concert date and not already recorded as
  // a sale window, add it back so the sale information isn't silently discarded.
  if (meta.dateConfident && aiResult.date && ticket.date && (aiResult.date as string) < ticket.date) {
    const rescuedDate = aiResult.date as string;
    const alreadyHasDate = ticket.saleDates?.some((w) => w.date === rescuedDate);
    if (!alreadyHasDate) {
      // Label: prefer the first detected platform name (e.g. "Klook"), else generic
      const fallbackLabel = ticket.ticketPlatforms?.[0] ?? "Sale Opens";
      // Do not carry over aiResult.time — it likely reflects the concert time, not the sale time
      const rescued: SaleWindow = { date: rescuedDate, time: null, label: fallbackLabel };
      const merged = ticket.saleDates ? [...ticket.saleDates, rescued] : [rescued];
      merged.sort((a, b) => a.date.localeCompare(b.date));
      ticket.saleDates = merged;
      // Update saleFirstDate / saleDate only if not already set
      ticket.saleFirstDate ??= merged[0]!.date;
      ticket.saleDate ??= merged[merged.length - 1]!.date;
    }
  }

  // If the main AI prompt didn't return a category, run the shared classify logic
  // (same prompt and model cascade used by the Classify Category tab).
  if (!ticket.category) {
    ticket.category = await classifySingleEvent(ticket.title, ticket.venue ?? ticket.location, ticket.description);
  }

  if (!ticket.title || ticket.title === "Untitled Event") {
    return NextResponse.json(
      { error: "Could not extract event information from this URL. Try a different page or ensure the URL is publicly accessible." },
      { status: 422 }
    );
  }

  // Read remaining AFTER potential increment so badge reflects actual post-scan value
  const remaining = await remainingAiCalls(uid);

  // ---------------------------------------------------------------------------
  // Duplicate detection: find existing events within ±12 h with similar title
  // ---------------------------------------------------------------------------
  type DuplicateCandidate = { id: string; title: string; startTime: string; location: string | null; similarityScore: number };
  let duplicateCandidates: DuplicateCandidate[] = [];
  if (ticket.date) {
    try {
      // ±12h UTC window — enough to cover HKT offset (UTC+8) without spanning too many events
      const midpoint = new Date(`${ticket.date}T12:00:00Z`);
      const windowStart = new Date(midpoint.getTime() - 12 * 3600 * 1000);
      const windowEnd   = new Date(midpoint.getTime() + 12 * 3600 * 1000);

      const [ownedCals, memberships] = await Promise.all([
        prisma.calendar.findMany({ where: { userId: uid }, select: { id: true } }),
        prisma.calendarMember.findMany({ where: { userId: uid }, select: { calendarId: true } }),
      ]);
      const calIds = [
        ...ownedCals.map((c) => c.id),
        ...memberships.map((m) => m.calendarId),
      ];

      const eventsOnDay = await prisma.event.findMany({
        where: { calendarId: { in: calIds }, startTime: { gte: windowStart, lte: windowEnd } },
        select: { id: true, title: true, startTime: true, location: true },
      });

      if (eventsOnDay.length > 0) {
        // Try AI similarity scoring (batch all candidates in one call, cheap prompt)
        let aiScores: Record<string, number> | null = null;
        if (geminiKey) {
          try {
            const candidateTitles = eventsOnDay.map((e, i) => `${i}: ${e.title}`).join("\n");
            const similarityPrompt = `Given the scraped event title and a list of existing calendar event titles, return a JSON object mapping each index (as a string key) to a similarity score between 0.0 and 1.0.
Score 1.0 = definitely the same event (even if wording differs, e.g. different language or extra venue info).
Score 0.0 = completely unrelated event.

Scraped title: "${ticket.title}"

Candidates:
${candidateTitles}

Return ONLY a JSON object like {"0":0.95,"1":0.1,...}`;

            const simEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`;
            const simRes = await fetch(simEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: similarityPrompt }] }],
                generationConfig: { responseMimeType: "application/json", maxOutputTokens: 256 },
              }),
              signal: AbortSignal.timeout(8000), // 8 s max for this lightweight call
            });
            if (simRes.ok) {
              const simData = await simRes.json();
              const raw = simData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
              const cleaned = raw.replace(/```json\n?|```/g, "").trim();
              aiScores = JSON.parse(cleaned) as Record<string, number>;
            }
          } catch {
            // non-critical — fall back to no-AI filter below
          }
        }

        // Filter candidates: if AI scored them, keep score >= 0.85; otherwise exact title match
        duplicateCandidates = eventsOnDay
          .filter((ev, i) => {
            if (aiScores !== null) {
              return (aiScores[String(i)] ?? 0) >= 0.85;
            }
            // No AI: exact title match only
            return ev.title.toLowerCase().trim() === ticket.title.toLowerCase().trim();
          })
          .map((ev, i) => ({
            ...ev,
            startTime: ev.startTime.toISOString(),
            similarityScore: aiScores ? (aiScores[String(i)] ?? 0) : 1,
          }));
      }
    } catch {
      // non-critical — ignore errors
    }
  }

  return NextResponse.json({
    ...ticket,
    aiError,
    aiTokensUsed,
    aiQuota: { used: AI_DAILY_LIMIT - remaining, limit: AI_DAILY_LIMIT, remaining, resetAt: getResetAt() },
    duplicateCandidates,
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
      resetAt: getResetAt(),
    },
  });
}
