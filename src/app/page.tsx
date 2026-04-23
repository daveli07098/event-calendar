import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CalendarPageClient } from "@/components/calendar/CalendarPageClient";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const calendars = await prisma.calendar.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  // Get events for the current month range
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  // Extend a bit for calendar grid overlap
  start.setDate(start.getDate() - 7);
  end.setDate(end.getDate() + 7);

  const events = await prisma.event.findMany({
    where: {
      calendar: { userId: session.user.id },
      startTime: { lte: end },
      endTime: { gte: start },
    },
    include: { calendar: true },
    orderBy: { startTime: "asc" },
  });

  // Serialize dates for client
  const serializedCalendars = calendars.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  const serializedEvents = events.map((e) => ({
    ...e,
    startTime: e.startTime.toISOString(),
    endTime: e.endTime.toISOString(),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    calendar: e.calendar
      ? {
          ...e.calendar,
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
