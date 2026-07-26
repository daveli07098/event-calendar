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
  const body = await req.json();
  const { title, description, location, startTime, endTime, allDay, calendarId, category, artist, referenceUrl } = body;

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
      ...(category !== undefined && { category: category || null }),
      ...(artist !== undefined && { artist: artist || null }),
      ...(referenceUrl !== undefined && { referenceUrl: referenceUrl || null }),
    },
    include: { calendar: true },
  });

  // Propagate seating plan changes to all related events that share the same Ticket URL
  if (description !== undefined) {
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
