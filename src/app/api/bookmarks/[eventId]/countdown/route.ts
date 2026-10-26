import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReadEvent } from "@/lib/event-access";

/**
 * Pin / unpin a countdown card for an event: body { countdown: boolean }.
 * Creates the bookmark if missing. Any user who can SEE the event qualifies
 * (owner or member, viewers included) — bookmarks are per-user.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { eventId } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.countdown !== "boolean") {
    return NextResponse.json({ error: "countdown must be a boolean" }, { status: 400 });
  }
  const userId = session.user.id;

  if (!(await canReadEvent(eventId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.eventBookmark.upsert({
    where: { userId_eventId: { userId, eventId } },
    create: { userId, eventId, countdown: body.countdown },
    update: { countdown: body.countdown },
  });
  return NextResponse.json({ bookmarked: true, countdown: body.countdown });
}
