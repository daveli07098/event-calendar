import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildCalendarFeed } from "@/lib/ics";

const PAST_DAYS = 30;
const FUTURE_DAYS = 365;
const MAX_EVENTS = 2000;
const DAY_MS = 86_400_000;

// No session: the unguessable feedToken is the credential (calendar apps can't log in).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const user = await prisma.user.findUnique({
    where: { feedToken: token },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const events = await prisma.event.findMany({
    where: {
      endTime: { gte: new Date(now.getTime() - PAST_DAYS * DAY_MS) },
      startTime: { lte: new Date(now.getTime() + FUTURE_DAYS * DAY_MS) },
      calendar: {
        OR: [
          { userId: user.id, isVisible: true },
          { members: { some: { userId: user.id } } },
        ],
      },
    },
    include: { calendar: { select: { name: true } } },
    orderBy: { startTime: "asc" },
    take: MAX_EVENTS,
  });

  const body = buildCalendarFeed({
    name: "Event Calendar",
    now,
    events: events.map(({ calendar, ...e }) => ({ ...e, calendarName: calendar.name })),
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
