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
  saleFirstDate: string | null;
  saleDates: Array<{ date: string; time: string | null; label: string }> | null;
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
  if (ticket.saleDates?.length) {
    parts.push(`Sale Windows:\n${ticket.saleDates.map(w => `  ${w.label}: ${w.date}${w.time ? " " + w.time : ""}`).join("\n")}`);
  } else {
    if (ticket.saleDate) parts.push(`開售日期 Sale Date: ${ticket.saleDate}`);
    if (ticket.saleFirstDate) parts.push(`First Sale Date: ${ticket.saleFirstDate}`);
  }
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
    presaleEventId?: string | null;
    saleEventIds?: Record<string, string>;
    appliedFields?: string[];
    ticket?: ScrapedTicket;
    tzOffsetMinutes?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, saleEventId, presaleEventId, saleEventIds = {}, appliedFields, ticket, tzOffsetMinutes = 0 } = body;
  if (!eventId || !appliedFields || !ticket) {
    return NextResponse.json({ error: "eventId, appliedFields, ticket required" }, { status: 400 });
  }

  const uid = session.user.id;

  try {
  // Verify ownership
  const existingEvent = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: true },
  });
  if (!existingEvent || existingEvent.calendar.userId !== uid) {
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

  // Update sale/presale events whenever relevant fields change
  const saleFieldsChanged = apply.has("date") || apply.has("time") || apply.has("title") ||
    apply.has("ticketPrices") || apply.has("saleDate") || apply.has("saleFirstDate") ||
    Array.from(apply).some((f) => f.startsWith("saleWin::"));

  const updatedSaleEventIds: Record<string, string> = {};

  const SALE_CALENDAR_NAME = "sale-ticket";
  const SALE_CALENDAR_COLOR = "#8b5cf6";

  // Resolve the sale-ticket calendar once, lazily
  let resolvedSaleCalId: string | null = null;
  async function getSaleCalendarId(): Promise<string> {
    if (resolvedSaleCalId) return resolvedSaleCalId;
    // Prefer the calendar where an existing sale event lives
    const firstExistingId = Object.values(saleEventIds)[0] ?? saleEventId ?? presaleEventId;
    if (firstExistingId) {
      const ev = await prisma.event.findUnique({ where: { id: firstExistingId }, select: { calendarId: true } });
      if (ev?.calendarId) { resolvedSaleCalId = ev.calendarId; return resolvedSaleCalId; }
    }
    // Fallback: find or create the named sale-ticket calendar
    let cal = await prisma.calendar.findFirst({ where: { userId: uid, name: SALE_CALENDAR_NAME } });
    if (!cal) {
      cal = await prisma.calendar.create({
        data: { userId: uid, name: SALE_CALENDAR_NAME, color: SALE_CALENDAR_COLOR, isDefault: false, isVisible: true },
      });
    }
    resolvedSaleCalId = cal.id;
    return resolvedSaleCalId;
  }

  // Handle per-window saleWin::${label} changes — update if event exists, create if new
  for (const field of apply) {
    if (!field.startsWith("saleWin::")) continue;
    const label = field.slice("saleWin::".length);

    const window = ticket.saleDates?.find((w) => w.label === label);
    if (!window) continue;

    const winStart = parseLocalToUTC(window.date, window.time ?? null, tzOffsetMinutes);
    if (!winStart) continue;
    const winEnd = new Date(winStart.getTime() + 3_600_000);

    // Look up event ID in saleEventIds (new map), fall back to legacy fields
    const seId = saleEventIds[label]
      ?? (label.toLowerCase().includes("public") || label === "Sale Opens" ? saleEventId : null)
      ?? (label.toLowerCase().includes("presale") || label.toLowerCase().includes("fan") ? presaleEventId : null);

    if (seId) {
      // Update existing sale event
      const updatedWin = await prisma.event.update({
        where: { id: seId },
        data: { startTime: winStart, endTime: winEnd },
      });
      updatedSaleEventIds[label] = updatedWin.id;
    } else {
      // NEW window — create sale-ticket event
      const salCalId = await getSaleCalendarId();
      const isPublic = label.toLowerCase().includes("public") || label.toLowerCase().includes("公開");
      const emoji = isPublic ? "🎫" : "⭐";
      const wDesc = [
        `${label} for: ${ticket.title}`,
        ticket.ticketPrices?.length ? `票價 Prices: ${ticket.ticketPrices.join(" / ")}` : null,
        ticket.ticketPlatforms?.length ? `平台 Platforms: ${ticket.ticketPlatforms.join(", ")}` : null,
        ticket.date ? `演出日期 Event date: ${ticket.date}${ticket.time ? " " + ticket.time : ""}` : null,
        `Ticket URL: ${ticket.sourceUrl}`,
      ].filter(Boolean).join("\n\n");
      const newSaleEvent = await prisma.event.create({
        data: {
          calendarId: salCalId,
          title: `${emoji} ${label}: ${ticket.title}`,
          description: wDesc,
          startTime: winStart,
          endTime: winEnd,
          allDay: false,
        },
      });
      updatedSaleEventIds[label] = newSaleEvent.id;
    }
  }

  // Legacy: update sale/presale events if saleDate / saleFirstDate were applied
  let updatedSaleEvent = null;
  let updatedPresaleEvent = null;

  // Also propagate description / core field changes to all known sale events
  const allSaleIds = [
    ...Object.values(saleEventIds),
    ...(saleEventId ? [saleEventId] : []),
    ...(presaleEventId ? [presaleEventId] : []),
  ].filter((id, i, a) => a.indexOf(id) === i); // unique

  if (saleEventId && saleFieldsChanged && !apply.has("saleWin::" + "Public Sale") && !apply.has("saleWin::" + "Sale Opens")) {
    const saleUpdateData: Record<string, unknown> = { description: buildSaleDescription(ticket) };
    if (apply.has("saleDate") && ticket.saleDate) {
      const saleStart = parseLocalToUTC(ticket.saleDate, null, tzOffsetMinutes);
      if (saleStart) {
        const saleEnd = new Date(saleStart);
        saleEnd.setHours(saleEnd.getHours() + 1);
        saleUpdateData.startTime = saleStart;
        saleUpdateData.endTime = saleEnd;
      }
    }
    updatedSaleEvent = await prisma.event.update({ where: { id: saleEventId }, data: saleUpdateData });
  }

  if (presaleEventId && saleFieldsChanged && !apply.has("saleWin::" + "Fan Presale")) {
    const presaleUpdateData: Record<string, unknown> = {
      description: [
        `會員優先購票 Fan/member presale for: ${ticket.title}`,
        ticket.ticketPrices?.length ? `票價 Prices: ${ticket.ticketPrices.join(" / ")}` : null,
        ticket.date ? `演出日期 Event date: ${ticket.date}${ticket.time ? " " + ticket.time : ""}` : null,
        `Ticket URL: ${ticket.sourceUrl}`,
      ].filter(Boolean).join("\n\n"),
    };
    if (apply.has("saleFirstDate") && ticket.saleFirstDate) {
      const presaleStart = parseLocalToUTC(ticket.saleFirstDate, null, tzOffsetMinutes);
      if (presaleStart) {
        const presaleEnd = new Date(presaleStart);
        presaleEnd.setHours(presaleEnd.getHours() + 1);
        presaleUpdateData.startTime = presaleStart;
        presaleUpdateData.endTime = presaleEnd;
      }
    }
    updatedPresaleEvent = await prisma.event.update({ where: { id: presaleEventId }, data: presaleUpdateData });
  }

  // Propagate description+title changes to ALL sale events not already updated
  if (saleFieldsChanged && (apply.has("ticketPrices") || apply.has("ticketPlatforms") || apply.has("date") || apply.has("time"))) {
    const alreadyUpdated = new Set([
      updatedSaleEvent?.id,
      updatedPresaleEvent?.id,
      ...Object.values(updatedSaleEventIds),
    ].filter(Boolean) as string[]);
    for (const seId of allSaleIds) {
      if (alreadyUpdated.has(seId)) continue;
      await prisma.event.update({
        where: { id: seId },
        data: { description: buildSaleDescription(ticket) },
      });
    }
  }

  return NextResponse.json({
    updated: true,
    eventId: updatedEvent.id,
    saleEventId: updatedSaleEvent?.id ?? null,
    presaleEventId: updatedPresaleEvent?.id ?? null,
    updatedSaleEventIds,
    createdSaleCount: Object.keys(updatedSaleEventIds).filter((k) => !saleEventIds[k]).length,
    appliedFields,
  });
  } catch (e) {
    console.error("[tickets/update] Prisma error:", e);
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
