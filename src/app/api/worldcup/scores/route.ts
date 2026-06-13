import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { callGeminiGrounded, hasAiProvider } from "@/lib/ai/client";
import {
  AI_DAILY_LIMIT,
  checkRemainingAiLimit,
  incrementAiLimit,
  remainingAiCalls,
  getResetAt,
} from "@/lib/ai/quota";
import { buildGroups, computeStandings, type MatchScore, type TeamStanding } from "@/lib/worldcup";
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

// Grounding-capable Gemini models, tried in order until one answers.
const GROUNDED_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash"];

// ── GET: return the cached snapshot (or null if never refreshed / table absent) ──
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const row = await prisma.worldCupScores.findUnique({ where: { id: SCORES_ID } });
    if (!row) return NextResponse.json({ data: null, fetchedAt: null, provider: null });
    return NextResponse.json({ data: row.data, fetchedAt: row.fetchedAt, provider: row.provider });
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
  const lines = flat
    .map((f) => `${f.n}. [Group ${f.group}] ${f.home} vs ${f.away} (kickoff ${f.kickoff.slice(0, 10)})`)
    .join("\n");

  return `You are a football data assistant. Use Google Search to find the actual result of each 2026 FIFA World Cup group-stage match listed below. Today's date may be mid-tournament, so many matches already have final scores — search for them.

For EACH numbered fixture return its score. If a match genuinely has not been played yet, use null for both scores and status "scheduled". Report the score for the team listed first as "homeScore" and the team listed second as "awayScore".

Fixtures (keep the numbers — do not reorder):
${lines}

Return ONLY a JSON object (no markdown, no prose) of this exact shape:
{ "results": [ { "n": 1, "homeScore": 2, "awayScore": 1, "status": "FT" }, { "n": 2, "homeScore": null, "awayScore": null, "status": "scheduled" } ] }

Use integers for scores. Include every fixture number. Never invent results — if a real score can't be found, use null.`;
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
  if (!(await checkRemainingAiLimit(uid))) {
    return NextResponse.json(
      { error: `Daily AI limit reached (${AI_DAILY_LIMIT}/day)`, resetAt: getResetAt() },
      { status: 429 },
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
  const prompt = buildPrompt(flat);

  // Try each grounding-capable model until one succeeds.
  let aiData: Record<string, unknown> | null = null;
  let provider = "";
  const failures: string[] = [];
  for (const model of GROUNDED_MODELS) {
    try {
      const res = await callGeminiGrounded(prompt, model);
      aiData = res.data;
      provider = res.provider;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(msg);
      console.warn(`[worldcup/scores] ${model} failed: ${msg}`);
    }
  }
  if (!aiData) {
    return NextResponse.json(
      { error: `Score lookup failed: ${[...new Set(failures)].slice(0, 2).join(" | ") || "unknown"}` },
      { status: 502 },
    );
  }
  await incrementAiLimit(uid);

  // Map AI results back onto OUR fixtures by fixture number — robust against the
  // model translating names, swapping home/away, or returning numeric strings.
  const results = Array.isArray(aiData.results) ? aiData.results : [];
  const byNum = new Map<number, { homeScore: number | null; awayScore: number | null; status: string | null }>();
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

  // Diagnosability: how much did the model actually return / score?
  const scoredCount = [...byNum.values()].filter((v) => v.homeScore != null && v.awayScore != null).length;
  console.log(
    `[worldcup/scores] provider=${provider} fixtures=${flat.length} results=${byNum.size} scored=${scoredCount}`,
  );

  const snapshot: ScoresSnapshot = { groups: {}, asOf: new Date().toISOString() };
  for (const g of groups) {
    const scores: MatchScore[] = [];
    for (const f of flat.filter((x) => x.group === g.group)) {
      const r = byNum.get(f.n);
      scores.push({
        home: f.home,
        away: f.away,
        homeScore: r?.homeScore ?? null,
        awayScore: r?.awayScore ?? null,
        status: r?.status ?? null,
      });
    }
    snapshot.groups[g.group] = {
      matches: scores,
      standings: computeStandings(g.teams, scores),
    };
  }

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
