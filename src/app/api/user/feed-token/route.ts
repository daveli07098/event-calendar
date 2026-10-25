import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function urls(req: NextRequest, token: string | null) {
  if (!token) return { url: null, webcalUrl: null };
  const origin = req.nextUrl.origin;
  const url = `${origin}/api/feed/${token}.ics`;
  return { url, webcalUrl: url.replace(/^https?:\/\//, "webcal://") };
}

async function userId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET(req: NextRequest) {
  const id = await userId();
  if (!id) return unauthorized();
  const user = await prisma.user.findUnique({ where: { id }, select: { feedToken: true } });
  return NextResponse.json(urls(req, user?.feedToken ?? null));
}

/** Create or regenerate (invalidates the previous URL). */
export async function POST(req: NextRequest) {
  const id = await userId();
  if (!id) return unauthorized();
  const feedToken = randomBytes(24).toString("base64url");
  await prisma.user.update({ where: { id }, data: { feedToken } });
  return NextResponse.json(urls(req, feedToken));
}

export async function DELETE() {
  const id = await userId();
  if (!id) return unauthorized();
  await prisma.user.update({ where: { id }, data: { feedToken: null } });
  return NextResponse.json({ url: null, webcalUrl: null });
}
