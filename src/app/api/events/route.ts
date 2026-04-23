import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const events = await prisma.event.findMany({
    where: {
      calendar: { userId: session.user.id },
      startTime: { lte: new Date(end) },
      endTime: { gte: new Date(start) },
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

  // Verify the calendar belongs to the user
  const calendar = await prisma.calendar.findFirst({
    where: { id: calendarId, userId: session.user.id },
  });

  if (!calendar) {
    return NextResponse.json({ error: "Calendar not found" }, { status: 404 });
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
