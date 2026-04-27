import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TICKET_CALENDAR_NAME = "ticket-reminders";
const TICKET_CALENDAR_COLOR = "#f97316"; // warm orange — distinct from default calendars

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

/** Parse a date+time string from the ticket into a JS Date.
 *  Falls back to tomorrow noon if parsing fails. */
function parseEventTime(date: string | null, time: string | null): { start: Date; end: Date } {
  const fallbackStart = new Date();
  fallbackStart.setDate(fallbackStart.getDate() + 1);
  fallbackStart.setHours(12, 0, 0, 0);

  if (!date) {
    const end = new Date(fallbackStart);
    end.setHours(end.getHours() + 2);
    return { start: fallbackStart, end };
  }

  // Try ISO date (YYYY-MM-DD)
  const isoMatch = date.match(/(\d{4})-(\d{2})-(\d{2})/);
  let start: Date;

  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    if (time) {
      const [hStr, minStr] = time.split(":");
      start = new Date(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hStr ?? 12),
        Number(minStr ?? 0)
      );
    } else {
      start = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
    }
  } else {
    // Try natural language parsing
    const parsed = new Date(date + (time ? ` ${time}` : ""));
    start = isNaN(parsed.getTime()) ? fallbackStart : parsed;
  }

  const end = new Date(start);
  end.setHours(end.getHours() + 2); // assume 2-hour event

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
  const { start, end } = parseEventTime(ticket.date, ticket.time);

  // Build description with source URL appended
  const descParts: string[] = [];
  if (ticket.description) descParts.push(ticket.description);
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
      color: TICKET_CALENDAR_COLOR,
    },
  });

  return NextResponse.json({
    eventId: event.id,
    calendarId: calendar.id,
    calendarName: calendar.name,
    start: event.startTime.toISOString(),
    end: event.endTime.toISOString(),
  });
}
