import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

/**
 * POST /api/calendars/[id]/share
 * Body: { mode: "collaborative" | "broadcast" | null }
 * - mode = null  → disable sharing (clear token)
 * - mode = "collaborative" | "broadcast" → enable sharing, rotate/create token
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { mode } = body as { mode: "collaborative" | "broadcast" | null };

  // Only owner may manage sharing
  const calendar = await prisma.calendar.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!calendar) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (mode === null) {
    // Disable sharing — clear token and remove all members
    await prisma.$transaction([
      prisma.calendarMember.deleteMany({ where: { calendarId: id } }),
      prisma.calendar.update({
        where: { id },
        data: { shareToken: null, shareMode: null },
      }),
    ]);
    return NextResponse.json({ shareToken: null, shareMode: null });
  }

  // Generate a new 16-byte URL-safe token
  const shareToken = randomBytes(16).toString("hex");
  const updated = await prisma.calendar.update({
    where: { id },
    data: { shareToken, shareMode: mode },
  });

  return NextResponse.json({
    shareToken: updated.shareToken,
    shareMode: updated.shareMode,
  });
}
