import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshWorldCupScores } from "@/lib/worldcup-refresh";

// Grounded AI lookups can take a while; allow a longer function budget.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background daily refresh (layer A) of the global World Cup scores snapshot,
 * written straight to the DB so it goes live without a redeploy. Triggered by a
 * scheduler (Vercel Cron, see vercel.json) at 07:00 UTC = 15:00 HKT.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
 * when CRON_SECRET is set. A `?key=<CRON_SECRET>` query param is also accepted
 * for manual/other schedulers. Verified results still override the AI scores
 * inside the refresh, so the snapshot stays correct.
 */
async function resolveTargetUid(): Promise<string | null> {
  const email = process.env.WORLDCUP_CRON_USER_EMAIL;
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    return u?.id ?? null;
  }
  // Fallback: the owner of the earliest World Cup fixture in the DB.
  const ev = await prisma.event.findFirst({
    where: { description: { contains: "FIFA 世界盃" } },
    select: { calendar: { select: { userId: true } } },
    orderBy: { startTime: "asc" },
  });
  return ev?.calendar.userId ?? null;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  const key = req.nextUrl.searchParams.get("key");
  if (authHeader !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uid = await resolveTargetUid();
  if (!uid) {
    return NextResponse.json(
      { error: "No World Cup data owner found (set WORLDCUP_CRON_USER_EMAIL)" },
      { status: 404 },
    );
  }

  const result = await refreshWorldCupScores(uid);
  if (!result.ok) {
    return NextResponse.json(
      result.resetAt ? { error: result.error, resetAt: result.resetAt } : { error: result.error },
      { status: result.status },
    );
  }

  const knockoutScored = (result.snapshot.knockout ?? []).filter(
    (k) => k.homeScore != null && k.awayScore != null,
  ).length;
  console.log(`[worldcup/cron] refreshed (provider=${result.provider}, usedAi=${result.usedAi}, koScored=${knockoutScored})`);
  return NextResponse.json({
    ok: true,
    provider: result.provider,
    usedAi: result.usedAi,
    asOf: result.snapshot.asOf,
    groups: Object.keys(result.snapshot.groups).length,
    knockoutScored,
  });
}
