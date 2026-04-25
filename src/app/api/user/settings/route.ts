import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { themeSettings: true },
  });

  return NextResponse.json({ theme: user?.themeSettings ?? null });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { theme } = body;

  if (!theme || typeof theme !== "object") {
    return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { themeSettings: theme },
  });

  return NextResponse.json({ ok: true });
}
