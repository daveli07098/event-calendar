import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteToCalendar, canAccessEvent } from "@/lib/event-access";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const access = await canAccessEvent(id, session.user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(access.event);
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
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { title, description, location, startTime, endTime, allDay, calendarId, category, artist, referenceUrl } = body;

  if (title !== undefined && typeof title !== "string") {
    return NextResponse.json({ error: "title must be a string" }, { status: 400 });
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return NextResponse.json({ error: "description must be a string" }, { status: 400 });
  }
  if (calendarId !== undefined && typeof calendarId !== "string") {
    return NextResponse.json({ error: "calendarId must be a string" }, { status: 400 });
  }
  const parseDate = (v: unknown): Date | null => {
    if (typeof v !== "string" && typeof v !== "number") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const newStart = startTime !== undefined ? parseDate(startTime) : undefined;
  const newEnd = endTime !== undefined ? parseDate(endTime) : undefined;
  if (newStart === null || newEnd === null) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

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
      ...(startTime !== undefined && { startTime: newStart }),
      ...(endTime !== undefined && { endTime: newEnd }),
      ...(allDay !== undefined && { allDay }),
      ...(calendarId !== undefined && { calendarId }),
      ...(category !== undefined && { category: category || null }),
      ...(artist !== undefined && { artist: artist || null }),
      ...(referenceUrl !== undefined && { referenceUrl: referenceUrl || null }),
    },
    include: { calendar: { select: { id: true, name: true, color: true } } },
  });

  // Rescheduled: clear sent-reminder markers so push reminders fire again.
  if (newStart && newStart.getTime() !== access.event.startTime.getTime()) {
    await prisma.pushReminderLog.deleteMany({ where: { eventId: id } });
  }

  // Propagate seating plan changes to all related events that share the same Ticket URL
  if (typeof description === "string") {
    const ticketUrl = description.match(/Ticket URL: (https?:\/\/[^\s]+)/)?.[1] ?? null;
    const seatingUrl = description.match(/^Seating Plan: (https?:\/\/[^\s]+)/m)?.[1] ?? null;
    if (ticketUrl) {
      // Find all related events (same ticket URL, different event)
      const relatedEvents = await prisma.event.findMany({
        where: {
          id: { not: id },
          description: { contains: `Ticket URL: ${ticketUrl}` },
          calendar: { userId: session.user.id },
        },
        select: { id: true, description: true },
      });
      for (const rel of relatedEvents) {
        const prevDesc = rel.description ?? "";
        // Remove existing seating plan line if any
        let newDesc = prevDesc.replace(/^Seating Plan: https?:\/\/[^\n]*/m, "").replace(/\n{3,}/g, "\n\n");
        if (seatingUrl) {
          const line = `Seating Plan: ${seatingUrl}`;
          newDesc = newDesc.trimEnd() + (newDesc.trim() ? "\n\n" : "") + line;
        }
        if (newDesc !== prevDesc) {
          await prisma.event.update({ where: { id: rel.id }, data: { description: newDesc } });
        }
      }
    }
  }

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
