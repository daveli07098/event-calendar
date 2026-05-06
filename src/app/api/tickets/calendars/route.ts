import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TICKET_CALENDAR_NAME = "event-reminders";
const SALE_CALENDAR_NAME = "sale-ticket";

export type TicketCalendarOption = {
  id: string;
  name: string;
  color: string;
  isOwn: boolean;         // true = owned by requesting user
  isVisible: boolean;
  ownerName: string | null; // display name of the calendar owner (null if own)
};

export type TicketCalendarsResponse = {
  eventReminders: TicketCalendarOption[];
  saleTicket: TicketCalendarOption[];
};

/**
 * GET /api/tickets/calendars
 * Returns available "event-reminders" and "sale-ticket" calendars:
 *   - User's own (if exists)
 *   - Collaborative calendars the user has joined with those names
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uid = session.user.id;

  // Own calendars with these names
  const ownCalendars = await prisma.calendar.findMany({
    where: { userId: uid, name: { in: [TICKET_CALENDAR_NAME, SALE_CALENDAR_NAME] } },
  });

  // Collaborative calendars the user has joined (not their own)
  const memberships = await prisma.calendarMember.findMany({
    where: { userId: uid },
    include: { calendar: { include: { user: { select: { name: true, email: true } } } } },
  });

  const collaborativeCalendars = memberships
    .map((m) => m.calendar)
    .filter(
      (c) =>
        c.shareMode === "collaborative" &&
        [TICKET_CALENDAR_NAME, SALE_CALENDAR_NAME].includes(c.name) &&
        c.userId !== uid, // exclude own calendars that happen to be shared
    );

  const toOption = (c: typeof ownCalendars[0], isOwn: boolean, ownerName: string | null): TicketCalendarOption => ({
    id: c.id,
    name: c.name,
    color: c.color,
    isOwn,
    isVisible: c.isVisible,
    ownerName,
  });

  const eventReminders: TicketCalendarOption[] = [
    ...ownCalendars
      .filter((c) => c.name === TICKET_CALENDAR_NAME)
      .map((c) => toOption(c, true, null)),
    ...collaborativeCalendars
      .filter((c) => c.name === TICKET_CALENDAR_NAME)
      .map((c) => {
        const owner = (c as typeof collaborativeCalendars[0]).user;
        return toOption(c, false, owner?.name ?? owner?.email ?? "Unknown");
      }),
  ];

  const saleTicket: TicketCalendarOption[] = [
    ...ownCalendars
      .filter((c) => c.name === SALE_CALENDAR_NAME)
      .map((c) => toOption(c, true, null)),
    ...collaborativeCalendars
      .filter((c) => c.name === SALE_CALENDAR_NAME)
      .map((c) => {
        const owner = (c as typeof collaborativeCalendars[0]).user;
        return toOption(c, false, owner?.name ?? owner?.email ?? "Unknown");
      }),
  ];

  return NextResponse.json({ eventReminders, saleTicket } satisfies TicketCalendarsResponse);
}
