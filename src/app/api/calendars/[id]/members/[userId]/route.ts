import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/calendars/[id]/members/[userId]
 * Owner can remove any member. Member can remove themselves (leave).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, userId } = await params;

  const calendar = await prisma.calendar.findUnique({ where: { id } });
  if (!calendar) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = calendar.userId === session.user.id;
  const isSelf = session.user.id === userId;

  if (!isOwner && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Site-shared memberships are re-created automatically, so removal is blocked
  if (calendar.isSiteShared) {
    return NextResponse.json(
      { error: "This is a site-wide calendar; membership cannot be removed. You can hide it instead." },
      { status: 400 }
    );
  }

  await prisma.calendarMember.deleteMany({ where: { calendarId: id, userId } });
  return NextResponse.json({ success: true });
}
