import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface SearchResult {
  id: string;
  title: string;
  startTime: string;
  calendarName: string;
  calendarColor: string;
}

/**
 * GET /api/events/search?q=<query>&limit=20
 * Case-insensitive title search across all calendars the user owns or is a member of.
 * Pure DB — no AI, no quota.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json([], { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json([]);

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "20"), 50);

  // Collect all calendar IDs the user can access
  const [ownedCals, memberRows] = await Promise.all([
    prisma.calendar.findMany({
      where: { userId: session.user.id },
      select: { id: true },
    }),
    prisma.calendarMember.findMany({
      where: { userId: session.user.id },
      select: { calendarId: true },
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
      title: { contains: q, mode: "insensitive" },
    },
    include: { calendar: { select: { name: true, color: true } } },
    orderBy: { startTime: "asc" },
    take: limit,
  });

  const results: SearchResult[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    startTime: e.startTime.toISOString(),
    calendarName: e.calendar.name,
    calendarColor: e.calendar.color,
  }));

  return NextResponse.json(results);
}
