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
  saleDates: Array<{ date: string; time: string | null; label: string }> | null;
  sourceTimezone?: string | null;  // ±HH:MM offset from scrape route (e.g. "+08:00" for HKT)
}

/** Parse a single date+time into a UTC Date.
 *  Priority: sourceTimezone (from JSON-LD/URL) > tzOffsetMinutes (client) > fallback. */
function parseSingleDateTime(
  date: string | null,
  time: string | null,
  sourceTimezone: string | null,
  tzOffsetMinutes: number,
  fallback: Date,
): Date {
  if (!date) return fallback;
  const isoMatch = date.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const h = time ? time.split(":")[0] ?? "12" : "12";
    const min = time ? (time.split(":")[1] ?? "00") : "00";
    if (time && sourceTimezone) {
      // Reconstruct timezone-aware ISO string and let JS parse to UTC
      const iso = `${y}-${m}-${d}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00${sourceTimezone}`;
      const parsed = new Date(iso);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    if (time && tzOffsetMinutes !== 0) {
      // Client-side offset (e.g. HKT = -480): create UTC base then shift
      const utcBase = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min)));
      return new Date(utcBase.getTime() + tzOffsetMinutes * 60_000);
    }
    // No timezone info — treat as UTC directly
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), time ? Number(h) : 12, time ? Number(min) : 0));
  }
  const parsed = new Date(date + (time ? ` ${time}` : ""));
  return isNaN(parsed.getTime()) ? fallback : parsed;
}

/** Parse a date+time string from the ticket into a JS Date.
 *  Falls back to tomorrow noon if parsing fails. */
function parseEventTime(
  date: string | null,
  time: string | null,
  sourceTimezone: string | null,
  tzOffsetMinutes: number,
  endDate?: string | null,
  endTime?: string | null,
): { start: Date; end: Date } {
  const fallbackStart = new Date();
  fallbackStart.setDate(fallbackStart.getDate() + 1);
  fallbackStart.setHours(12, 0, 0, 0);

  const start = parseSingleDateTime(date, time, sourceTimezone, tzOffsetMinutes, fallbackStart);

  let end: Date;
  if (endDate || endTime) {
    // End date defaults to same day as start if only endTime given
    end = parseSingleDateTime(
      endDate ?? date,
      endTime ?? null,
      sourceTimezone,
      tzOffsetMinutes,
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

  let body: { ticket?: TicketData; targetCalendarId?: string; targetSaleCalendarId?: string; tzOffsetMinutes?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ticket, targetCalendarId, targetSaleCalendarId, tzOffsetMinutes = 0 } = body;
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

  // Build event times — use sourceTimezone from scrape, fall back to client tzOffsetMinutes
  const tz = ticket.sourceTimezone ?? null;
  const { start, end } = parseEventTime(ticket.date, ticket.time, tz, tzOffsetMinutes, ticket.endDate, ticket.endTime);

  // Build description with ticket info and source URL appended
  const descParts: string[] = [];
  if (ticket.description) descParts.push(ticket.description);
  if (ticket.ticketPrices?.length) descParts.push(`門票票價 Ticket Prices: ${ticket.ticketPrices.join(" / ")}`);
  if (ticket.ticketPlatforms?.length) descParts.push(`售票平台 Platforms: ${ticket.ticketPlatforms.join(", ")}`);
  if (ticket.saleDate) descParts.push(`開售日期 Sale Date: ${ticket.saleDate}`);
  if (ticket.saleFirstDate) descParts.push(`First Sale Date: ${ticket.saleFirstDate}`);
  if (ticket.saleDates?.length) {
    descParts.push(`Sale Windows:\n${ticket.saleDates.map(w => `  ${w.label}: ${w.date}${w.time ? " " + w.time : ""}`).join("\n")}`);
  }
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

  // Create sale-ticket calendar reminders — one per sale window
  const saleEventIds: string[] = [];

  // Build the list of windows to create events for:
  // prefer saleDates[] if available, otherwise fall back to legacy saleDate/saleFirstDate
  const saleWindows: Array<{ date: string; time: string | null; label: string }> = ticket.saleDates?.length
    ? ticket.saleDates
    : [
        ...(ticket.saleFirstDate ? [{ date: ticket.saleFirstDate, time: null, label: "Fan Presale" }] : []),
        ...(ticket.saleDate && ticket.saleDate !== ticket.saleFirstDate ? [{ date: ticket.saleDate, time: null, label: "Public Sale" }] : []),
        ...(ticket.saleDate && ticket.saleDate === ticket.saleFirstDate ? [{ date: ticket.saleDate, time: null, label: "Sale Opens" }] : []),
      ];

  if (saleWindows.length > 0) {
    const saleResolved = await resolveCalendar(targetSaleCalendarId, SALE_CALENDAR_NAME, SALE_CALENDAR_COLOR);
    const saleCalendar = saleResolved?.calendar ?? await (async () => {
      let c = await prisma.calendar.findFirst({ where: { userId: uid, name: SALE_CALENDAR_NAME } });
      if (!c) c = await prisma.calendar.create({ data: { userId: uid, name: SALE_CALENDAR_NAME, color: SALE_CALENDAR_COLOR, isDefault: false, isVisible: true } });
      return c;
    })();
    const saleIsCollaborative = saleResolved?.isCollaborative ?? false;

    for (const window of saleWindows) {
      const { start: wStart, end: wEnd } = parseEventTime(window.date, window.time ?? null, tz, tzOffsetMinutes);
      const isPublic = window.label.toLowerCase().includes("public") || window.label.toLowerCase().includes("公開");
      const emoji = isPublic ? "🎫" : "⭐";
      const wDesc = [
        `${window.label} for: ${ticket.title}`,
        ticket.ticketPrices?.length ? `票價 Prices: ${ticket.ticketPrices.join(" / ")}` : null,
        ticket.ticketPlatforms?.length ? `平台 Platforms: ${ticket.ticketPlatforms.join(", ")}` : null,
        ticket.date ? `演出日期 Event date: ${ticket.date}${ticket.time ? " " + ticket.time : ""}` : null,
        `Ticket URL: ${ticket.sourceUrl}`,
      ].filter(Boolean).join("\n\n");

      const wEventData = {
        title: `${emoji} ${window.label}: ${ticket.title}`,
        description: wDesc,
        startTime: wStart,
        endTime: wEnd,
        location: null as string | null,
      };

      const wEvent = await prisma.event.create({ data: { calendarId: saleCalendar.id, ...wEventData } });
      saleEventIds.push(wEvent.id);

      if (saleIsCollaborative) {
        const shadowSaleCal = await ensureShadowCalendar(SALE_CALENDAR_NAME, SALE_CALENDAR_COLOR);
        await prisma.event.create({ data: { calendarId: shadowSaleCal.id, ...wEventData } });
      }
    }
  }

  return NextResponse.json({
    eventId: event.id,
    calendarId: calendar.id,
    calendarName: calendar.name,
    start: event.startTime.toISOString(),
    end: event.endTime.toISOString(),
    saleEventIds,
  });
}
