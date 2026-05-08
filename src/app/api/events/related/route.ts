import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface RelatedEvent {
  id: string;
  title: string;
  calendarName: string;
  calendarColor: string;
  startTime: string; // ISO string
}

/**
 * GET /api/events/related?url=<encoded>&excludeId=<id>
 * Returns events that share the same Ticket URL in their description.
 * Used to link concert events ↔ ticket-sale events in the modal.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json([], { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const url = searchParams.get("url");
  const excludeId = searchParams.get("excludeId") ?? undefined;

  if (!url) return NextResponse.json([]);

  // Collect all calendar IDs the user owns or is a member of
  const [ownedCals, memberRows] = await Promise.all([
    prisma.calendar.findMany({
      where: { userId: session.user.id },
      select: { id: true, name: true, color: true },
    }),
    prisma.calendarMember.findMany({
      where: { userId: session.user.id },
      include: { calendar: { select: { id: true, name: true, color: true } } },
    }),
  ]);

  const calendarIds = [
    ...ownedCals.map((c) => c.id),
    ...memberRows.map((m) => m.calendarId),
  ];

  if (calendarIds.length === 0) return NextResponse.json([]);

  const events = await prisma.event.findMany({
    where: {
      calendarId: { in: calendarIds },
      description: { contains: `Ticket URL: ${url}` },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    include: { calendar: { select: { name: true, color: true } } },
    orderBy: { startTime: "asc" },
    take: 10,
  });

  const result: RelatedEvent[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    calendarName: e.calendar.name,
    calendarColor: e.calendar.color,
    startTime: e.startTime.toISOString(),
  }));

  return NextResponse.json(result);
}
