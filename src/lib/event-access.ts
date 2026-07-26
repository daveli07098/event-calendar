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

export async function canAccessEvent(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: { include: { members: { where: { userId } } } } },
  });
  if (!event) return null;
  const canWrite = calendarIsWritable(event.calendar, userId);
  return { event, canWrite };
}
