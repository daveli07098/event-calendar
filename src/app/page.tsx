import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TIME_ZONE, type Theme } from "@/lib/theme";
import { loadAgendaEvents } from "@/lib/agenda-data";
import { ensureSiteCalendarMembership } from "@/lib/site-calendar";
import { HomeDashboard, type HomeBookmark, type HomeNote } from "@/components/home/HomeDashboard";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  // Every user sees the shared tickets/reminders calendar (never throws).
  await ensureSiteCalendarMembership(userId);

  const now = new Date();
  // Only bookmarks on calendars the user can still read (stale rows survive leaving a calendar).
  const readable = { calendar: { OR: [{ userId }, { members: { some: { userId } } }] } };
  const eventSelect = {
    id: true, title: true, startTime: true, endTime: true, allDay: true,
    calendar: { select: { color: true } },
  } as const;

  const [user, events, pins, bookmarks, notes] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, themeSettings: true } }),
    loadAgendaEvents(userId, new Date(now.getTime() - DAY_MS), new Date(now.getTime() + 14 * DAY_MS)),
    prisma.eventBookmark.findMany({
      where: { userId, countdown: true, event: { endTime: { gte: now }, ...readable } },
      include: { event: { select: eventSelect } },
      orderBy: { event: { startTime: "asc" } },
      take: 8,
    }),
    prisma.eventBookmark.findMany({
      where: {
        userId,
        event: { endTime: { gte: now }, startTime: { lt: new Date(now.getTime() + 60 * DAY_MS) }, ...readable },
      },
      include: { event: { select: eventSelect } },
      orderBy: { event: { startTime: "asc" } },
      take: 8,
    }),
    prisma.note.findMany({ where: { userId, done: false }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const theme = (user?.themeSettings ?? null) as Partial<Theme> | null;
  const timeZone = theme?.timeZone || DEFAULT_TIME_ZONE;

  const toBookmark = (b: (typeof pins)[number]): HomeBookmark => ({
    eventId: b.event.id,
    title: b.event.title,
    start: b.event.startTime.toISOString(),
    end: b.event.endTime.toISOString(),
    allDay: b.event.allDay,
    color: b.event.calendar.color,
    countdown: b.countdown,
  });
  const homeNotes: HomeNote[] = notes.map((n) => ({ id: n.id, text: n.text, url: n.url }));

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <HomeDashboard
        firstName={(user?.name ?? session.user.name ?? "").trim().split(/\s+/)[0] ?? ""}
        nowIso={now.toISOString()}
        timeZone={timeZone}
        events={events}
        countdowns={pins.map(toBookmark)}
        bookmarks={bookmarks.map(toBookmark)}
        notes={homeNotes}
      />
    </main>
  );
}
