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
  sourceUrl: string;
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
  saleEventId: string | null;
  presaleEventId: string | null;
  changes: FieldChange[];
  // Static context — current stored values, shown even when unchanged
  storedDate: string | null;
  storedTime: string | null;
  storedVenue: string | null;
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

/**
 * Convert a UTC Date to local date/time strings using a timezone offset.
 * offsetMinutes = new Date().getTimezoneOffset() from the client
 * (negative for UTC+ zones, e.g. -480 for HKT)
 */
function utcToLocal(utcDate: Date, offsetMinutes: number): { date: string; time: string } {
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

  let body: { url?: string; ticket?: ScrapedTicket; tzOffsetMinutes?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url, ticket, tzOffsetMinutes = 0 } = body;
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
      hasExisting: false, hasChanges: false, eventId: null, saleEventId: null, presaleEventId: null, changes: [],
      storedDate: null, storedTime: null, storedVenue: null,
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

  if (matchingEvents.length === 0) {
    return NextResponse.json<DiffResult>({
      hasExisting: false, hasChanges: false, eventId: null, saleEventId: null, presaleEventId: null, changes: [],
      storedDate: null, storedTime: null, storedVenue: null,
    });
  }

  // Separate main event vs sale events
  const saleEvent = matchingEvents.find((e) => e.calendar.name === "sale-ticket" && e.title.includes("Sale Opens")) ?? null;
  const presaleEvent = matchingEvents.find((e) => e.calendar.name === "sale-ticket" && e.title.includes("Fan Presale")) ?? null;
  const mainEvent = matchingEvents.find((e) => e.calendar.name !== "sale-ticket") ?? matchingEvents[0];

  // Parse stored fields
  const stored = parseStored(mainEvent.description);
  const storedSale = parseStored(saleEvent?.description ?? null);
  const storedPresale = parseStored(presaleEvent?.description ?? null);

  // Convert stored UTC timestamp to user-local date/time for comparison
  const localStart = utcToLocal(mainEvent.startTime, tzOffsetMinutes);

  // Build diff
  const changes: FieldChange[] = [];

  // --- Event date ---
  const storedDate = normDate(localStart.date);
  const newDate = normDate(ticket.date);
  if (newDate && storedDate !== newDate) {
    changes.push({
      field: "date",
      label: "Event Date 演出日期",
      oldValue: storedDate,
      newValue: newDate,
    });
  }

  // --- Event time (both in local timezone) ---
  const storedTime = localStart.time; // local HH:MM
  const newTime = ticket.time;
  if (newTime && storedTime !== newTime) {
    changes.push({
      field: "time",
      label: "Event Time 演出時間",
      oldValue: storedTime,
      newValue: newTime,
    });
  }

  // --- Ticket prices ---
  const storedPrices = join(stored.prices);
  const newPrices = join(ticket.ticketPrices);
  if (newPrices && storedPrices !== newPrices) {
    changes.push({
      field: "ticketPrices",
      label: "Ticket Prices 門票票價",
      oldValue: storedPrices,
      newValue: newPrices,
    });
  }

  // --- Ticket platforms ---
  const storedPlatforms = join(stored.platforms);
  const newPlatforms = join(ticket.ticketPlatforms);
  if (newPlatforms && storedPlatforms !== newPlatforms) {
    changes.push({
      field: "ticketPlatforms",
      label: "Sale Platforms 售票平台",
      oldValue: storedPlatforms,
      newValue: newPlatforms,
    });
  }

  // --- Sale date ---
  const storedSaleDate = normDate(stored.saleDate ?? storedSale.saleDate);
  const newSaleDate = normDate(ticket.saleDate);
  if (newSaleDate && storedSaleDate !== newSaleDate) {
    changes.push({
      field: "saleDate",
      label: "Public Sale Opens 公開發售日期",
      oldValue: storedSaleDate,
      newValue: newSaleDate,
    });
  }

  // --- First / presale date ---
  const storedFirstSaleDate = normDate(stored.saleFirstDate ?? storedPresale.saleFirstDate);
  const newFirstSaleDate = normDate(ticket.saleFirstDate);
  if (newFirstSaleDate && storedFirstSaleDate !== newFirstSaleDate) {
    changes.push({
      field: "saleFirstDate",
      label: "Fan Presale Opens 會員優先購票",
      oldValue: storedFirstSaleDate,
      newValue: newFirstSaleDate,
    });
  }

  // --- Venue ---
  if (ticket.venue && stored.venue && stored.venue !== ticket.venue.trim()) {
    changes.push({
      field: "venue",
      label: "Venue 場地",
      oldValue: stored.venue,
      newValue: ticket.venue,
    });
  }

  return NextResponse.json<DiffResult>({
    hasExisting: true,
    hasChanges: changes.length > 0,
    eventId: mainEvent.id,
    saleEventId: saleEvent?.id ?? null,
    presaleEventId: presaleEvent?.id ?? null,
    changes,
    storedDate: localStart.date,
    storedTime: localStart.time,
    storedVenue: stored.venue ?? null,
  });
}
