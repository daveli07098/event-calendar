import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { callGeminiGrounded, hasAiProvider, GROUNDED_MODELS } from "@/lib/ai/client";
import {
  AI_DAILY_LIMIT,
  checkRemainingAiLimit,
  incrementAiLimit,
  remainingAiCalls,
  getResetAt,
} from "@/lib/ai/quota";
import { buildGroups, computeStandings, type MatchScore, type TeamStanding } from "@/lib/worldcup";
import { mergeVerifiedGroups } from "@/lib/worldcup-results";
import type { EventType } from "@/types";

const SCORES_ID = "global"; // singleton row — scores are global facts

/** Per-group snapshot: AI-fetched scorelines + server-computed standings. */
interface GroupScores {
  standings: TeamStanding[];
  matches: MatchScore[];
}
interface ScoresSnapshot {
  groups: Record<string, GroupScores>;
  asOf: string; // ISO timestamp of the refresh
}

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
    return NextResponse.json({ data, fetchedAt: row.fetchedAt, provider: row.provider });
  } catch {
    // Table not migrated yet — degrade gracefully, the UI still renders structure.
    return NextResponse.json({ data: null, fetchedAt: null, provider: null });
  }
}

/** Read this user's World Cup group fixtures from the DB. */
async function loadGroupEvents(uid: string): Promise<EventType[]> {
  const cals = await prisma.calendar.findMany({ where: { userId: uid }, select: { id: true } });
  const ids = cals.map((c) => c.id);
  if (ids.length === 0) return [];
  const rows = await prisma.event.findMany({
    where: { calendarId: { in: ids }, description: { contains: "FIFA 世界盃" } },
    orderBy: { startTime: "asc" },
  });
  // Adapt DB rows to the shape the parser reads (only these fields are used).
  return rows.map((r) => ({
    id: r.id,
    calendarId: r.calendarId,
    title: r.title,
    description: r.description,
    location: r.location,
    startTime: r.startTime.toISOString(),
    endTime: r.endTime.toISOString(),
    allDay: r.allDay,
    recurrenceRule: r.recurrenceRule,
    googleEventId: r.googleEventId,
    category: r.category as EventType["category"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** A previously-fetched scoreline, keyed by group/home/away for cheap reuse. */
type CachedScore = { homeScore: number | null; awayScore: number | null; status: string | null };

/** Load the last snapshot's scorelines as a lookup map (empty if none/unmigrated). */
async function loadCachedScores(): Promise<Map<string, CachedScore>> {
  const map = new Map<string, CachedScore>();
  try {
    const row = await prisma.worldCupScores.findUnique({ where: { id: SCORES_ID } });
    const groups = (row?.data as ScoresSnapshot | undefined)?.groups;
    if (!groups) return map;
    for (const [group, gs] of Object.entries(groups)) {
      for (const m of gs.matches ?? []) {
        map.set(`${group}|${m.home}|${m.away}`, {
          homeScore: m.homeScore ?? null,
          awayScore: m.awayScore ?? null,
          status: m.status ?? null,
        });
      }
    }
  } catch {
    // Table not migrated / malformed JSON — treat as no cache.
  }
  return map;
}

interface FlatFixture { n: number; group: string; home: string; away: string; kickoff: string }

/** Number every group fixture so the AI can return scores by number — no
 *  fragile team-name / order / group-key matching. */
function flattenFixtures(groups: ReturnType<typeof buildGroups>): FlatFixture[] {
  const flat: FlatFixture[] = [];
  let n = 1;
  for (const g of groups) {
    for (const m of g.matches) {
      flat.push({ n: n++, group: g.group, home: m.home, away: m.away, kickoff: m.kickoff });
    }
  }
  return flat;
}

function buildPrompt(flat: FlatFixture[]): string {
  // Compact one-line-per-fixture format keeps the prompt small. Only fixtures
  // that have already kicked off are sent (callers pre-filter), so every line
  // is a match the model should actually be able to find a score for.
  const lines = flat
    .map((f) => `${f.n}. ${f.home} vs ${f.away} [${f.group}, ${f.kickoff.slice(0, 10)}]`)
    .join("\n");

  return `Use Google Search to find the final/current score of each 2026 FIFA World Cup match below. homeScore = first team, awayScore = second team. If a match has not been played yet or no real score is found, use null for both (never guess).

${lines}

Return ONLY this JSON (no prose): {"results":[{"n":1,"homeScore":2,"awayScore":1,"status":"FT"}]}. Integers only. Include every number above.`;
}

// Coerce an AI score value (number or numeric string) to an int, else null.
function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

// ── POST: refresh scores via grounded Gemini, compute standings, cache them ──
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uid = session.user.id;

  if (!hasAiProvider() || !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Score refresh requires a configured Gemini API key (GEMINI_API_KEY)" },
      { status: 503 },
    );
  }

  const events = await loadGroupEvents(uid);
  const groups = buildGroups(events);
  if (groups.length === 0) {
    return NextResponse.json(
      { error: "No World Cup group fixtures found in your calendars" },
      { status: 404 },
    );
  }

  const flat = flattenFixtures(groups);

  // Reuse already-known scores from the last snapshot so we never spend tokens
  // re-grounding a match that's already final. Keyed by group|home|away.
  const prior = await loadCachedScores();
  const keyOf = (group: string, home: string, away: string) => `${group}|${home}|${away}`;
  const today = new Date().toISOString().slice(0, 10);

  // A fixture needs an AI lookup only when it has already kicked off AND isn't
  // already locked in cache. "Locked" = both scores known and the match was on a
  // previous day (today's matches may still be live, so re-fetch those).
  const needed = flat.filter((f) => {
    const day = f.kickoff.slice(0, 10);
    if (day > today) return false; // future match — no score to find yet
    const cached = prior.get(keyOf(f.group, f.home, f.away));
    const locked = cached && cached.homeScore != null && cached.awayScore != null && day < today;
    return !locked;
  });

  const byNum = new Map<number, { homeScore: number | null; awayScore: number | null; status: string | null }>();
  let provider = "";

  if (needed.length === 0) {
    // Nothing new to fetch (pre-tournament, or every kicked-off match already
    // cached). Rebuild from cache without spending AI quota.
    provider = (await prisma.worldCupScores.findUnique({ where: { id: SCORES_ID } }).then((r) => r?.provider).catch(() => null)) || "cache";
    console.log(`[worldcup/scores] no fixtures need refresh — served ${prior.size} cached scores`);
  } else {
    // Only now — when we genuinely have matches to ground — does this cost quota.
    if (!(await checkRemainingAiLimit(uid))) {
      return NextResponse.json(
        { error: `Daily AI limit reached (${AI_DAILY_LIMIT}/day)`, resetAt: getResetAt() },
        { status: 429 },
      );
    }
    const prompt = buildPrompt(needed);
    // Size the output budget to the (now small) fixture count instead of a flat
    // 8192 — fewer matches → less to write back → cheaper, faster call.
    const maxOut = Math.min(8192, Math.max(1024, needed.length * 48));

    // Try each grounding-capable model. A model that answers but returns an empty
    // results array is a soft miss — fall through to the next, keeping the empty
    // answer only as a last resort.
    let aiData: Record<string, unknown> | null = null;
    let fallback: { data: Record<string, unknown>; provider: string } | null = null;
    const failures: string[] = [];
    for (const model of GROUNDED_MODELS) {
      try {
        const res = await callGeminiGrounded(prompt, model, maxOut);
        const arr = Array.isArray(res.data.results) ? res.data.results : [];
        if (arr.length > 0) {
          aiData = res.data;
          provider = res.provider;
          break;
        }
        fallback ??= { data: res.data, provider: res.provider };
        failures.push(`${model}: empty results`);
        console.warn(`[worldcup/scores] ${model} returned no results — trying next model`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${model}: ${msg}`);
        console.warn(`[worldcup/scores] ${model} failed: ${msg}`);
      }
    }
    if (!aiData) aiData = fallback?.data ?? null;
    if (!aiData) {
      return NextResponse.json(
        { error: `Score lookup failed: ${[...new Set(failures)].slice(0, 2).join(" | ") || "unknown"}` },
        { status: 502 },
      );
    }
    provider = provider || fallback?.provider || "";
    await incrementAiLimit(uid);

    // Map AI results back onto OUR fixtures by fixture number — robust against the
    // model translating names, swapping home/away, or returning numeric strings.
    const results = Array.isArray(aiData.results) ? aiData.results : [];
    for (const raw of results) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const n = toInt(r.n);
      if (n == null) continue;
      byNum.set(n, {
        homeScore: toInt(r.homeScore),
        awayScore: toInt(r.awayScore),
        status: typeof r.status === "string" ? r.status : null,
      });
    }

    const scoredCount = [...byNum.values()].filter((v) => v.homeScore != null && v.awayScore != null).length;
    console.log(
      `[worldcup/scores] provider=${provider} sent=${needed.length}/${flat.length} results=${byNum.size} scored=${scoredCount} (${prior.size} reused from cache)`,
    );
  }

  // Merge per fixture: fresh AI result (by number) → prior cached score → null.
  const snapshot: ScoresSnapshot = { groups: {}, asOf: new Date().toISOString() };
  for (const g of groups) {
    const scores: MatchScore[] = [];
    for (const f of flat.filter((x) => x.group === g.group)) {
      const ai = byNum.get(f.n);
      const cached = prior.get(keyOf(f.group, f.home, f.away));
      const src = ai ?? cached ?? null;
      scores.push({
        home: f.home,
        away: f.away,
        homeScore: src?.homeScore ?? null,
        awayScore: src?.awayScore ?? null,
        status: src?.status ?? null,
      });
    }
    snapshot.groups[g.group] = {
      matches: scores,
      standings: computeStandings(g.teams, scores),
    };
  }

  // Verified results always win over the AI scorelines we just fetched.
  mergeVerifiedGroups(snapshot.groups);

  // Persist (best-effort — feature still works if the table isn't migrated yet).
  try {
    await prisma.worldCupScores.upsert({
      where: { id: SCORES_ID },
      create: { id: SCORES_ID, data: snapshot as object, provider },
      update: { data: snapshot as object, provider },
    });
  } catch (e) {
    console.warn(`[worldcup/scores] could not persist (table missing?): ${(e as Error).message}`);
  }

  const remaining = await remainingAiCalls(uid);
  return NextResponse.json({
    data: snapshot,
    fetchedAt: snapshot.asOf,
    provider,
    aiQuota: {
      used: AI_DAILY_LIMIT - remaining,
      limit: AI_DAILY_LIMIT,
      remaining,
      resetAt: getResetAt(),
    },
  });
}
