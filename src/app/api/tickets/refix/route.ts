import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Lightweight JSON-LD extractor (og-meta only, no AI — fast, no quota)
// ---------------------------------------------------------------------------
function extractTzFromIso(isoStr: string): string | null {
  const m = isoStr.match(/([+-]\d{2}:?\d{2}|Z)$/);
  return m ? m[1] : null;
}

function detectTimezoneFromUrl(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    const h = hostname.toLowerCase();
    const hktDomains = [
      "timable.com", "cityline.com", "hkticketing.com", "ticketmaster.com.hk",
      "urbtix.hk", "ticketflap.com", "klook.com", "kktix.com",
    ];
    if (hktDomains.some((d) => h === d || h.endsWith(`.${d}`))) return "+08:00";
  } catch { /* ignore */ }
  return null;
}

/** Fetch HTML and extract the main event's start date, time, and timezone from JSON-LD. */
async function scrapeEventTime(url: string): Promise<{
  date: string | null;
  time: string | null;
  sourceTimezone: string | null;
} | null> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EventCalendarBot/1.0; +https://github.com/event-calendar)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Parse JSON-LD Event blocks
  const jsonldMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const events: Array<{ startDate: string; dateObj: Date }> = [];

  for (const block of jsonldMatches) {
    const json = block.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
    try {
      const data = JSON.parse(json);
      const list: Record<string, unknown>[] = Array.isArray(data)
        ? data.filter((d: Record<string, unknown>) => d["@type"] === "Event")
        : data["@type"] === "Event" ? [data] : [];
      for (const evt of list) {
        if (evt.startDate) {
          const d = new Date(String(evt.startDate));
          if (!isNaN(d.getTime())) events.push({ startDate: String(evt.startDate), dateObj: d });
        }
      }
    } catch { /* skip invalid JSON-LD */ }
  }

  if (events.length === 0) return null;

  // Pick the event with the latest startDate (concert, not presale)
  events.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
  const main = events[0]!;
  const parts = main.startDate.split("T");
  const date = parts[0] ?? null;
  const time = parts[1] ? parts[1].slice(0, 5) : null;
  let sourceTimezone = parts[1] ? extractTzFromIso(main.startDate) : null;
  if (!sourceTimezone) sourceTimezone = detectTimezoneFromUrl(url);

  return { date, time, sourceTimezone };
}

function parseWithTimezone(
  date: string,
  time: string | null,
  sourceTimezone: string,
): Date | null {
  const h = time ? time.split(":")[0] ?? "12" : "12";
  const min = time ? (time.split(":")[1] ?? "00") : "00";
  const iso = `${date}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00${sourceTimezone}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** Extract first "Ticket URL: https://..." from event description. */
function extractTicketUrl(description: string | null): string | null {
  if (!description) return null;
  const m = description.match(/Ticket URL:\s*(https?:\/\/[^\s]+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Route: POST /api/tickets/refix
// Re-scrapes all ticket events for the current user and corrects their times.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional: limit to a specific list of eventIds passed in the body
  let body: { eventIds?: string[] } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const filterIds = body.eventIds?.length ? new Set(body.eventIds) : null;

  const uid = session.user.id;

  // Find all the user's own calendar events that have a Ticket URL in description
  const calendars = await prisma.calendar.findMany({
    where: { userId: uid },
    select: { id: true },
  });
  const calendarIds = calendars.map((c) => c.id);

  const events = await prisma.event.findMany({
    where: {
      calendarId: { in: calendarIds },
      description: { contains: "Ticket URL:" },
      ...(filterIds ? { id: { in: Array.from(filterIds) } } : {}),
    },
    select: { id: true, description: true, startTime: true, endTime: true },
  });

  const results: Array<{
    eventId: string;
    status: "fixed" | "skipped" | "error";
    reason?: string;
    oldStart?: string;
    newStart?: string;
  }> = [];

  for (const event of events) {
    const ticketUrl = extractTicketUrl(event.description);
    if (!ticketUrl) {
      results.push({ eventId: event.id, status: "skipped", reason: "no ticket URL" });
      continue;
    }

    const scraped = await scrapeEventTime(ticketUrl);
    if (!scraped || !scraped.date || !scraped.sourceTimezone) {
      results.push({ eventId: event.id, status: "skipped", reason: "scrape returned no date/timezone" });
      continue;
    }

    const correctStart = parseWithTimezone(scraped.date, scraped.time, scraped.sourceTimezone);
    if (!correctStart) {
      results.push({ eventId: event.id, status: "error", reason: "failed to parse corrected start time" });
      continue;
    }

    // Only update if the discrepancy is >= 15 minutes (avoids no-op writes)
    const diffMs = Math.abs(correctStart.getTime() - event.startTime.getTime());
    if (diffMs < 15 * 60 * 1000) {
      results.push({ eventId: event.id, status: "skipped", reason: "time already correct" });
      continue;
    }

    const durationMs = event.endTime.getTime() - event.startTime.getTime();
    const correctEnd = new Date(correctStart.getTime() + durationMs);

    await prisma.event.update({
      where: { id: event.id },
      data: { startTime: correctStart, endTime: correctEnd },
    });

    results.push({
      eventId: event.id,
      status: "fixed",
      oldStart: event.startTime.toISOString(),
      newStart: correctStart.toISOString(),
    });
  }

  const fixed = results.filter((r) => r.status === "fixed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json({ fixed, skipped, errors, results });
}
