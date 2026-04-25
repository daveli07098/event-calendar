import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Returns calendar if user is owner OR an editor member */
async function getCalendarWithAccess(id: string, userId: string, requireOwner = false) {
  const calendar = await prisma.calendar.findUnique({ where: { id } });
  if (!calendar) return null;
  if (calendar.userId === userId) return { calendar, role: "owner" as const };
  if (requireOwner) return null;
  const member = await prisma.calendarMember.findUnique({
    where: { calendarId_userId: { calendarId: id, userId } },
  });
  if (member?.role === "editor") return { calendar, role: "editor" as const };
  return null;
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
  const { name, color, isVisible } = body;

  // Only owner can rename/recolor their own calendar
  const calendar = await prisma.calendar.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!calendar) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.calendar.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(color !== undefined && { color }),
      ...(isVisible !== undefined && { isVisible }),
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      },
    },
  });

  return NextResponse.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    members: updated.members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
  });
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

  const calendar = await prisma.calendar.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!calendar) {
    // Allow member to leave (removes their membership row)
    const membership = await prisma.calendarMember.findUnique({
      where: { calendarId_userId: { calendarId: id, userId: session.user.id } },
    });
    if (membership) {
      await prisma.calendarMember.delete({
        where: { calendarId_userId: { calendarId: id, userId: session.user.id } },
      });
      return NextResponse.json({ success: true, left: true });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (calendar.isDefault) {
    return NextResponse.json(
      { error: "Cannot delete default calendar" },
      { status: 400 }
    );
  }

  await prisma.calendar.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
