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
  saleFirstDate: string | null;
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

  let body: { ticket?: TicketData; targetCalendarId?: string; targetSaleCalendarId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ticket, targetCalendarId, targetSaleCalendarId } = body;
  if (!ticket || typeof ticket.title !== "string") {
    return NextResponse.json({ error: "ticket data is required" }, { status: 400 });
  }

  const uid = session.user.id;

  // ── Resolve target calendar ─────────────────────────────────────────
  // Returns { calendar, isCollaborative }.
  // If collaborative, the caller must also write a shadow copy to the user's own calendar.
  async function resolveCalendar(
    targetId: string | undefined,
    calName: string,
    calColor: string,
  ) {
    if (targetId) {
      const cal = await prisma.calendar.findUnique({ where: { id: targetId } });
      if (!cal) return null;

      if (cal.userId === uid) {
        // Targeting own calendar — ensure it's visible
        if (!cal.isVisible) {
          await prisma.calendar.update({ where: { id: cal.id }, data: { isVisible: true } });
        }
        return { calendar: { ...cal, isVisible: true }, isCollaborative: false };
      }

      // Collaborative calendar — verify membership
      const membership = await prisma.calendarMember.findUnique({
        where: { calendarId_userId: { calendarId: targetId, userId: uid } },
      });
      if (!membership || cal.shareMode !== "collaborative") return null;
      return { calendar: cal, isCollaborative: true };
    }

    // No explicit target — find or create own calendar
    let calendar = await prisma.calendar.findFirst({ where: { userId: uid, name: calName } });
    if (!calendar) {
      calendar = await prisma.calendar.create({
        data: { userId: uid, name: calName, color: calColor, isDefault: false, isVisible: true },
      });
    }
    return { calendar, isCollaborative: false };
  }

  // Shared helper: create a shadow copy in the user's own calendar (hidden by default)
  async function ensureShadowCalendar(calName: string, calColor: string) {
    let own = await prisma.calendar.findFirst({ where: { userId: uid, name: calName } });
    if (!own) {
      own = await prisma.calendar.create({
        data: { userId: uid, name: calName, color: calColor, isDefault: false, isVisible: false },
      });
    }
    return own;
  }

  const resolved = await resolveCalendar(targetCalendarId, TICKET_CALENDAR_NAME, TICKET_CALENDAR_COLOR);
  if (!resolved) {
    return NextResponse.json({ error: "Target calendar not found or access denied" }, { status: 404 });
  }
  const { calendar, isCollaborative } = resolved;

  // Build event times
  const { start, end } = parseEventTime(ticket.date, ticket.time, ticket.endDate, ticket.endTime);

  // Build description with ticket info and source URL appended
  const descParts: string[] = [];
  if (ticket.description) descParts.push(ticket.description);
  if (ticket.ticketPrices?.length) descParts.push(`門票票價 Ticket Prices: ${ticket.ticketPrices.join(" / ")}`);
  if (ticket.ticketPlatforms?.length) descParts.push(`售票平台 Platforms: ${ticket.ticketPlatforms.join(", ")}`);
  if (ticket.saleDate) descParts.push(`開售日期 Sale Date: ${ticket.saleDate}`);
  if (ticket.saleFirstDate) descParts.push(`First Sale Date: ${ticket.saleFirstDate}`);
  if (ticket.venue) descParts.push(`Venue: ${ticket.venue}`);
  if (ticket.location) descParts.push(`Location: ${ticket.location}`);
  descParts.push(`Ticket URL: ${ticket.sourceUrl}`);
  const description = descParts.join("\n\n");

  // Create the event
  const eventData = {
    title: ticket.title,
    description,
    startTime: start,
    endTime: end,
    location: [ticket.venue, ticket.location].filter(Boolean).join(", ") || null,
  };

  const event = await prisma.event.create({
    data: { calendarId: calendar.id, ...eventData },
  });

  // If target is collaborative, create a hidden shadow copy in user's own calendar
  if (isCollaborative) {
    const shadowCal = await ensureShadowCalendar(TICKET_CALENDAR_NAME, TICKET_CALENDAR_COLOR);
    await prisma.event.create({ data: { calendarId: shadowCal.id, ...eventData } });
  }

  // If there's a public sale date, create a reminder in the "sale-ticket" calendar
  let saleEvent: { id: string } | null = null;
  let presaleEvent: { id: string } | null = null;

  if (ticket.saleDate || ticket.saleFirstDate) {
    const saleResolved = await resolveCalendar(targetSaleCalendarId, SALE_CALENDAR_NAME, SALE_CALENDAR_COLOR);
    const saleCalendar = saleResolved?.calendar ?? await (async () => {
      let c = await prisma.calendar.findFirst({ where: { userId: uid, name: SALE_CALENDAR_NAME } });
      if (!c) c = await prisma.calendar.create({ data: { userId: uid, name: SALE_CALENDAR_NAME, color: SALE_CALENDAR_COLOR, isDefault: false, isVisible: true } });
      return c;
    })();
    const saleIsCollaborative = saleResolved?.isCollaborative ?? false;

    if (ticket.saleDate) {
      const { start: saleStart, end: saleEnd } = parseEventTime(ticket.saleDate, null);
      const saleDesc = [
        `售票開始！Public sale opens for: ${ticket.title}`,
        ticket.ticketPrices?.length ? `票價 Prices: ${ticket.ticketPrices.join(" / ")}` : null,
        ticket.ticketPlatforms?.length ? `平台 Platforms: ${ticket.ticketPlatforms.join(", ")}` : null,
        ticket.date ? `演出日期 Event date: ${ticket.date}${ticket.time ? " " + ticket.time : ""}` : null,
        `Ticket URL: ${ticket.sourceUrl}`,
      ].filter(Boolean).join("\n\n");

      const saleEventData = {
        title: `🎫 Sale Opens: ${ticket.title}`,
        description: saleDesc,
        startTime: saleStart,
        endTime: saleEnd,
        location: null,
      };

      saleEvent = await prisma.event.create({ data: { calendarId: saleCalendar.id, ...saleEventData } });

      if (saleIsCollaborative) {
        const shadowSaleCal = await ensureShadowCalendar(SALE_CALENDAR_NAME, SALE_CALENDAR_COLOR);
        await prisma.event.create({ data: { calendarId: shadowSaleCal.id, ...saleEventData } });
      }
    }

    if (ticket.saleFirstDate) {
      const { start: presaleStart, end: presaleEnd } = parseEventTime(ticket.saleFirstDate, null);
      const presaleDesc = [
        `會員優先購票 Fan/member presale for: ${ticket.title}`,
        ticket.ticketPrices?.length ? `票價 Prices: ${ticket.ticketPrices.join(" / ")}` : null,
        ticket.date ? `演出日期 Event date: ${ticket.date}${ticket.time ? " " + ticket.time : ""}` : null,
        `Ticket URL: ${ticket.sourceUrl}`,
      ].filter(Boolean).join("\n\n");

      const presaleEventData = {
        title: `🎫 Fan Presale: ${ticket.title}`,
        description: presaleDesc,
        startTime: presaleStart,
        endTime: presaleEnd,
        location: null,
      };

      presaleEvent = await prisma.event.create({ data: { calendarId: saleCalendar.id, ...presaleEventData } });

      if (saleIsCollaborative) {
        const shadowSaleCal = await ensureShadowCalendar(SALE_CALENDAR_NAME, SALE_CALENDAR_COLOR);
        await prisma.event.create({ data: { calendarId: shadowSaleCal.id, ...presaleEventData } });
      }
    }
  }

  return NextResponse.json({
    eventId: event.id,
    calendarId: calendar.id,
    calendarName: calendar.name,
    start: event.startTime.toISOString(),
    end: event.endTime.toISOString(),
    saleEventId: saleEvent?.id ?? null,
    presaleEventId: presaleEvent?.id ?? null,
  });
}
