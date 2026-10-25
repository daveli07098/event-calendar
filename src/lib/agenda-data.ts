import { prisma } from "@/lib/prisma";
import { SALE_TICKET_CALENDAR_NAME } from "@/lib/calendar-names";
import type { AgendaEvent } from "@/lib/agenda";

export function toAgendaEvent(e: {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  category: string | null;
  location: string | null;
  calendarId: string;
  calendar: { name: string; color: string };
}): AgendaEvent {
  return {
    id: e.id,
    title: e.title,
    start: e.startTime.toISOString(),
    end: e.endTime.toISOString(),
    allDay: e.allDay,
    calendarId: e.calendarId,
    calendarName: e.calendar.name,
    color: e.calendar.color,
    category: e.category,
    location: e.location,
    isSale: e.calendar.name === SALE_TICKET_CALENDAR_NAME,
  };
}

/**
 * Events overlapping [from, to) from calendars the user owns (and has not
 * hidden) plus calendars they joined as a member. Recurring events are not
 * expanded anywhere in the app, so they are returned as single events.
 */
export async function loadAgendaEvents(userId: string, from: Date, to: Date): Promise<AgendaEvent[]> {
  const events = await prisma.event.findMany({
    where: {
      startTime: { lt: to },
      endTime: { gte: from },
      calendar: {
        OR: [
          { userId, isVisible: true },
          { members: { some: { userId } } },
        ],
      },
    },
    include: { calendar: { select: { name: true, color: true } } },
    orderBy: { startTime: "asc" },
  });
  return events.map(toAgendaEvent);
}
