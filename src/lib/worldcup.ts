/**
 * World Cup tournament parser — derives groups, fixtures and the knockout
 * bracket deterministically from existing calendar events. No AI involved here:
 * all structure comes from the event titles/descriptions the schedule importer
 * already wrote. AI is used only to layer live scores on top (see
 * src/app/api/worldcup/scores/route.ts).
 *
 * Event shapes produced by the importer:
 *   Group game   title: "A組 墨西哥 vs 南非"
 *                desc:  "2026 FIFA 世界盃 | A組 | 墨西哥 vs 南非"
 *   Knockout     title: "32強 | C組冠軍 vs F組亞軍"  /  "16強 | M73勝者 vs M74勝者"
 *                desc:  "...\nWorld Cup Match ID: 73"
 */
import type { EventType } from "@/types";

export type KnockoutRound = "R32" | "R16" | "QF" | "SF" | "ThirdPlace" | "Final";

export interface GroupMatch {
  eventId: string;
  group: string; // "A".."L"
  home: string;
  away: string;
  kickoff: string; // ISO
  location: string | null;
}

export interface KnockoutMatch {
  eventId: string;
  round: KnockoutRound;
  roundLabel: string; // original Chinese label, e.g. "32強"
  matchId: number | null;
  home: string;
  away: string;
  kickoff: string; // ISO
  side: "left" | "right" | "center";
}

export interface BracketRound {
  round: KnockoutRound;
  label: string;
  order: number;
  matches: KnockoutMatch[];
}

export interface GroupView {
  group: string;
  teams: string[];
  matches: GroupMatch[];
}

/** A single result, as returned by the AI score refresh. */
export interface MatchScore {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status?: string | null; // "FT" | "live" | "scheduled" | …
}

export interface TeamStanding {
  team: string;
  p: number; // played
  w: number;
  d: number;
  l: number;
  gf: number; // goals for
  ga: number; // goals against
  gd: number; // goal difference
  pts: number;
  rank: number;
}

// "32強" → round of 32, etc.準決賽/四強 are both seen for the semis.
const ROUND_BY_LABEL: Record<string, { round: KnockoutRound; order: number }> = {
  "32強": { round: "R32", order: 1 },
  "16強": { round: "R16", order: 2 },
  "8強": { round: "QF", order: 3 },
  "4強": { round: "SF", order: 4 },
  準決賽: { round: "SF", order: 4 },
  季軍戰: { round: "ThirdPlace", order: 5 },
  決賽: { round: "Final", order: 6 },
};

export const ROUND_LABELS_EN: Record<KnockoutRound, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-finals",
  SF: "Semi-finals",
  ThirdPlace: "Third place",
  Final: "Final",
};

// Splits "<home> vs <away>" (with optional dot / surrounding space) into two
// trimmed names. Returns null when there's no clear "vs" separator.
function splitTeams(s: string): { home: string; away: string } | null {
  const m = s.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (!m) return null;
  const home = m[1].trim();
  const away = m[2].trim();
  if (!home || !away) return null;
  return { home, away };
}

/** True for any event that belongs to the World Cup schedule. */
export function isWorldCupEvent(e: EventType): boolean {
  if (e.description?.includes("FIFA 世界盃")) return true;
  if (e.calendar?.name?.toLowerCase().trim() === "world cup") return true;
  // Fall back to the title shapes in case the calendar/description differ.
  return /^[A-L]組\s+.+\s+vs\.?\s+/.test(e.title) || /^(\d+強|決賽|季軍戰|準決賽)\s*\|/.test(e.title);
}

/** Parse a group-stage fixture, or null if the event isn't one. */
export function parseGroupMatch(e: EventType): GroupMatch | null {
  const m = e.title.match(/^([A-L])組\s+(.+)$/);
  if (!m) return null;
  const teams = splitTeams(m[2]);
  if (!teams) return null;
  return {
    eventId: e.id,
    group: m[1],
    home: teams.home,
    away: teams.away,
    kickoff: e.startTime,
    location: e.location,
  };
}

const MATCH_ID_RE = /World Cup Match ID:\s*(\d+)/;

/** Parse a knockout fixture, or null if the event isn't one. */
export function parseKnockoutMatch(e: EventType): Omit<KnockoutMatch, "side"> | null {
  const m = e.title.match(/^(\d+強|決賽|季軍戰|準決賽)\s*\|\s*(.+)$/);
  if (!m) return null;
  const roundInfo = ROUND_BY_LABEL[m[1]];
  if (!roundInfo) return null;
  const teams = splitTeams(m[2]);
  if (!teams) return null;
  const idMatch = e.description?.match(MATCH_ID_RE);
  return {
    eventId: e.id,
    round: roundInfo.round,
    roundLabel: m[1],
    matchId: idMatch ? parseInt(idMatch[1], 10) : null,
    home: teams.home,
    away: teams.away,
    kickoff: e.startTime,
  };
}

/**
 * Build the 12 groups (A–L) with their teams and fixtures, sorted by group
 * letter then kickoff. Teams are collected from the fixtures in kickoff order.
 */
export function buildGroups(events: EventType[]): GroupView[] {
  const byGroup = new Map<string, GroupMatch[]>();
  for (const e of events) {
    const gm = parseGroupMatch(e);
    if (!gm) continue;
    const list = byGroup.get(gm.group) ?? [];
    list.push(gm);
    byGroup.set(gm.group, list);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, matches]) => {
      matches.sort((x, y) => x.kickoff.localeCompare(y.kickoff));
      const teams: string[] = [];
      for (const mt of matches) {
        for (const t of [mt.home, mt.away]) if (!teams.includes(t)) teams.push(t);
      }
      return { group, teams: teams.sort((a, b) => a.localeCompare(b)), matches };
    });
}

/**
 * Build the knockout bracket as ordered rounds (R32 → Final). Within each round
 * matches are sorted by matchId (falling back to kickoff), and a left/right
 * side is assigned by splitting the round in half — that's the "which side"
 * grouping for the Road to Trophy view. The Final and Third-place are centered.
 */
export function buildBracket(events: EventType[]): BracketRound[] {
  const byRound = new Map<KnockoutRound, Omit<KnockoutMatch, "side">[]>();
  for (const e of events) {
    const km = parseKnockoutMatch(e);
    if (!km) continue;
    const list = byRound.get(km.round) ?? [];
    list.push(km);
    byRound.set(km.round, list);
  }

  const rounds: BracketRound[] = [];
  for (const info of Object.values(ROUND_BY_LABEL)) {
    // ROUND_BY_LABEL has duplicate rounds (4強/準決賽) — only build each once.
    if (rounds.some((r) => r.round === info.round)) continue;
    const raw = byRound.get(info.round);
    if (!raw || raw.length === 0) continue;

    raw.sort((x, y) => {
      if (x.matchId != null && y.matchId != null) return x.matchId - y.matchId;
      return x.kickoff.localeCompare(y.kickoff);
    });

    const centered = info.round === "Final" || info.round === "ThirdPlace";
    const half = Math.ceil(raw.length / 2);
    const matches: KnockoutMatch[] = raw.map((mt, i) => ({
      ...mt,
      side: centered ? "center" : i < half ? "left" : "right",
    }));

    rounds.push({ round: info.round, label: ROUND_LABELS_EN[info.round], order: info.order, matches });
  }

  return rounds.sort((a, b) => a.order - b.order);
}

/**
 * Compute a group table from the fixtures and any known results. Win = 3 pts,
 * draw = 1. Only matches with both scores present count toward played/points.
 * Sorted by Pts → GD → GF → team name (FIFA's primary tie-breakers; head-to-head
 * isn't attempted here).
 */
export function computeStandings(teams: string[], scores: MatchScore[]): TeamStanding[] {
  const table = new Map<string, TeamStanding>();
  const blank = (team: string): TeamStanding => ({
    team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, rank: 0,
  });
  for (const t of teams) table.set(t, blank(t));

  for (const s of scores) {
    if (s.homeScore == null || s.awayScore == null) continue;
    if (!Number.isFinite(s.homeScore) || !Number.isFinite(s.awayScore)) continue;
    const home = table.get(s.home) ?? blank(s.home);
    const away = table.get(s.away) ?? blank(s.away);
    table.set(s.home, home);
    table.set(s.away, away);

    home.p++; away.p++;
    home.gf += s.homeScore; home.ga += s.awayScore;
    away.gf += s.awayScore; away.ga += s.homeScore;
    if (s.homeScore > s.awayScore) {
      home.w++; home.pts += 3; away.l++;
    } else if (s.homeScore < s.awayScore) {
      away.w++; away.pts += 3; home.l++;
    } else {
      home.d++; away.d++; home.pts += 1; away.pts += 1;
    }
  }

  const rows = [...table.values()];
  for (const r of rows) r.gd = r.gf - r.ga;
  rows.sort(
    (a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team),
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}
