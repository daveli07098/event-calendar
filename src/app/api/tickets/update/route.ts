import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

// ---------------------------------------------------------------------------
// Rebuild description string from ticket data (matches add/route.ts format)
// ---------------------------------------------------------------------------
function buildDescription(ticket: ScrapedTicket): string {
  const parts: string[] = [];
  if (ticket.description) parts.push(ticket.description);
  if (ticket.ticketPrices?.length) parts.push(`門票票價 Ticket Prices: ${ticket.ticketPrices.join(" / ")}`);
  if (ticket.ticketPlatforms?.length) parts.push(`售票平台 Platforms: ${ticket.ticketPlatforms.join(", ")}`);
  if (ticket.saleDate) parts.push(`開售日期 Sale Date: ${ticket.saleDate}`);
  if (ticket.venue) parts.push(`Venue: ${ticket.venue}`);
  if (ticket.location) parts.push(`Location: ${ticket.location}`);
  parts.push(`Ticket URL: ${ticket.sourceUrl}`);
  return parts.join("\n\n");
}

function buildSaleDescription(ticket: ScrapedTicket): string {
  return [
    `售票開始！Ticket sale opens for: ${ticket.title}`,
    ticket.ticketPrices?.length ? `票價 Prices: ${ticket.ticketPrices.join(" / ")}` : null,
    ticket.ticketPlatforms?.length ? `平台 Platforms: ${ticket.ticketPlatforms.join(", ")}` : null,
    ticket.date ? `演出日期 Event date: ${ticket.date}${ticket.time ? " " + ticket.time : ""}` : null,
    `Ticket URL: ${ticket.sourceUrl}`,
  ].filter(Boolean).join("\n\n");
}

/** Parse date+time as user-local time and return a UTC Date using tzOffsetMinutes. */
function parseLocalToUTC(date: string | null, time: string | null, tzOffsetMinutes: number): Date | null {
  if (!date) return null;
  const isoMatch = date.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!isoMatch) {
    const parsed = new Date(date + (time ? ` ${time}` : ""));
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, y, m, d] = isoMatch;
  const [h = "12", min = "00"] = (time ?? "12:00").split(":");
  // Create as if server-local (UTC), then shift by tzOffset to get true UTC:
  // user-local 20:00 HKT (offset=-480) → UTC = 20:00 + (-480/60) = 20:00 - 8 = 12:00 UTC
  const localDate = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min));
  return new Date(localDate.getTime() + tzOffsetMinutes * 60_000);
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/tickets/update
// Body: { eventId, saleEventId?, appliedFields: string[], ticket: ScrapedTicket }
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    eventId?: string;
    saleEventId?: string | null;
    appliedFields?: string[];
    ticket?: ScrapedTicket;
    tzOffsetMinutes?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, saleEventId, appliedFields, ticket, tzOffsetMinutes = 0 } = body;
  if (!eventId || !appliedFields || !ticket) {
    return NextResponse.json({ error: "eventId, appliedFields, ticket required" }, { status: 400 });
  }

  try {
  // Verify ownership
  const existingEvent = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: true },
  });
  if (!existingEvent || existingEvent.calendar.userId !== session.user.id) {
    return NextResponse.json({ error: "Event not found or access denied" }, { status: 404 });
  }

  const apply = new Set(appliedFields);

  // Build update payload for main event
  const mainUpdate: Record<string, unknown> = {
    description: buildDescription(ticket), // always rebuild with latest data
  };

  if (apply.has("date") || apply.has("time")) {
    const dateSrc = apply.has("date") ? ticket.date : existingEvent.startTime.toISOString().slice(0, 10);
    // For time: if user applied the time change use ticket.time (local), else keep stored UTC time
    const timeSrc = apply.has("time") ? ticket.time : null;
    let newStart: Date | null;
    if (timeSrc !== null) {
      // ticket.time is local — convert to UTC using client offset
      newStart = parseLocalToUTC(dateSrc, timeSrc, tzOffsetMinutes);
    } else {
      // Keep the existing stored time, only change the date
      const existingTimeUTC = existingEvent.startTime.toISOString().slice(11, 16);
      newStart = parseLocalToUTC(dateSrc, existingTimeUTC, 0); // already UTC
    }
    if (newStart) {
      const newEnd = new Date(newStart);
      newEnd.setHours(newEnd.getHours() + 2);
      mainUpdate.startTime = newStart;
      mainUpdate.endTime = newEnd;
    }
  }

  if (apply.has("venue") || apply.has("location") || apply.has("ticketPrices") || apply.has("ticketPlatforms")) {
    mainUpdate.location = [ticket.venue, ticket.location].filter(Boolean).join(", ") || existingEvent.location;
  }

  const updatedEvent = await prisma.event.update({
    where: { id: eventId },
    data: mainUpdate,
  });

  // Update sale event description whenever main event fields change (keeps it in sync)
  let updatedSaleEvent = null;
  const saleFieldsChanged = apply.has("date") || apply.has("time") || apply.has("title") || apply.has("ticketPrices") || apply.has("saleDate");
  if (saleEventId && saleFieldsChanged) {
    const saleUpdateData: Record<string, unknown> = {
      description: buildSaleDescription(ticket),
    };
    // Also update the sale event's startTime if saleDate changed
    if (apply.has("saleDate") && ticket.saleDate) {
      const saleStart = parseLocalToUTC(ticket.saleDate, null, tzOffsetMinutes);
      if (saleStart) {
        const saleEnd = new Date(saleStart);
        saleEnd.setHours(saleEnd.getHours() + 1);
        saleUpdateData.startTime = saleStart;
        saleUpdateData.endTime = saleEnd;
      }
    }
    updatedSaleEvent = await prisma.event.update({
      where: { id: saleEventId },
      data: saleUpdateData,
    });
  }

  return NextResponse.json({
    updated: true,
    eventId: updatedEvent.id,
    saleEventId: updatedSaleEvent?.id ?? null,
    appliedFields,
  });
  } catch (e) {
    console.error("[tickets/update] Prisma error:", e);
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
