import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { classifyBatch } from "@/lib/classify-event";

// ---------------------------------------------------------------------------
// GET /api/events/classify — return category counts for the user's events
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId: session.user.id }, select: { id: true } }),
    prisma.calendarMember.findMany({ where: { userId: session.user.id }, select: { calendarId: true } }),
  ]);
  const calIds = [...owned.map((c) => c.id), ...memberships.map((m) => m.calendarId)];

  const counts = await prisma.event.groupBy({
    by: ["category"],
    where: { calendarId: { in: calIds } },
    _count: { _all: true },
  });

  const total = await prisma.event.count({ where: { calendarId: { in: calIds } } });
  const unclassified = counts.find((c) => c.category === null)?._count._all ?? 0;

  return NextResponse.json({
    counts: counts.map((c) => ({ category: c.category, count: c._count._all })),
    total,
    unclassified,
  });
}

// ---------------------------------------------------------------------------
// POST /api/events/classify — AI-classify all (or unclassified) events
// Body: { onlyUnclassified?: boolean; calendarIds?: string[] }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { onlyUnclassified?: boolean; calendarIds?: string[] };
  const onlyUnclassified = body.onlyUnclassified !== false; // default true

  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId: session.user.id }, select: { id: true } }),
    prisma.calendarMember.findMany({ where: { userId: session.user.id }, select: { calendarId: true } }),
  ]);
  const accessibleCalIds = new Set([...owned.map((c) => c.id), ...memberships.map((m) => m.calendarId)]);

  // If caller specified calendar IDs, intersect with accessible set (security check)
  let calIds: string[];
  if (body.calendarIds?.length) {
    calIds = body.calendarIds.filter((id) => accessibleCalIds.has(id));
    if (calIds.length === 0) {
      return NextResponse.json({ error: "No accessible calendars in the provided list" }, { status: 403 });
    }
  } else {
    calIds = [...accessibleCalIds];
  }

  const events = await prisma.event.findMany({
    where: {
      calendarId: { in: calIds },
      ...(onlyUnclassified ? { category: null } : {}),
    },
    select: { id: true, title: true, description: true, location: true },
    orderBy: { startTime: "asc" },
  });

  if (events.length === 0) {
    return NextResponse.json({ updated: 0, message: "No events to classify." });
  }

  // Process in batches of 30 to keep prompts manageable
  const BATCH_SIZE = 30;
  let updatedCount = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const classifications = await classifyBatch(batch);

    await Promise.all(
      Object.entries(classifications).map(([idx, category]) => {
        const event = batch[Number(idx)];
        if (!event) return;
        updatedCount++;
        return prisma.event.update({ where: { id: event.id }, data: { category } });
      })
    );
  }

  return NextResponse.json({
    updated: updatedCount,
    total: events.length,
    message: `Classified ${updatedCount} of ${events.length} event(s).`,
  });
}
