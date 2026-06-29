/**
 * Verified 2026 FIFA World Cup results — the human/source-of-truth layer that
 * takes precedence over AI-grounded scores.
 *
 * Why this exists: live scores were previously fetched only via AI grounding
 * (see src/app/api/worldcup/scores/route.ts), which occasionally recorded the
 * wrong scoreline. Results here are transcribed from Wikipedia (verified, not
 * guessed) and ALWAYS win over the AI snapshot — both when refreshing (POST)
 * and when reading the cached snapshot (GET). AI still fills any gap this file
 * doesn't cover.
 *
 * Orientation matters: scores are keyed by group + home + away in the SAME
 * home/away order the schedule importer used (see scripts/seed-worldcup.ts), so
 * they join onto the parsed fixtures without any name/order matching.
 *
 * Source: https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_group_stage
 *         https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage
 */
import { computeStandings, type MatchScore, type TeamStanding } from "./worldcup";

export interface VerifiedGroupScore {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

/**
 * Final group-stage scorelines per group letter (A–L), in seed home/away order.
 * Groups J/K/L transcribed from the in-app screenshot (each table re-derived and
 * confirmed internally consistent). A–I transcribed from Wikipedia.
 */
export const VERIFIED_GROUP_SCORES: Record<string, VerifiedGroupScore[]> = {
  // ── Group A ──
  A: [
    { home: "墨西哥", away: "南非", homeScore: 2, awayScore: 0 },
    { home: "韓國", away: "捷克", homeScore: 2, awayScore: 1 },
    { home: "捷克", away: "南非", homeScore: 1, awayScore: 1 },
    { home: "墨西哥", away: "韓國", homeScore: 1, awayScore: 0 },
    { home: "捷克", away: "墨西哥", homeScore: 0, awayScore: 3 },
    { home: "南非", away: "韓國", homeScore: 1, awayScore: 0 },
  ],
  // ── Group B ──
  B: [
    { home: "加拿大", away: "波赫", homeScore: 1, awayScore: 1 },
    { home: "卡達", away: "瑞士", homeScore: 1, awayScore: 1 },
    { home: "瑞士", away: "波赫", homeScore: 4, awayScore: 1 },
    { home: "加拿大", away: "卡達", homeScore: 6, awayScore: 0 },
    { home: "瑞士", away: "加拿大", homeScore: 2, awayScore: 1 },
    { home: "波赫", away: "卡達", homeScore: 3, awayScore: 1 },
  ],
  // ── Group C ──
  C: [
    { home: "巴西", away: "摩洛哥", homeScore: 1, awayScore: 1 },
    { home: "海地", away: "蘇格蘭", homeScore: 0, awayScore: 1 },
    { home: "蘇格蘭", away: "摩洛哥", homeScore: 0, awayScore: 1 },
    { home: "巴西", away: "海地", homeScore: 3, awayScore: 0 },
    { home: "蘇格蘭", away: "巴西", homeScore: 0, awayScore: 3 },
    { home: "摩洛哥", away: "海地", homeScore: 4, awayScore: 2 },
  ],
  // ── Group D ──
  D: [
    { home: "美國", away: "巴拉圭", homeScore: 4, awayScore: 1 },
    { home: "澳洲", away: "土耳其", homeScore: 2, awayScore: 0 },
    { home: "美國", away: "澳洲", homeScore: 2, awayScore: 0 },
    { home: "土耳其", away: "巴拉圭", homeScore: 0, awayScore: 1 },
    { home: "土耳其", away: "美國", homeScore: 3, awayScore: 2 },
    { home: "巴拉圭", away: "澳洲", homeScore: 0, awayScore: 0 },
  ],
  // ── Group E ──
  E: [
    { home: "德國", away: "庫拉索", homeScore: 7, awayScore: 1 },
    { home: "科特迪瓦", away: "厄瓜多", homeScore: 1, awayScore: 0 },
    { home: "德國", away: "科特迪瓦", homeScore: 2, awayScore: 1 },
    { home: "厄瓜多", away: "庫拉索", homeScore: 0, awayScore: 0 },
    { home: "庫拉索", away: "科特迪瓦", homeScore: 0, awayScore: 2 },
    { home: "厄瓜多", away: "德國", homeScore: 2, awayScore: 1 },
  ],
  // ── Group F ──
  F: [
    { home: "荷蘭", away: "日本", homeScore: 2, awayScore: 2 },
    { home: "瑞典", away: "突尼斯", homeScore: 5, awayScore: 1 },
    { home: "荷蘭", away: "瑞典", homeScore: 5, awayScore: 1 },
    { home: "突尼斯", away: "日本", homeScore: 0, awayScore: 4 },
    { home: "日本", away: "瑞典", homeScore: 1, awayScore: 1 },
    { home: "突尼斯", away: "荷蘭", homeScore: 1, awayScore: 3 },
  ],
  // ── Group G ──
  G: [
    { home: "比利時", away: "埃及", homeScore: 1, awayScore: 1 },
    { home: "伊朗", away: "紐西蘭", homeScore: 2, awayScore: 2 },
    { home: "比利時", away: "伊朗", homeScore: 0, awayScore: 0 },
    { home: "紐西蘭", away: "埃及", homeScore: 1, awayScore: 3 },
    { home: "埃及", away: "伊朗", homeScore: 1, awayScore: 1 },
    { home: "紐西蘭", away: "比利時", homeScore: 1, awayScore: 5 },
  ],
  // ── Group H ──
  H: [
    { home: "西班牙", away: "佛得角", homeScore: 0, awayScore: 0 },
    { home: "沙特阿拉伯", away: "烏拉圭", homeScore: 1, awayScore: 1 },
    { home: "西班牙", away: "沙特阿拉伯", homeScore: 4, awayScore: 0 },
    { home: "烏拉圭", away: "佛得角", homeScore: 2, awayScore: 2 },
    { home: "佛得角", away: "沙特阿拉伯", homeScore: 0, awayScore: 0 },
    { home: "烏拉圭", away: "西班牙", homeScore: 0, awayScore: 1 },
  ],
  // ── Group I ──
  I: [
    { home: "法國", away: "塞內加爾", homeScore: 3, awayScore: 1 },
    { home: "伊拉克", away: "挪威", homeScore: 1, awayScore: 4 },
    { home: "法國", away: "伊拉克", homeScore: 3, awayScore: 0 },
    { home: "挪威", away: "塞內加爾", homeScore: 3, awayScore: 2 },
    { home: "挪威", away: "法國", homeScore: 1, awayScore: 4 },
    { home: "塞內加爾", away: "伊拉克", homeScore: 5, awayScore: 0 },
  ],
  // ── Group J ──
  J: [
    { home: "阿根廷", away: "阿爾及利亞", homeScore: 3, awayScore: 0 },
    { home: "奧地利", away: "約旦", homeScore: 3, awayScore: 1 },
    { home: "阿根廷", away: "奧地利", homeScore: 2, awayScore: 0 },
    { home: "約旦", away: "阿爾及利亞", homeScore: 1, awayScore: 2 },
    { home: "阿爾及利亞", away: "奧地利", homeScore: 2, awayScore: 2 },
    { home: "約旦", away: "阿根廷", homeScore: 1, awayScore: 2 },
  ],
  // ── Group K ──
  K: [
    { home: "葡萄牙", away: "剛果民主共和國", homeScore: 1, awayScore: 1 },
    { home: "烏茲別克", away: "哥倫比亞", homeScore: 1, awayScore: 3 },
    { home: "葡萄牙", away: "烏茲別克", homeScore: 5, awayScore: 0 },
    { home: "哥倫比亞", away: "剛果民主共和國", homeScore: 1, awayScore: 0 },
    { home: "哥倫比亞", away: "葡萄牙", homeScore: 0, awayScore: 0 },
    { home: "剛果民主共和國", away: "烏茲別克", homeScore: 0, awayScore: 1 },
  ],
  // ── Group L ──
  L: [
    { home: "英格蘭", away: "克羅地亞", homeScore: 4, awayScore: 2 },
    { home: "加納", away: "巴拿馬", homeScore: 1, awayScore: 0 },
    { home: "英格蘭", away: "加納", homeScore: 0, awayScore: 0 },
    { home: "巴拿馬", away: "克羅地亞", homeScore: 0, awayScore: 1 },
    { home: "巴拿馬", away: "英格蘭", homeScore: 0, awayScore: 2 },
    { home: "克羅地亞", away: "加納", homeScore: 1, awayScore: 0 },
  ],
  // A–I are populated from verified Wikipedia data (see source links above).
};

export interface VerifiedKnockoutScore {
  matchId: number;
  homeScore: number;
  awayScore: number;
  /** "FT" | "AET" | "live" | a penalty note, etc. */
  status?: string;
  /** Set only when the match was decided on penalties (scores level after AET). */
  winner?: "home" | "away";
}

/**
 * Played knockout scorelines, keyed by FIFA match number, in seed home/away
 * order (home = the first/upper slot of the bracket match). Empty until the
 * knockout stage produces results.
 */
export const VERIFIED_KNOCKOUT_SCORES: VerifiedKnockoutScore[] = [];

// ── Lookup maps (built once) ───────────────────────────────────────────────
const groupScoreMap = new Map<string, VerifiedGroupScore>();
for (const [group, list] of Object.entries(VERIFIED_GROUP_SCORES)) {
  for (const s of list) groupScoreMap.set(`${group}|${s.home}|${s.away}`, s);
}
const knockoutScoreMap = new Map<number, VerifiedKnockoutScore>(
  VERIFIED_KNOCKOUT_SCORES.map((k) => [k.matchId, k]),
);

/** Verified knockout scoreline for a FIFA match number, if known. */
export function getKnockoutScore(matchId: number | null | undefined): VerifiedKnockoutScore | undefined {
  if (matchId == null) return undefined;
  return knockoutScoreMap.get(matchId);
}

/** Winner of a knockout match ("home"/"away") from its verified score, or null. */
export function knockoutWinner(s: VerifiedKnockoutScore | undefined): "home" | "away" | null {
  if (!s) return null;
  if (s.winner) return s.winner; // penalty decision
  if (s.homeScore > s.awayScore) return "home";
  if (s.awayScore > s.homeScore) return "away";
  return null;
}

interface GroupSnapshot { standings: TeamStanding[]; matches: MatchScore[] }

/**
 * Override an AI/cache group snapshot with verified scorelines and recompute the
 * standings for any group that changed. Mutates and returns the same object.
 * Verified results always win; matches we have no verified score for are left
 * untouched (AI value kept).
 */
export function mergeVerifiedGroups<T extends Record<string, GroupSnapshot>>(groups: T): T {
  for (const [group, gs] of Object.entries(groups)) {
    if (!gs?.matches?.length) continue;
    let changed = false;
    for (const m of gs.matches) {
      const v = groupScoreMap.get(`${group}|${m.home}|${m.away}`);
      if (!v) continue;
      if (m.homeScore !== v.homeScore || m.awayScore !== v.awayScore) changed = true;
      m.homeScore = v.homeScore;
      m.awayScore = v.awayScore;
      m.status = "FT";
    }
    if (changed) {
      const teams = gs.standings?.length
        ? gs.standings.map((s) => s.team)
        : [...new Set(gs.matches.flatMap((m) => [m.home, m.away]))];
      gs.standings = computeStandings(teams, gs.matches);
    }
  }
  return groups;
}
