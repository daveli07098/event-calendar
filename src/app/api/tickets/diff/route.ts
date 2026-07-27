import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types (mirrored from scrape route — keep in sync)
// ---------------------------------------------------------------------------
interface ScrapedTicket {
  title: string;
  date: string | null;
  time: string | null;
  venue: string | null;
  location: string | null;
  description: string | null;
  ticketPrices: string[] | null;
  ticketPlatforms: string[] | null;
  saleDate: string | null;
  saleFirstDate: string | null;
  saleDates: Array<{ date: string; time: string | null; label: string }> | null;
  sourceUrl: string;
  category?: string | null;
  sourceTimezone?: string | null; // ±HH:MM offset from scrape route (e.g. "+09:00" for JST)
}

export interface FieldChange {
  field: string;           // machine key
  label: string;           // human label shown in UI
  oldValue: string | null;
  newValue: string | null;
}

export interface DiffResult {
  hasExisting: boolean;
  hasChanges: boolean;
  eventId: string | null;
  /** All sale-ticket calendar events for this ticket, keyed by window label. */
  saleEventIds: Record<string, string>;
  /** @deprecated use saleEventIds["Public Sale"] or saleEventIds["Sale Opens"] */
  saleEventId: string | null;
  /** @deprecated use saleEventIds["Fan Presale"] */
  presaleEventId: string | null;
  changes: FieldChange[];
  // Static context — current stored values, shown even when unchanged
  storedDate: string | null;
  storedTime: string | null;
  storedVenue: string | null;
  /** All stored sale window events for this ticket, for display in diff context panel */
  storedSaleWindows: Array<{ label: string; date: string; time: string }>;
}

// ---------------------------------------------------------------------------
// Parse structured fields back out of a stored description string
// ---------------------------------------------------------------------------
function parseStored(description: string | null): {
  prices: string[] | null;
  platforms: string[] | null;
  saleDate: string | null;
  saleFirstDate: string | null;
  venue: string | null;
  location: string | null;
} {
  if (!description) return { prices: null, platforms: null, saleDate: null, saleFirstDate: null, venue: null, location: null };

  const pricesLine = description.match(/Ticket Prices: (.+)/)?.[1] ?? null;
  const platformsLine = description.match(/Platforms: (.+)/)?.[1] ?? null;
  const saleDateLine = description.match(/Sale Date: (.+)/)?.[1] ?? null;
  const saleFirstDateLine = description.match(/First Sale Date: (.+)/)?.[1] ?? null;
  const venueLine = description.match(/Venue: (.+)/)?.[1] ?? null;
  const locationLine = description.match(/Location: (.+)/)?.[1] ?? null;

  return {
    prices: pricesLine ? pricesLine.split(" / ").map((s) => s.trim()) : null,
    platforms: platformsLine ? platformsLine.split(", ").map((s) => s.trim()) : null,
    saleDate: saleDateLine?.trim() ?? null,
    saleFirstDate: saleFirstDateLine?.trim() ?? null,
    venue: venueLine?.trim() ?? null,
    location: locationLine?.trim() ?? null,
  };
}

/** Extract window label from a sale event title.
 *  Title format: "${emoji} ${label}: ${eventTitle}" e.g. "⭐ Fan Presale: Charlie Puth…" */
function extractLabelFromTitle(title: string): string | null {
  // Split on first ": " → "⭐ Fan Presale" → drop first space-separated token (emoji)
  const beforeColon = title.split(": ")[0];
  if (!beforeColon) return null;
  const parts = beforeColon.split(" ");
  if (parts.length < 2) return null;
  return parts.slice(1).join(" ").trim() || null;
}

/**
 * Convert a stored UTC instant to a date/time string for comparison against the
 * freshly-scraped wall-clock value.
 *
 * When `sourceTimezone` (a ±HH:MM offset resolved for the VENUE, e.g. "+09:00"
 * for JST) is available, convert into that zone instead of the viewer's. This
 * is the diff route's half of the timezone data-corruption bug fix: comparing
 * the stored instant against `ticket.date`/`ticket.time` (which are venue
 * wall-clock, not viewer wall-clock) only makes sense if both sides are in the
 * same zone. Converting with the client's `offsetMinutes` instead had two
 * failure modes:
 *  - false positive: a correctly-stored non-HK event reported a spurious
 *    "changed" on every sync (viewer zone != venue zone).
 *  - false negative: an already-corrupted row (wrong offset baked into the
 *    stored instant) diffed as "no change", because the same wrong offset was
 *    applied on both sides and canceled out — this is why Sync couldn't
 *    self-heal a corrupted row. With the venue offset now used consistently,
 *    a corrupted stored instant surfaces as a real diff instead.
 *
 * Falls back to the viewer's `offsetMinutes` (original behavior) when
 * sourceTimezone is unknown — e.g. events with no detectable source timezone.
 *
 * offsetMinutes = new Date().getTimezoneOffset() from the client
 * (negative for UTC+ zones, e.g. -480 for HKT)
 */
function utcToLocal(utcDate: Date, offsetMinutes: number, sourceTimezone?: string | null): { date: string; time: string } {
  if (sourceTimezone) {
    const sign = sourceTimezone.startsWith("-") ? -1 : 1;
    const [hh = "0", mm = "0"] = sourceTimezone.replace(/[+-]/, "").split(":");
    const offsetMs = sign * (parseInt(hh, 10) * 60 + parseInt(mm, 10)) * 60_000;
    const local = new Date(utcDate.getTime() + offsetMs);
    return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) };
  }
  // localMs = utcMs - offsetMinutes * 60000
  // For HKT (offset=-480): utcMs - (-480*60000) = utcMs + 8h ✓
  const localMs = utcDate.getTime() - offsetMinutes * 60_000;
  const d = new Date(localMs);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}

/** Normalise a date string to "YYYY-MM-DD" for comparison. Returns original string if can't parse. */
function normDate(d: string | null): string | null {
  if (!d) return null;
  const iso = d.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  return iso ?? d.trim();
}

/** Join array nicely for display / comparison */
const join = (arr: string[] | null) => arr?.join(" / ") ?? null;

// ---------------------------------------------------------------------------
// Route: POST /api/tickets/diff
// Body: { url: string, ticket: ScrapedTicket }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { url?: string; ticket?: ScrapedTicket; tzOffsetMinutes?: number; eventId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url, ticket, tzOffsetMinutes = 0, eventId } = body;
  if (!url || !ticket) {
    return NextResponse.json({ error: "url and ticket required" }, { status: 400 });
  }

  const uid = session.user.id;

  // Find all accessible calendars for this user
  const calendars = await prisma.calendar.findMany({
    where: { userId: uid },
    select: { id: true, name: true },
  });
  const calendarIds = calendars.map((c) => c.id);

  if (calendarIds.length === 0) {
    return NextResponse.json<DiffResult>({
      hasExisting: false, hasChanges: false, eventId: null,
      saleEventIds: {}, saleEventId: null, presaleEventId: null,
      changes: [], storedDate: null, storedTime: null, storedVenue: null, storedSaleWindows: [],
    });
  }

  // Find existing events that reference this URL in their description
  const matchingEvents = await prisma.event.findMany({
    where: {
      calendarId: { in: calendarIds },
      description: { contains: `Ticket URL: ${url}` },
    },
    include: { calendar: true },
  });

  // Fallback anchor: events synced via a reference URL may have no "Ticket URL:"
  // line in their description — target them directly by id.
  if (matchingEvents.length === 0 && eventId) {
    const byId = await prisma.event.findFirst({
      where: { id: eventId, calendarId: { in: calendarIds } },
      include: { calendar: true },
    });
    if (byId) matchingEvents.push(byId);
  }

  if (matchingEvents.length === 0) {
    return NextResponse.json<DiffResult>({
      hasExisting: false, hasChanges: false, eventId: null,
      saleEventIds: {}, saleEventId: null, presaleEventId: null,
      changes: [], storedDate: null, storedTime: null, storedVenue: null, storedSaleWindows: [],
    });
  }

  // Separate main event vs sale events (all of them)
  const allSaleEvents = matchingEvents.filter((e) => e.calendar.name === "sale-ticket");
  const mainEvent = matchingEvents.find((e) => e.calendar.name !== "sale-ticket") ?? matchingEvents[0];

  // Build label → event map for ALL sale windows
  const saleEventIds: Record<string, string> = {};
  for (const se of allSaleEvents) {
    const label = extractLabelFromTitle(se.title);
    if (label) saleEventIds[label] = se.id;
  }

  // Backward-compat: find legacy "Sale Opens" / "Fan Presale" events by name
  const saleEvent = allSaleEvents.find((e) => e.title.includes("Sale Opens") || e.title.includes("Public Sale")) ?? null;
  const presaleEvent = allSaleEvents.find((e) => e.title.includes("Fan Presale")) ?? null;

  // Parse stored fields
  const stored = parseStored(mainEvent.description);
  const storedSale = parseStored(saleEvent?.description ?? null);
  const storedPresale = parseStored(presaleEvent?.description ?? null);

  // Convert stored UTC timestamp to user-local date/time for comparison
  const localStart = utcToLocal(mainEvent.startTime, tzOffsetMinutes, ticket.sourceTimezone);

  // Build diff
  const changes: FieldChange[] = [];

  // --- Event date ---
  const storedDate = normDate(localStart.date);
  const newDate = normDate(ticket.date);
  if (newDate && storedDate !== newDate) {
    changes.push({ field: "date", label: "Event Date 演出日期", oldValue: storedDate, newValue: newDate });
  }

  // --- Event time (both in local timezone) ---
  const storedTime = localStart.time;
  const newTime = ticket.time;
  if (newTime && storedTime !== newTime) {
    changes.push({ field: "time", label: "Event Time 演出時間", oldValue: storedTime, newValue: newTime });
  }

  // --- Ticket prices ---
  const storedPrices = join(stored.prices);
  const newPrices = join(ticket.ticketPrices);
  if (newPrices && storedPrices !== newPrices) {
    changes.push({ field: "ticketPrices", label: "Ticket Prices 門票票價", oldValue: storedPrices, newValue: newPrices });
  }

  // --- Ticket platforms ---
  const storedPlatforms = join(stored.platforms);
  const newPlatforms = join(ticket.ticketPlatforms);
  if (newPlatforms && storedPlatforms !== newPlatforms) {
    changes.push({ field: "ticketPlatforms", label: "Sale Platforms 售票平台", oldValue: storedPlatforms, newValue: newPlatforms });
  }

  // --- Sale window dates ---
  // If we have a full saleDates[] array, compare each window individually.
  // Otherwise fall back to scalar saleDate / saleFirstDate comparison.
  if (ticket.saleDates?.length) {
    for (const window of ticket.saleDates) {
      const matchedEvent = allSaleEvents.find((se) => extractLabelFromTitle(se.title) === window.label);
      const storedWindowDate = matchedEvent ? utcToLocal(matchedEvent.startTime, tzOffsetMinutes, ticket.sourceTimezone).date : null;
      const newWindowDate = normDate(window.date);

      if (newWindowDate && storedWindowDate !== newWindowDate) {
        const display = window.time ? `${window.date} ${window.time}` : window.date;
        changes.push({
          field: `saleWin::${window.label}`,
          label: `${window.label}${storedWindowDate ? "" : " (new)"}`,
          oldValue: storedWindowDate,
          newValue: display,
        });
      }
    }
  } else {
    // Legacy scalar comparison
    const storedSaleDate = normDate(stored.saleDate ?? storedSale.saleDate);
    const newSaleDate = normDate(ticket.saleDate);
    if (newSaleDate && storedSaleDate !== newSaleDate) {
      changes.push({ field: "saleDate", label: "Public Sale Opens 公開發售日期", oldValue: storedSaleDate, newValue: newSaleDate });
    }

    const storedFirstSaleDate = normDate(stored.saleFirstDate ?? storedPresale.saleFirstDate);
    const newFirstSaleDate = normDate(ticket.saleFirstDate);
    if (newFirstSaleDate && storedFirstSaleDate !== newFirstSaleDate) {
      changes.push({ field: "saleFirstDate", label: "Fan Presale Opens 會員優先購票", oldValue: storedFirstSaleDate, newValue: newFirstSaleDate });
    }
  }

  // --- Venue ---
  if (ticket.venue && stored.venue && stored.venue !== ticket.venue.trim()) {
    changes.push({ field: "venue", label: "Venue 場地", oldValue: stored.venue, newValue: ticket.venue });
  }

  // --- Category ---
  if (ticket.category && ticket.category !== mainEvent.category) {
    const CATEGORY_LABELS: Record<string, string> = {
      concert: "🎵 Concert", exhibition: "🗻 Exhibition", theatre: "🎭 Theatre / Musical",
      sports: "⚽ Sports", festival: "🎉 Festival", anime: "🌸 Anime / IP",
      popup: "🏪 Pop-up / Café", kuji: "🎲 Ichiban Kuji", crane: "🕹️ Crane Game", comedy: "😂 Comedy", film: "🎬 Film",
      food: "🍽 Food", ticket: "🎫 Ticket Sale", other: "📌 Other",
    };
    const oldLabel = mainEvent.category ? (CATEGORY_LABELS[mainEvent.category] ?? mainEvent.category) : null;
    const newLabel = CATEGORY_LABELS[ticket.category] ?? ticket.category;
    changes.push({ field: "category", label: "Category 分類", oldValue: oldLabel, newValue: newLabel });
  }

  const storedSaleWindows = allSaleEvents
    .map((se) => {
      const label = extractLabelFromTitle(se.title) ?? se.title;
      const local = utcToLocal(se.startTime, tzOffsetMinutes, ticket.sourceTimezone);
      return { label, date: local.date, time: local.time };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json<DiffResult>({
    hasExisting: true,
    hasChanges: changes.length > 0,
    eventId: mainEvent.id,
    saleEventIds,
    saleEventId: saleEvent?.id ?? null,
    presaleEventId: presaleEvent?.id ?? null,
    changes,
    storedDate: localStart.date,
    storedTime: localStart.time,
    storedVenue: stored.venue ?? null,
    storedSaleWindows,
  });
}
