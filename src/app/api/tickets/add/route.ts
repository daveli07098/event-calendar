import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TICKET_CALENDAR_NAME = "event-reminders";
const TICKET_CALENDAR_COLOR = "#f97316"; // warm orange — distinct from default calendars

const SALE_CALENDAR_NAME = "sale-ticket";
const SALE_CALENDAR_COLOR = "#8b5cf6"; // purple — alerts for when sales open

interface TicketData {
  title: string;
  date: string | null;
  time: string | null;
  endDate?: string | null;
  endTime?: string | null;
  venue: string | null;
  location: string | null;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string;
  aiUsed: string;
  ticketPrices: string[] | null;
  ticketPlatforms: string[] | null;
  saleDate: string | null;
}

/** Parse a single date+time into a JS Date, with a fallback. */
function parseSingleDateTime(date: string | null, time: string | null, fallback: Date): Date {
  if (!date) return fallback;
  const isoMatch = date.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    if (time) {
      const [hStr, minStr] = time.split(":");
      return new Date(Number(y), Number(m) - 1, Number(d), Number(hStr ?? 12), Number(minStr ?? 0));
    }
    return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
  }
  const parsed = new Date(date + (time ? ` ${time}` : ""));
  return isNaN(parsed.getTime()) ? fallback : parsed;
}

/** Parse a date+time string from the ticket into a JS Date.
 *  Falls back to tomorrow noon if parsing fails. */
function parseEventTime(
  date: string | null,
  time: string | null,
  endDate?: string | null,
  endTime?: string | null,
): { start: Date; end: Date } {
  const fallbackStart = new Date();
  fallbackStart.setDate(fallbackStart.getDate() + 1);
  fallbackStart.setHours(12, 0, 0, 0);

  const start = parseSingleDateTime(date, time, fallbackStart);

  let end: Date;
  if (endDate || endTime) {
    // End date defaults to same day as start if only endTime given
    end = parseSingleDateTime(
      endDate ?? date,
      endTime ?? null,
      new Date(start.getTime() + 2 * 3600000),
    );
    if (end <= start) end = new Date(start.getTime() + 2 * 3600000); // sanity: end must be after start
  } else {
    end = new Date(start);
    end.setHours(end.getHours() + 2); // assume 2-hour event
  }

  return { start, end };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticket?: TicketData };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ticket } = body;
  if (!ticket || typeof ticket.title !== "string") {
    return NextResponse.json({ error: "ticket data is required" }, { status: 400 });
  }

  const uid = session.user.id;

  // Find or create the "ticket-reminders" calendar
  let calendar = await prisma.calendar.findFirst({
    where: { userId: uid, name: TICKET_CALENDAR_NAME },
  });

  if (!calendar) {
    calendar = await prisma.calendar.create({
      data: {
        userId: uid,
        name: TICKET_CALENDAR_NAME,
        color: TICKET_CALENDAR_COLOR,
        isDefault: false,
        isVisible: true,
      },
    });
  }

  // Build event times
  const { start, end } = parseEventTime(ticket.date, ticket.time, ticket.endDate, ticket.endTime);

  // Build description with ticket info and source URL appended
  const descParts: string[] = [];
  if (ticket.description) descParts.push(ticket.description);
  if (ticket.ticketPrices?.length) descParts.push(`門票票價 Ticket Prices: ${ticket.ticketPrices.join(" / ")}`);
  if (ticket.ticketPlatforms?.length) descParts.push(`售票平台 Platforms: ${ticket.ticketPlatforms.join(", ")}`);
  if (ticket.saleDate) descParts.push(`開售日期 Sale Date: ${ticket.saleDate}`);
  if (ticket.venue) descParts.push(`Venue: ${ticket.venue}`);
  if (ticket.location) descParts.push(`Location: ${ticket.location}`);
  descParts.push(`Ticket URL: ${ticket.sourceUrl}`);
  const description = descParts.join("\n\n");

  // Create the event
  const event = await prisma.event.create({
    data: {
      calendarId: calendar.id,
      title: ticket.title,
      description,
      startTime: start,
      endTime: end,
      location: [ticket.venue, ticket.location].filter(Boolean).join(", ") || null,
    },
  });

  // If there's a sale date, also create a reminder in the "sale-ticket" calendar
  let saleEvent: { id: string } | null = null;
  if (ticket.saleDate) {
    const { start: saleStart, end: saleEnd } = parseEventTime(ticket.saleDate, null);

    let saleCalendar = await prisma.calendar.findFirst({
      where: { userId: uid, name: SALE_CALENDAR_NAME },
    });
    if (!saleCalendar) {
      saleCalendar = await prisma.calendar.create({
        data: {
          userId: uid,
          name: SALE_CALENDAR_NAME,
          color: SALE_CALENDAR_COLOR,
          isDefault: false,
          isVisible: true,
        },
      });
    }

    const saleDesc = [
      `售票開始！Ticket sale opens for: ${ticket.title}`,
      ticket.ticketPrices?.length ? `票價 Prices: ${ticket.ticketPrices.join(" / ")}` : null,
      ticket.ticketPlatforms?.length ? `平台 Platforms: ${ticket.ticketPlatforms.join(", ")}` : null,
      ticket.date ? `演出日期 Event date: ${ticket.date}${ticket.time ? " " + ticket.time : ""}` : null,
      `Ticket URL: ${ticket.sourceUrl}`,
    ].filter(Boolean).join("\n\n");

    saleEvent = await prisma.event.create({
      data: {
        calendarId: saleCalendar.id,
        title: `🎫 Sale Opens: ${ticket.title}`,
        description: saleDesc,
        startTime: saleStart,
        endTime: saleEnd,
        location: null,
      },
    });
  }

  return NextResponse.json({
    eventId: event.id,
    calendarId: calendar.id,
    calendarName: calendar.name,
    start: event.startTime.toISOString(),
    end: event.endTime.toISOString(),
    saleEventId: saleEvent?.id ?? null,
  });
}
