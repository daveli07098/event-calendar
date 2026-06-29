/**
 * Shared World Cup score-refresh engine. Used by both the manual refresh
 * (POST /api/worldcup/scores, with a user session) and the daily background cron
 * (GET /api/worldcup/cron, server-triggered) so there is exactly ONE refresh
 * code path.
 *
 * Pipeline: read the user's WC fixtures → ground group + Round-of-32 scores via
 * Gemini (reusing cached/locked results) → compute standings → overlay verified
 * results (which always win) → persist the singleton snapshot.
 */
import { prisma } from "@/lib/prisma";
import { callGeminiGrounded, hasAiProvider, GROUNDED_MODELS } from "@/lib/ai/client";
import { checkRemainingAiLimit, incrementAiLimit, getResetAt } from "@/lib/ai/quota";
import {
  buildGroups,
  buildBracket,
  computeStandings,
  resolveKnockout,
  clinchedPositions,
  type MatchScore,
  type TeamStanding,
} from "@/lib/worldcup";
import { mergeVerifiedGroups, mergeVerifiedKnockout, getKnockoutScore, getKnockoutTeams } from "@/lib/worldcup-results";
import type { EventType } from "@/types";

export const SCORES_ID = "global"; // singleton row — scores are global facts

/** Per-group snapshot: AI-fetched scorelines + server-computed standings. */
export interface GroupScores {
  standings: TeamStanding[];
  matches: MatchScore[];
}
/** A knockout scoreline keyed by FIFA match number (real resolved team names). */
export interface KnockoutMatchScore {
  matchId: number;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string | null;
}
export interface ScoresSnapshot {
  groups: Record<string, GroupScores>;
  knockout?: KnockoutMatchScore[];
  asOf: string; // ISO timestamp of the refresh
}

/** Read a user's World Cup fixtures (group + knockout) from the DB. */
async function loadGroupEvents(uid: string): Promise<EventType[]> {
  const cals = await prisma.calendar.findMany({ where: { userId: uid }, select: { id: true } });
  const ids = cals.map((c) => c.id);
  if (ids.length === 0) return [];
  const rows = await prisma.event.findMany({
    where: { calendarId: { in: ids }, description: { contains: "FIFA 世界盃" } },
    orderBy: { startTime: "asc" },
  });
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

/** A previously-fetched scoreline, keyed for cheap reuse. */
type CachedScore = { homeScore: number | null; awayScore: number | null; status: string | null };

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

async function loadCachedKnockout(): Promise<Map<number, CachedScore>> {
  const map = new Map<number, CachedScore>();
  try {
    const row = await prisma.worldCupScores.findUnique({ where: { id: SCORES_ID } });
    const ko = (row?.data as ScoresSnapshot | undefined)?.knockout;
    if (!ko) return map;
    for (const m of ko) {
      map.set(m.matchId, { homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null, status: m.status ?? null });
    }
  } catch {
    // Table not migrated / malformed JSON — treat as no cache.
  }
  return map;
}

interface FlatFixture { n: number; group: string; home: string; away: string; kickoff: string }

/** Number every group fixture so the AI returns scores by number — no fragile
 *  team-name / order / group-key matching. */
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
    .map((f) => `${f.n}. ${f.home} vs ${f.away} [${f.group}, ${f.kickoff.slice(0, 10)}]`)
    .join("\n");
  return `Use Google Search to find the final/current score of each 2026 FIFA World Cup match below. homeScore = first team, awayScore = second team. If a match has not been played yet or no real score is found, use null for both (never guess).

${lines}

Return ONLY this JSON (no prose): {"results":[{"n":1,"homeScore":2,"awayScore":1,"status":"FT"}]}. Integers only. Include every number above.`;
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

interface FlatKnockout { matchId: number; home: string; away: string; kickoff: string }

/**
 * Resolve Round-of-32 fixtures to REAL team names from the (cached + verified)
 * group standings, so the AI can be asked for their scores by team name. Only
 * confirmed slots with both real teams are returned. Deeper rounds (M-prefixed)
 * aren't resolvable until earlier results propagate — they score via verified only.
 */
function resolveKnockoutFixtures(
  groups: ReturnType<typeof buildGroups>,
  events: EventType[],
  prior: Map<string, CachedScore>,
): FlatKnockout[] {
  const perGroupSnap: Record<string, { standings: TeamStanding[]; matches: MatchScore[] }> = {};
  for (const g of groups) {
    const matches: MatchScore[] = g.matches.map((m) => {
      const c = prior.get(`${g.group}|${m.home}|${m.away}`);
      return { home: m.home, away: m.away, homeScore: c?.homeScore ?? null, awayScore: c?.awayScore ?? null };
    });
    perGroupSnap[g.group] = { matches, standings: computeStandings(g.teams, matches) };
  }
  mergeVerifiedGroups(perGroupSnap); // verified group results → correct standings
  const perGroup: Record<string, TeamStanding[]> = {};
  for (const [k, v] of Object.entries(perGroupSnap)) perGroup[k] = v.standings;
  const clinch: Record<string, { first: string | null; second: string | null }> = {};
  for (const g of groups) {
    const c = clinchedPositions(g.teams, g.matches.map((m) => ({ home: m.home, away: m.away })), perGroupSnap[g.group].matches);
    clinch[g.group] = { first: c.first, second: c.second };
  }
  const r32 = buildBracket(events).find((r) => r.round === "R32")?.matches ?? [];
  const resolved = resolveKnockout(r32, perGroup, clinch);
  const out: FlatKnockout[] = [];
  for (const m of r32) {
    if (m.matchId == null) continue;
    // The official R32 matchup (zh-yue) overrides the dynamically-resolved teams
    // — the seed's per-match-number slot map was off, so resolveKnockout alone
    // would ask the AI about the wrong pairing.
    const vt = getKnockoutTeams(m.matchId);
    if (vt) {
      out.push({ matchId: m.matchId, home: vt.home, away: vt.away, kickoff: m.kickoff });
      continue;
    }
    const r = resolved[m.eventId];
    if (r?.home?.team && r?.away?.team && r.home.confirmed && r.away.confirmed) {
      out.push({ matchId: m.matchId, home: r.home.team, away: r.away.team, kickoff: m.kickoff });
    }
  }
  return out;
}

/** Result of a refresh attempt — mapped to an HTTP response by the caller. */
export type RefreshOutcome =
  | { ok: true; snapshot: ScoresSnapshot; provider: string; usedAi: boolean }
  | { ok: false; status: number; error: string; resetAt?: string };

/**
 * Refresh the global World Cup scores snapshot for a given user's fixtures and
 * persist it. Returns a discriminated outcome so both the session route and the
 * cron route can map it to the right HTTP status.
 */
export async function refreshWorldCupScores(uid: string): Promise<RefreshOutcome> {
  if (!hasAiProvider() || !process.env.GEMINI_API_KEY) {
    return { ok: false, status: 503, error: "Score refresh requires a configured Gemini API key (GEMINI_API_KEY)" };
  }

  const events = await loadGroupEvents(uid);
  const groups = buildGroups(events);
  if (groups.length === 0) {
    return { ok: false, status: 404, error: "No World Cup group fixtures found in your calendars" };
  }

  const flat = flattenFixtures(groups);
  const prior = await loadCachedScores();
  const keyOf = (group: string, home: string, away: string) => `${group}|${home}|${away}`;
  const today = new Date().toISOString().slice(0, 10);

  const needed = flat.filter((f) => {
    const day = f.kickoff.slice(0, 10);
    if (day > today) return false; // future match — no score to find yet
    const cached = prior.get(keyOf(f.group, f.home, f.away));
    const locked = cached && cached.homeScore != null && cached.awayScore != null && day < today;
    return !locked;
  });

  // ── Knockout (B): resolve R32 to real teams and fetch their scores too ──
  const flatKO = resolveKnockoutFixtures(groups, events, prior);
  const priorKO = await loadCachedKnockout();
  const neededKO = flatKO.filter((k) => {
    const day = k.kickoff.slice(0, 10);
    if (day > today) return false;
    if (getKnockoutScore(k.matchId)) return false; // verified (A) wins — skip AI
    const cached = priorKO.get(k.matchId);
    const locked = cached && cached.homeScore != null && cached.awayScore != null && day < today;
    return !locked;
  });
  // KO fixtures are numbered 1000+matchId so they never collide with group
  // fixture numbers and map straight back to a matchId.
  const sendList: FlatFixture[] = [
    ...needed,
    ...neededKO.map((k) => ({ n: 1000 + k.matchId, group: `KO M${k.matchId}`, home: k.home, away: k.away, kickoff: k.kickoff })),
  ];

  const byNum = new Map<number, CachedScore>();
  let provider = "";
  let usedAi = false;

  if (sendList.length === 0) {
    provider = (await prisma.worldCupScores.findUnique({ where: { id: SCORES_ID } }).then((r) => r?.provider).catch(() => null)) || "cache";
    console.log(`[worldcup/refresh] no fixtures need refresh — served ${prior.size} cached scores`);
  } else {
    if (!(await checkRemainingAiLimit(uid))) {
      return { ok: false, status: 429, error: "Daily AI limit reached", resetAt: getResetAt() };
    }
    const prompt = buildPrompt(sendList);
    const maxOut = Math.min(8192, Math.max(1024, sendList.length * 48));

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
        console.warn(`[worldcup/refresh] ${model} returned no results — trying next model`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${model}: ${msg}`);
        console.warn(`[worldcup/refresh] ${model} failed: ${msg}`);
      }
    }
    if (!aiData) aiData = fallback?.data ?? null;
    if (!aiData) {
      return { ok: false, status: 502, error: `Score lookup failed: ${[...new Set(failures)].slice(0, 2).join(" | ") || "unknown"}` };
    }
    provider = provider || fallback?.provider || "";
    await incrementAiLimit(uid);
    usedAi = true;

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
      `[worldcup/refresh] provider=${provider} sent=${sendList.length} (groups=${needed.length}/${flat.length}, ko=${neededKO.length}/${flatKO.length}) results=${byNum.size} scored=${scoredCount} (${prior.size} cached groups, ${priorKO.size} cached ko)`,
    );
  }

  // Merge per fixture: fresh AI (by number) → prior cache → null.
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
    snapshot.groups[g.group] = { matches: scores, standings: computeStandings(g.teams, scores) };
  }
  mergeVerifiedGroups(snapshot.groups); // verified always wins

  const koSnapshot: KnockoutMatchScore[] = flatKO.map((k) => {
    const ai = byNum.get(1000 + k.matchId);
    const cached = priorKO.get(k.matchId);
    const src = ai ?? cached ?? null;
    return {
      matchId: k.matchId,
      home: k.home,
      away: k.away,
      homeScore: src?.homeScore ?? null,
      awayScore: src?.awayScore ?? null,
      status: src?.status ?? null,
    };
  });
  mergeVerifiedKnockout(koSnapshot);
  snapshot.knockout = koSnapshot;

  // Persist (best-effort — feature still works if the table isn't migrated yet).
  try {
    await prisma.worldCupScores.upsert({
      where: { id: SCORES_ID },
      create: { id: SCORES_ID, data: snapshot as object, provider },
      update: { data: snapshot as object, provider },
    });
  } catch (e) {
    console.warn(`[worldcup/refresh] could not persist (table missing?): ${(e as Error).message}`);
  }

  return { ok: true, snapshot, provider, usedAi };
}
