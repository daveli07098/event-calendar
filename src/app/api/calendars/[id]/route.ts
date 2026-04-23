import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  });

  return NextResponse.json(updated);
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
