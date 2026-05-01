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
  changes: FieldChange[];
}

// ---------------------------------------------------------------------------
// Parse structured fields back out of a stored description string
// ---------------------------------------------------------------------------
function parseStored(description: string | null): {
  prices: string[] | null;
  platforms: string[] | null;
  saleDate: string | null;
  venue: string | null;
  location: string | null;
} {
  if (!description) return { prices: null, platforms: null, saleDate: null, venue: null, location: null };

  const pricesLine = description.match(/Ticket Prices: (.+)/)?.[1] ?? null;
  const platformsLine = description.match(/Platforms: (.+)/)?.[1] ?? null;
  const saleDateLine = description.match(/Sale Date: (.+)/)?.[1] ?? null;
  const venueLine = description.match(/Venue: (.+)/)?.[1] ?? null;
  const locationLine = description.match(/Location: (.+)/)?.[1] ?? null;

  return {
    prices: pricesLine ? pricesLine.split(" / ").map((s) => s.trim()) : null,
    platforms: platformsLine ? platformsLine.split(", ").map((s) => s.trim()) : null,
    saleDate: saleDateLine?.trim() ?? null,
    venue: venueLine?.trim() ?? null,
    location: locationLine?.trim() ?? null,
  };
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

  let body: { url?: string; ticket?: ScrapedTicket };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url, ticket } = body;
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
      hasExisting: false, hasChanges: false, eventId: null, saleEventId: null, changes: [],
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
      hasExisting: false, hasChanges: false, eventId: null, saleEventId: null, changes: [],
    });
  }

  // Separate main event vs sale event
  const saleEvent = matchingEvents.find((e) => e.calendar.name === "sale-ticket") ?? null;
  const mainEvent = matchingEvents.find((e) => e.calendar.name !== "sale-ticket") ?? matchingEvents[0];

  // Parse stored fields
  const stored = parseStored(mainEvent.description);
  const storedSale = parseStored(saleEvent?.description ?? null);

  // Build diff
  const changes: FieldChange[] = [];

  // --- Event date ---
  const storedDate = normDate(mainEvent.startTime.toISOString().slice(0, 10));
  const newDate = normDate(ticket.date);
  if (newDate && storedDate !== newDate) {
    changes.push({
      field: "date",
      label: "Event Date 演出日期",
      oldValue: storedDate,
      newValue: newDate,
    });
  }

  // --- Event time ---
  const storedTime = mainEvent.startTime.toISOString().slice(11, 16); // HH:MM UTC
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
      label: "Sale Opens 開售日期",
      oldValue: storedSaleDate,
      newValue: newSaleDate,
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
    changes,
  });
}
