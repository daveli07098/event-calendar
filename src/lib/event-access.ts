import { prisma } from "@/lib/prisma";

/** Shape shared by `Calendar` rows joined with the caller's own membership row. */
type CalendarWithCallerMembership = {
  userId: string;
  shareMode: string | null;
  members: Array<{ role: string }>;
};

/**
 * Pure predicate: writable if the caller owns the calendar, OR the calendar is
 * shared in "collaborative" mode and the caller's membership role is "editor".
 * Kept side-effect-free so callers that already have the calendar (+ their own
 * membership row) loaded — e.g. via a batched `findMany` — can evaluate this in
 * memory instead of issuing a query per row.
 */
export function calendarIsWritable(calendar: CalendarWithCallerMembership, userId: string): boolean {
  if (calendar.userId === userId) return true;
  // Editor on collaborative calendar
  if (calendar.shareMode === "collaborative" && calendar.members[0]?.role === "editor") return true;
  return false;
}

/** Returns true if user may write to this calendar (owner or editor on collaborative) */
export async function canWriteToCalendar(calendarId: string, userId: string): Promise<boolean> {
  const calendar = await prisma.calendar.findUnique({
    where: { id: calendarId },
    include: { members: { where: { userId } } },
  });
  if (!calendar) return false;
  return calendarIsWritable(calendar, userId);
}

/**
 * Loads an event the caller may READ (calendar owner or member, viewers
 * included); returns null otherwise so callers answer 404 without leaking
 * existence. The calendar on the returned event is trimmed to display fields —
 * shareToken / shareMode must never reach non-owners (a collaborative
 * shareToken grants editor access via /api/join/<token>).
 */
export async function canAccessEvent(eventId: string, userId: string) {
  const found = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      calendar: {
        select: {
          id: true,
          name: true,
          color: true,
          userId: true,
          shareMode: true,
          members: { where: { userId }, select: { role: true } },
        },
      },
    },
  });
  if (!found) return null;
  const { calendar, ...rest } = found;
  const canRead = calendar.userId === userId || calendar.members.length > 0;
  if (!canRead) return null;
  const canWrite = calendarIsWritable(calendar, userId);
  const event = { ...rest, calendar: { id: calendar.id, name: calendar.name, color: calendar.color } };
  return { event, canWrite };
}

/** True if the user can see the event (owner or any member, viewers included). */
export async function canReadEvent(eventId: string, userId: string): Promise<boolean> {
  return (await canAccessEvent(eventId, userId)) !== null;
}

/**
 * Calendar IDs the user may WRITE to: owned calendars + collaborative calendars
 * where they are an editor. Broadcast / site-shared memberships (viewers) are
 * excluded, so bulk-mutation routes can't touch read-only calendars.
 */
export async function writableCalendarIds(userId: string): Promise<string[]> {
  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId }, select: { id: true } }),
    prisma.calendarMember.findMany({
      where: { userId, role: "editor", calendar: { shareMode: "collaborative" } },
      select: { calendarId: true },
    }),
  ]);
  return [...owned.map((c) => c.id), ...memberships.map((m) => m.calendarId)];
}
