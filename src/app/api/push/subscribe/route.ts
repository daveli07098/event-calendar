import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAllowedPushEndpoint } from "@/lib/push";

export const dynamic = "force-dynamic";

const MAX_SUBSCRIPTIONS_PER_USER = 20;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const authKey = body?.keys?.auth;
  if (
    typeof endpoint !== "string" || endpoint.length > 2048 || !isAllowedPushEndpoint(endpoint) ||
    typeof p256dh !== "string" || typeof authKey !== "string"
  ) {
    return NextResponse.json({ error: "endpoint and keys{p256dh,auth} are required" }, { status: 400 });
  }

  const count = await prisma.pushSubscription.count({ where: { userId } });
  if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint }, select: { userId: true } });
    if (existing?.userId !== userId) {
      return NextResponse.json({ error: "Too many subscriptions" }, { status: 400 });
    }
  }

  // Endpoint is globally unique; re-subscribing on a shared device moves it to the current user.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh, auth: authKey },
    update: { userId, p256dh, auth: authKey },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (typeof body?.endpoint !== "string") {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
