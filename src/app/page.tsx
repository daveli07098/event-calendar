import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CalendarPageClient } from "@/components/calendar/CalendarPageClient";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // Guard against stale JWT sessions pointing to a user deleted from the DB
  // (e.g. after a database reset). signOut clears the cookie and redirects.
  const userExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!userExists) {
    await signOut({ redirectTo: "/login" });
  }

  const uid = session.user.id;

  // Own calendars
  const ownedCalendars = await prisma.calendar.findMany({
    where: { userId: uid },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Calendars joined as member
  const memberships = await prisma.calendarMember.findMany({
    where: { userId: uid },
    include: {
      calendar: {
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
        },
      },
    },
  });

  const allCalendarIds = [
    ...ownedCalendars.map((c) => c.id),
    ...memberships.map((m) => m.calendarId),
  ];

  // Get events for the current month range (all accessible calendars)
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  start.setDate(start.getDate() - 7);
  end.setDate(end.getDate() + 7);

  const events = await prisma.event.findMany({
    where: {
      calendarId: { in: allCalendarIds },
      startTime: { lte: end },
      endTime: { gte: start },
    },
    include: { calendar: true },
    orderBy: { startTime: "asc" },
  });

  // Serialize
  function serializeMember(m: { id: string; calendarId: string; userId: string; role: string; joinedAt: Date; user: { id: string; name: string | null; email: string | null; image: string | null } }) {
    return { ...m, joinedAt: m.joinedAt.toISOString() };
  }

  function serializeCal(
    c: typeof ownedCalendars[number],
    memberRole?: string
  ) {
    return {
      ...c,
      shareMode: c.shareMode as "collaborative" | "broadcast" | null,
      memberRole: memberRole as "editor" | "viewer" | undefined,
      members: c.members.map(serializeMember),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  const serializedCalendars = [
    ...ownedCalendars.map((c) => serializeCal(c)),
    ...memberships.map((m) => serializeCal(m.calendar as typeof ownedCalendars[number], m.role)),
  ];

  const serializedEvents = events.map((e) => ({
    ...e,
    startTime: e.startTime.toISOString(),
    endTime: e.endTime.toISOString(),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    calendar: e.calendar
      ? {
          ...e.calendar,
          shareMode: e.calendar.shareMode as "collaborative" | "broadcast" | null,
          members: [],
          createdAt: e.calendar.createdAt.toISOString(),
          updatedAt: e.calendar.updatedAt.toISOString(),
        }
      : undefined,
  }));

  return (
    <CalendarPageClient
      initialCalendars={serializedCalendars}
      initialEvents={serializedEvents}
    />
  );
}
