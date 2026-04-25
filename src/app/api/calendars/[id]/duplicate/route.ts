import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const uid = session.user.id;

  // Only the owner can duplicate; shared/joined calendars are excluded
  const source = await prisma.calendar.findFirst({
    where: { id, userId: uid },
    include: { events: true },
  });

  if (!source) {
    return NextResponse.json({ error: "Calendar not found" }, { status: 404 });
  }

  // Create a copy of the calendar and all its events in a transaction
  const duplicate = await prisma.$transaction(async (tx) => {
    const newCal = await tx.calendar.create({
      data: {
        userId: uid,
        name: `${source.name} (copy)`,
        color: source.color,
        isDefault: false,
        isVisible: source.isVisible,
        // shareToken / shareMode intentionally not copied — fresh calendar
      },
    });

    if (source.events.length > 0) {
      await tx.event.createMany({
        data: source.events.map((e) => ({
          calendarId: newCal.id,
          title: e.title,
          description: e.description,
          location: e.location,
          startTime: e.startTime,
          endTime: e.endTime,
          allDay: e.allDay,
          recurrenceRule: e.recurrenceRule,
          // googleEventId intentionally not copied
        })),
      });
    }

    return newCal;
  });

  return NextResponse.json(duplicate, { status: 201 });
}
