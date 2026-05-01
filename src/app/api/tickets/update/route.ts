import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { FieldChange } from "../diff/route";

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

/** Parse date+time into a Date. Returns null if unparseable. */
function parseDateTime(date: string | null, time: string | null): Date | null {
  if (!date) return null;
  const isoMatch = date.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!isoMatch) {
    const parsed = new Date(date + (time ? ` ${time}` : ""));
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, y, m, d] = isoMatch;
  const [h = "12", min = "00"] = (time ?? "12:00").split(":");
  return new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min));
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
    appliedFields?: string[];   // field keys the user confirmed to apply
    ticket?: ScrapedTicket;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, saleEventId, appliedFields, ticket } = body;
  if (!eventId || !appliedFields || !ticket) {
    return NextResponse.json({ error: "eventId, appliedFields, ticket required" }, { status: 400 });
  }

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
    const timeSrc = apply.has("time") ? ticket.time : existingEvent.startTime.toISOString().slice(11, 16);
    const newStart = parseDateTime(dateSrc, timeSrc);
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

  // Update sale event if it exists and saleDate changed
  let updatedSaleEvent = null;
  if (saleEventId && apply.has("saleDate") && ticket.saleDate) {
    const saleStart = parseDateTime(ticket.saleDate, null);
    if (saleStart) {
      const saleEnd = new Date(saleStart);
      saleEnd.setHours(saleEnd.getHours() + 1);

      updatedSaleEvent = await prisma.event.update({
        where: { id: saleEventId },
        data: {
          description: buildSaleDescription(ticket),
          startTime: saleStart,
          endTime: saleEnd,
        },
      });
    }
  }

  return NextResponse.json({
    updated: true,
    eventId: updatedEvent.id,
    saleEventId: updatedSaleEvent?.id ?? null,
    appliedFields,
  });
}
