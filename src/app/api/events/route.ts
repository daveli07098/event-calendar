import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Returns all calendar IDs the user can read (owned + shared memberships) */
async function accessibleCalendarIds(userId: string): Promise<string[]> {
  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId }, select: { id: true } }),
    prisma.calendarMember.findMany({ where: { userId }, select: { calendarId: true } }),
  ]);
  return [
    ...owned.map((c) => c.id),
    ...memberships.map((m) => m.calendarId),
  ];
}

/** Returns true if user may write to this calendar (owner or editor on collaborative) */
async function canWriteToCalendar(calendarId: string, userId: string): Promise<boolean> {
  const calendar = await prisma.calendar.findUnique({
    where: { id: calendarId },
    include: { members: { where: { userId } } },
  });
  if (!calendar) return false;
  if (calendar.userId === userId) return true;
  // Editor on collaborative calendar
  if (calendar.shareMode === "collaborative" && calendar.members[0]?.role === "editor") return true;
  return false;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { error: "start and end query params are required" },
      { status: 400 }
    );
  }

  const calIds = await accessibleCalendarIds(session.user.id);

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "Invalid start or end date" }, { status: 400 });
  }

  const events = await prisma.event.findMany({
    where: {
      calendarId: { in: calIds },
      startTime: { lte: endDate },
      endTime: { gte: startDate },
    },
    include: { calendar: true },
    orderBy: { startTime: "asc" },
  });

  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { title, description, location, startTime, endTime, allDay, calendarId } = body;

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  if (!startTime || !endTime) {
    return NextResponse.json(
      { error: "Start and end times are required" },
      { status: 400 }
    );
  }

  if (!(await canWriteToCalendar(calendarId, session.user.id))) {
    return NextResponse.json({ error: "Calendar not found or no write access" }, { status: 404 });
  }

  const event = await prisma.event.create({
    data: {
      calendarId,
      title: title.trim(),
      description: description || null,
      location: location || null,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      allDay: allDay || false,
    },
    include: { calendar: true },
  });

  return NextResponse.json(event, { status: 201 });
}
