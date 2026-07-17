import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Any user who can SEE the event may bookmark it — bookmarks are per-user and
// never modify the event, so viewers of shared calendars qualify too.
async function canReadEvent(eventId: string, userId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: { include: { members: { where: { userId } } } } },
  });
  if (!event) return false;
  return event.calendar.userId === userId || event.calendar.members.length > 0;
}

/** Set the bookmark state for this event: body { bookmarked: boolean }. Idempotent. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { bookmarked } = await req.json();
  if (typeof bookmarked !== "boolean") {
    return NextResponse.json({ error: "bookmarked must be a boolean" }, { status: 400 });
  }

  if (!(await canReadEvent(id, session.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key = { userId_eventId: { userId: session.user.id, eventId: id } };
  if (bookmarked) {
    await prisma.eventBookmark.upsert({
      where: key,
      create: { userId: session.user.id, eventId: id },
      update: {},
    });
  } else {
    await prisma.eventBookmark.deleteMany({
      where: { userId: session.user.id, eventId: id },
    });
  }
  return NextResponse.json({ bookmarked });
}
