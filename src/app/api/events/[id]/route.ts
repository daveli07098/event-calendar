import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { title, description, location, startTime, endTime, allDay, calendarId } = body;

  const event = await prisma.event.findFirst({
    where: { id, calendar: { userId: session.user.id } },
  });

  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If changing calendar, verify ownership
  if (calendarId && calendarId !== event.calendarId) {
    const targetCalendar = await prisma.calendar.findFirst({
      where: { id: calendarId, userId: session.user.id },
    });
    if (!targetCalendar) {
      return NextResponse.json({ error: "Target calendar not found" }, { status: 404 });
    }
  }

  const updated = await prisma.event.update({
    where: { id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description }),
      ...(location !== undefined && { location }),
      ...(startTime !== undefined && { startTime: new Date(startTime) }),
      ...(endTime !== undefined && { endTime: new Date(endTime) }),
      ...(allDay !== undefined && { allDay }),
      ...(calendarId !== undefined && { calendarId }),
    },
    include: { calendar: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const event = await prisma.event.findFirst({
    where: { id, calendar: { userId: session.user.id } },
  });

  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.event.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
