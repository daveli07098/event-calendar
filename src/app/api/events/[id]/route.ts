import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canWriteToCalendar(calendarId: string, userId: string): Promise<boolean> {
  const calendar = await prisma.calendar.findUnique({
    where: { id: calendarId },
    include: { members: { where: { userId } } },
  });
  if (!calendar) return false;
  if (calendar.userId === userId) return true;
  if (calendar.shareMode === "collaborative" && calendar.members[0]?.role === "editor") return true;
  return false;
}

async function canAccessEvent(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: { include: { members: { where: { userId } } } } },
  });
  if (!event) return null;
  const cal = event.calendar;
  const isOwner = cal.userId === userId;
  const isEditor =
    cal.shareMode === "collaborative" && cal.members[0]?.role === "editor";
  const canWrite = isOwner || isEditor;
  return { event, canWrite };
}

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

  const access = await canAccessEvent(id, session.user.id);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json({ error: "No write access" }, { status: 403 });
  }

  // If changing calendar, verify write access on target too
  if (calendarId && calendarId !== access.event.calendarId) {
    if (!(await canWriteToCalendar(calendarId, session.user.id))) {
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

  const access = await canAccessEvent(id, session.user.id);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json({ error: "No write access" }, { status: 403 });
  }

  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ success: true });
}


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
