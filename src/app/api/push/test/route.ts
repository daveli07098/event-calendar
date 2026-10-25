import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pushConfigured, sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 });

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: session.user.id },
    select: { endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) {
    return NextResponse.json({ error: "No push subscription on this account" }, { status: 404 });
  }
  const payload = {
    title: "🔔 Test notification",
    body: "Push reminders are working on this device.",
    url: "/calendar",
    tag: "push-test",
  };
  const results = await Promise.all(subs.map((s) => sendPush(s, payload)));
  return NextResponse.json({
    sent: results.filter((r) => r === "sent").length,
    gone: results.filter((r) => r === "gone").length,
    failed: results.filter((r) => r === "failed").length,
  });
}
