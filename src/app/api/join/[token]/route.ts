import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/join/[token]
 * Returns public calendar info for the invite preview (no auth required).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const calendar = await prisma.calendar.findUnique({
    where: { shareToken: token },
    include: {
      user: { select: { name: true, image: true } },
    },
  });

  if (!calendar || !calendar.shareMode) {
    return NextResponse.json({ error: "Invalid or expired invite link" }, { status: 404 });
  }

  return NextResponse.json({
    id: calendar.id,
    name: calendar.name,
    color: calendar.color,
    shareMode: calendar.shareMode,
    owner: calendar.user,
  });
}

/**
 * POST /api/join/[token]
 * Authenticated user accepts the invite — creates a CalendarMember row.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;

  const calendar = await prisma.calendar.findUnique({
    where: { shareToken: token },
  });

  if (!calendar || !calendar.shareMode) {
    return NextResponse.json({ error: "Invalid or expired invite link" }, { status: 404 });
  }

  // Owner can't join their own calendar
  if (calendar.userId === session.user.id) {
    return NextResponse.json({ error: "You own this calendar" }, { status: 400 });
  }

  const role = calendar.shareMode === "collaborative" ? "editor" : "viewer";

  // Upsert so clicking the link twice is harmless
  const member = await prisma.calendarMember.upsert({
    where: {
      calendarId_userId: { calendarId: calendar.id, userId: session.user.id },
    },
    update: { role },
    create: { calendarId: calendar.id, userId: session.user.id, role },
  });

  return NextResponse.json({
    calendarId: calendar.id,
    calendarName: calendar.name,
    role: member.role,
  });
}
