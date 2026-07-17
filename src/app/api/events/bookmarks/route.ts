import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * List the current user's bookmarked events across ALL their calendars
 * (owned + shared), regardless of the calendar view's date range. Powers the
 * "Bookmarked" sidebar section, so it returns a compact shape with the
 * calendar color/name rather than full event objects.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Guard against stale rows: hide bookmarks on calendars the user has since
  // left (the bookmark row survives, but they can no longer read the event).
  const uid = session.user.id;
  const bookmarks = await prisma.eventBookmark.findMany({
    where: {
      userId: uid,
      event: {
        calendar: {
          OR: [{ userId: uid }, { members: { some: { userId: uid } } }],
        },
      },
    },
    include: {
      event: {
        include: { calendar: { select: { name: true, color: true } } },
      },
    },
    orderBy: { event: { startTime: "asc" } },
  });

  return NextResponse.json(
    bookmarks.map((b) => ({
      id: b.event.id,
      title: b.event.title,
      startTime: b.event.startTime.toISOString(),
      endTime: b.event.endTime.toISOString(),
      allDay: b.event.allDay,
      calendarName: b.event.calendar.name,
      calendarColor: b.event.calendar.color,
    }))
  );
}
