import { prisma } from "@/lib/prisma";

/** IDs of all admin-curated, site-wide read-only calendars. */
export async function getSiteSharedCalendarIds(): Promise<string[]> {
  const rows = await prisma.calendar.findMany({
    where: { isSiteShared: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Make sure `userId` is a read-only ("viewer") member of every site-shared
 * calendar they don't own. Idempotent: one findMany + one createMany with
 * skipDuplicates. Never throws — safe to call on every page load.
 */
export async function ensureSiteCalendarMembership(userId: string): Promise<void> {
  try {
    const calendars = await prisma.calendar.findMany({
      where: { isSiteShared: true, userId: { not: userId } },
      select: { id: true },
    });
    if (calendars.length === 0) return;
    await prisma.calendarMember.createMany({
      data: calendars.map((c) => ({ calendarId: c.id, userId, role: "viewer" })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.error("[site-calendar] ensureSiteCalendarMembership failed", err);
  }
}
