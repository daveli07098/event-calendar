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

  // 2026 FIFA group ranking order (changed from prior tournaments — head-to-head
  // now precedes overall goal difference, and drawing of lots was removed):
  //   1) points
  //   among teams level on points, by matches BETWEEN them:
  //   2) head-to-head points  3) h2h goal difference  4) h2h goals scored
  //   then overall:
  //   5) overall goal difference  6) overall goals scored
  //   7) fair-play points  8) FIFA World Ranking  (neither in our data → team
  //   name as a deterministic final stand-in).
  rows.sort((a, b) => b.pts - a.pts);
  const ordered: TeamStanding[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j].pts === rows[i].pts) j++;
    const tied = rows.slice(i, j);
    if (tied.length > 1) {
      const h2h = headToHead(tied.map((t) => t.team), scores);
      tied.sort((a, b) => {
        const A = h2h.get(a.team)!, B = h2h.get(b.team)!;
        return (
          B.pts - A.pts || B.gd - A.gd || B.gf - A.gf ||   // head-to-head first
          b.gd - a.gd || b.gf - a.gf ||                     // then overall GD/GF
          a.team.localeCompare(b.team)
        );
      });
    }
    ordered.push(...tied);
    i = j;
  }
  ordered.forEach((r, i) => (r.rank = i + 1));
  return ordered;
}

/** Result of the early-clinch analysis for one group. */
export interface GroupClinch {
  /** Per team: the best and worst rank still mathematically possible. */
  byTeam: Record<string, { best: number; worst: number }>;
  first: string | null;  // team that has clinched 1st (best === worst === 1)
  second: string | null; // team that has clinched exactly 2nd
}

/**
 * Detect teams that have mathematically clinched a final group position before
 * all matches are played — e.g. a team on 6 pts that beat its only rival who
 * could match it is already 1st, because the 2026 tiebreak puts head-to-head
 * ahead of goal difference (so that result can't be overturned).
 *
 * Sound (never over-confirms): a position is reported clinched only when it
 * holds in every remaining outcome. The check is analytic — a team X can finish
 * at/above team T only if X's maximum points reach T's current (minimum) points,
 * and if they can only tie there, T's clinch holds when T won their head-to-head
 * (a single group match, already locked). Clinches that would depend on overall
 * goal difference (manipulable by lopsided scorelines) are conservatively not
 * reported.
 */
export function clinchedPositions(
  teams: string[],
  fixtures: { home: string; away: string }[],
  scores: MatchScore[],
): GroupClinch {
  const standings = computeStandings(teams, scores);
  const ptsOf = new Map(standings.map((s) => [s.team, s.pts]));
  const pts = (t: string) => ptsOf.get(t) ?? 0;

  // Remaining games per team (fixtures with no final score yet).
  const playedKey = new Set(
    scores.filter((s) => s.homeScore != null && s.awayScore != null).map((s) => `${s.home}|${s.away}`),
  );
  const rem: Record<string, number> = Object.fromEntries(teams.map((t) => [t, 0]));
  for (const f of fixtures) {
    if (!playedKey.has(`${f.home}|${f.away}`)) { rem[f.home]++; rem[f.away]++; }
  }
  const maxPts = (t: string) => pts(t) + 3 * (rem[t] ?? 0);

  // "winner|loser" for every decided match — the locked head-to-head record.
  const beat = new Set<string>();
  for (const s of scores) {
    if (s.homeScore == null || s.awayScore == null) continue;
    if (s.homeScore > s.awayScore) beat.add(`${s.home}|${s.away}`);
    else if (s.awayScore > s.homeScore) beat.add(`${s.away}|${s.home}`);
  }

  // Is `low` guaranteed to finish below `high`? (high always ranks above low)
  const belowLocked = (low: string, high: string): boolean => {
    if (maxPts(low) < pts(high)) return true;                       // can't even reach high
    if (maxPts(low) === pts(high) && beat.has(`${high}|${low}`)) return true; // tie → h2h locks high
    return false;
  };

  const byTeam: Record<string, { best: number; worst: number }> = {};
  for (const t of teams) {
    let guaranteedAbove = 0, possiblyAbove = 0;
    for (const x of teams) {
      if (x === t) continue;
      if (belowLocked(t, x)) guaranteedAbove++;   // x is certainly above t
      if (!belowLocked(x, t)) possiblyAbove++;     // x could still be above t
    }
    byTeam[t] = { best: 1 + guaranteedAbove, worst: 1 + possiblyAbove };
  }
  const clinchedAt = (r: number) => teams.find((t) => byTeam[t].best === r && byTeam[t].worst === r) ?? null;
  return { byTeam, first: clinchedAt(1), second: clinchedAt(2) };
}

/** Mini-table among a tied subset, counting only the matches between them. */
function headToHead(subset: string[], scores: MatchScore[]): Map<string, { pts: number; gd: number; gf: number }> {
  const set = new Set(subset);
  const m = new Map(subset.map((t) => [t, { pts: 0, gd: 0, gf: 0 }]));
  for (const s of scores) {
    if (s.homeScore == null || s.awayScore == null) continue;
    if (!set.has(s.home) || !set.has(s.away)) continue;
    const h = m.get(s.home)!, a = m.get(s.away)!;
    h.gf += s.homeScore; h.gd += s.homeScore - s.awayScore;
    a.gf += s.awayScore; a.gd += s.awayScore - s.homeScore;
    if (s.homeScore > s.awayScore) h.pts += 3;
    else if (s.homeScore < s.awayScore) a.pts += 3;
    else { h.pts += 1; a.pts += 1; }
  }
  return m;
}

/**
 * Official 2026 Round-of-32 third-place slots: which Round-of-32 match (by FIFA
 * match number) is filled by a best-third, and the exact set of groups that
 * third can come from. 8 of the 12 groups' third-placed teams advance, and FIFA
 * fixes in advance which group-letters feed which match (there are 495 possible
 * group combinations; the *slots* themselves are these 8 fixed letter-sets).
 *
 * Source: 2026 FIFA World Cup knockout stage bracket (Wikipedia).
 *   Match 74 ← 3rd of A/B/C/D/F · Match 77 ← C/D/F/G/H · Match 79 ← C/E/F/H/I
 *   Match 80 ← E/H/I/J/K · Match 81 ← B/E/F/I/J · Match 82 ← A/E/H/I/J
 *   Match 85 ← E/F/G/I/J · Match 87 ← D/E/I/J/L
 */
export const THIRD_PLACE_SLOTS: Record<number, string[]> = {
  74: ["A", "B", "C", "D", "F"],
  77: ["C", "D", "F", "G", "H"],
  79: ["C", "E", "F", "H", "I"],
  80: ["E", "H", "I", "J", "K"],
  81: ["B", "E", "F", "I", "J"],
  82: ["A", "E", "H", "I", "J"],
  85: ["E", "F", "G", "I", "J"],
  87: ["D", "E", "I", "J", "L"],
};

/** A resolved knockout slot: the team (if derivable) and whether it's locked. */
export interface ResolvedSlot {
  label: string;          // original placeholder, e.g. "A組亞軍" / "最佳第三名(ABCDF)"
  team: string | null;    // resolved team name, or null if not yet derivable
  confirmed: boolean;     // true = mathematically locked; false = provisional
  group: string | null;   // the group this position comes from (for the tooltip)
  position: 1 | 2 | 3 | null; // 1=winner 2=runner-up 3=third
  thirdGroups?: string[] | null; // for a 3rd-place slot: the candidate groups (e.g. ["A","B","C","D","F"])
  // for a 3rd-place slot: each candidate group's current 3rd-placed team
  // (team is null until that group has standings), e.g. [{group:"A",team:"荷蘭"},…]
  thirdCandidates?: { group: string; team: string | null }[] | null;
  title?: string;         // hover tooltip text, filled in by the UI layer
}

/**
 * Monte-Carlo odds that each team finishes 1st/2nd/3rd in its group, given the
 * played results and the remaining fixtures (random scorelines, FIFA tiebreaks).
 * Returns fractions 0–1. When the group is finished it's deterministic (1 or 0).
 */
export function groupOdds(
  teams: string[],
  fixtures: { home: string; away: string }[],
  known: MatchScore[],
  sims = 1500,
): Record<string, { first: number; second: number; third: number }> {
  const played = known.filter((s) => s.homeScore != null && s.awayScore != null);
  const playedKey = new Set(played.map((s) => `${s.home}|${s.away}`));
  const remaining = fixtures.filter((f) => !playedKey.has(`${f.home}|${f.away}`));

  const tally: Record<string, { first: number; second: number; third: number }> = {};
  for (const t of teams) tally[t] = { first: 0, second: 0, third: 0 };

  const runs = remaining.length === 0 ? 1 : sims;
  for (let s = 0; s < runs; s++) {
    const sim = played.slice();
    for (const f of remaining) {
      sim.push({ home: f.home, away: f.away, homeScore: Math.floor(Math.random() * 4), awayScore: Math.floor(Math.random() * 4) });
    }
    const st = computeStandings(teams, sim);
    if (st[0]) tally[st[0].team].first++;
    if (st[1]) tally[st[1].team].second++;
    if (st[2]) tally[st[2].team].third++;
  }
  for (const t of teams) {
    tally[t] = { first: tally[t].first / runs, second: tally[t].second / runs, third: tally[t].third / runs };
  }
  return tally;
}

/** A group is complete once all four teams have played their three matches. */
function groupComplete(standings?: TeamStanding[]): boolean {
  return !!standings && standings.length >= 4 && standings.every((s) => s.p >= 3);
}

/**
 * The 12 third-placed teams ranked to pick the best 8. FIFA order: group points
 * → goal difference → goals for → fair-play points → drawing of lots. Card data
 * isn't in our snapshot, so fair-play is skipped and the group letter stands in
 * for the draw (deterministic).
 */
export function rankThirds(perGroup: Record<string, TeamStanding[]>): { group: string; standing: TeamStanding }[] {
  const thirds: { group: string; standing: TeamStanding }[] = [];
  for (const [group, st] of Object.entries(perGroup)) {
    if (st && st[2]) thirds.push({ group, standing: st[2] });
  }
  thirds.sort((a, b) => {
    const A = a.standing, B = b.standing;
    return B.pts - A.pts || B.gd - A.gd || B.gf - A.gf || a.group.localeCompare(b.group);
  });
  return thirds;
}

/**
 * Resolve Round-of-32 placeholder slots to actual teams from the standings:
 *   "X組冠軍" → group X winner · "X組亞軍" → runner-up · "最佳第三名(SET)" →
 *   highest-ranked best-third from one of the groups in SET (greedy, no reuse).
 * `confirmed` is true when the spot is locked (group complete, or all groups
 * complete for best-thirds), else the result is provisional. Unresolvable labels
 * (e.g. "M73勝者") return team:null so the caller keeps the placeholder.
 * Keyed by match eventId.
 */
export function resolveKnockout(
  r32: KnockoutMatch[],
  perGroup: Record<string, TeamStanding[]>,
  clinch?: Record<string, { first: string | null; second: string | null }>,
): Record<string, { home: ResolvedSlot; away: ResolvedSlot }> {
  const groups = Object.keys(perGroup);
  const allComplete = groups.length >= 12 && groups.every((g) => groupComplete(perGroup[g]));
  const qualified = rankThirds(perGroup).slice(0, 8); // best 8 thirds advance
  const usedThirds = new Set<string>();

  const resolveLabel = (label: string, matchId: number | null): ResolvedSlot => {
    let m = label.match(/^([A-L])組冠軍$/);
    if (m) {
      const st = perGroup[m[1]];
      const team = st?.[0]?.team ?? null;
      // Confirmed once the group is complete OR the leader has mathematically
      // clinched 1st place early (e.g. via a locked head-to-head result).
      const confirmed = groupComplete(st) || (team != null && clinch?.[m[1]]?.first === team);
      return { label, team, confirmed, group: m[1], position: 1 };
    }
    m = label.match(/^([A-L])組亞軍$/);
    if (m) {
      const st = perGroup[m[1]];
      const team = st?.[1]?.team ?? null;
      const confirmed = groupComplete(st) || (team != null && clinch?.[m[1]]?.second === team);
      return { label, team, confirmed, group: m[1], position: 2 };
    }
    // A best-third slot. The candidate group-set is taken from the official
    // FIFA slot table (by match number) — authoritative even when the imported
    // title encodes the set wrongly or generically ("最佳第三名" with no list).
    if (/第三名/.test(label)) {
      const fromMap = matchId != null ? THIRD_PLACE_SLOTS[matchId] : undefined;
      const fromLabel = label.match(/\(([A-L]+)\)/)?.[1].split("");
      const allowedArr = fromMap ?? fromLabel ?? [];
      const allowed = new Set(allowedArr);
      const pick = qualified.find((t) => allowed.has(t.group) && !usedThirds.has(t.group));
      if (pick) usedThirds.add(pick.group);
      // Every candidate group's current 3rd-placed team, so the UI can show the
      // actual teams that could fill this slot (荷蘭/巴西/…), not just letters.
      const thirdCandidates = allowedArr.map((g) => ({ group: g, team: perGroup[g]?.[2]?.team ?? null }));
      return {
        label, team: pick?.standing.team ?? null, confirmed: allComplete,
        group: pick?.group ?? null, position: 3, thirdGroups: allowedArr, thirdCandidates,
      };
    }
    return { label, team: null, confirmed: false, group: null, position: null };
  };

  const out: Record<string, { home: ResolvedSlot; away: ResolvedSlot }> = {};
  for (const match of [...r32].sort((a, b) => (a.matchId ?? 0) - (b.matchId ?? 0))) {
    out[match.eventId] = {
      home: resolveLabel(match.home, match.matchId),
      away: resolveLabel(match.away, match.matchId),
    };
  }
  return out;
}
