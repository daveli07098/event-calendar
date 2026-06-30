import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AI_DAILY_LIMIT, remainingAiCalls, getResetAt } from "@/lib/ai/quota";
import { mergeVerifiedGroups, mergeVerifiedKnockout } from "@/lib/worldcup-results";
import { refreshWorldCupScores, SCORES_ID, type ScoresSnapshot, type RefreshScope } from "@/lib/worldcup-refresh";

// ── GET: return the cached snapshot (or null if never refreshed / table absent) ──
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const row = await prisma.worldCupScores.findUnique({ where: { id: SCORES_ID } });
    if (!row) return NextResponse.json({ data: null, fetchedAt: null, provider: null });
    // Overlay verified results on top of the cached AI snapshot at read time, so
    // corrected scorelines show immediately without waiting for a refresh.
    const data = row.data as unknown as ScoresSnapshot | null;
    if (data?.groups) mergeVerifiedGroups(data.groups);
    if (data?.knockout) mergeVerifiedKnockout(data.knockout);
    return NextResponse.json({ data, fetchedAt: row.fetchedAt, provider: row.provider });
  } catch {
    // Table not migrated yet — degrade gracefully, the UI still renders structure.
    return NextResponse.json({ data: null, fetchedAt: null, provider: null });
  }
}

// ── POST: refresh scores for the signed-in user via the shared refresh engine ──
// `?scope=group|knockout` limits which stage is refreshed (default: all).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uid = session.user.id;

  const scopeParam = new URL(req.url).searchParams.get("scope");
  const scope: RefreshScope = scopeParam === "group" || scopeParam === "knockout" ? scopeParam : "all";

  const result = await refreshWorldCupScores(uid, scope);
  if (!result.ok) {
    return NextResponse.json(
      result.resetAt ? { error: result.error, resetAt: result.resetAt } : { error: result.error },
      { status: result.status },
    );
  }

  const remaining = await remainingAiCalls(uid);
  return NextResponse.json({
    data: result.snapshot,
    fetchedAt: result.snapshot.asOf,
    provider: result.provider,
    aiQuota: {
      used: AI_DAILY_LIMIT - remaining,
      limit: AI_DAILY_LIMIT,
      remaining,
      resetAt: getResetAt(),
    },
  });
}
