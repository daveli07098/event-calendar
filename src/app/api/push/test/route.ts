import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pushConfigured, sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 60_000;
// Per-instance and best-effort (serverless instances do not share it); enough to blunt button-mashing.
const lastSent = new Map<string, number>();

/** POST only: a GET with side effects could be triggered by cross-site navigation. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 });

  const userId = session.user.id;
  const now = Date.now();
  const last = lastSent.get(userId);
  if (last !== undefined && now - last < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    return NextResponse.json(
      { error: `Please wait ${retryAfter}s before sending another test.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: session.user.id },
    select: { endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) {
    return NextResponse.json({ error: "No push subscription on this account" }, { status: 404 });
  }
  lastSent.set(userId, now);
  if (lastSent.size > 1000) {
    for (const [k, t] of lastSent) if (now - t >= COOLDOWN_MS) lastSent.delete(k);
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
