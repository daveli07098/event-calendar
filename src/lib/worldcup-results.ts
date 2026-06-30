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
 * All transcribed from Wikipedia per-group articles and each table re-derived to
 * match the official standings (the AI snapshot had several wrong scorelines —
 * e.g. K's 剛果民主共和國 vs 烏茲別克 was 0-1, actually 3-1, which flips the
 * third-place qualifier from Uzbekistan to DR Congo).
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
    { home: "阿爾及利亞", away: "奧地利", homeScore: 3, awayScore: 3 },
    { home: "約旦", away: "阿根廷", homeScore: 1, awayScore: 3 },
  ],
  // ── Group K ──
  K: [
    { home: "葡萄牙", away: "剛果民主共和國", homeScore: 1, awayScore: 1 },
    { home: "烏茲別克", away: "哥倫比亞", homeScore: 1, awayScore: 3 },
    { home: "葡萄牙", away: "烏茲別克", homeScore: 5, awayScore: 0 },
    { home: "哥倫比亞", away: "剛果民主共和國", homeScore: 1, awayScore: 0 },
    { home: "哥倫比亞", away: "葡萄牙", homeScore: 0, awayScore: 0 },
    { home: "剛果民主共和國", away: "烏茲別克", homeScore: 3, awayScore: 1 },
  ],
  // ── Group L ──
  L: [
    { home: "英格蘭", away: "克羅地亞", homeScore: 4, awayScore: 2 },
    { home: "加納", away: "巴拿馬", homeScore: 1, awayScore: 0 },
    { home: "英格蘭", away: "加納", homeScore: 0, awayScore: 0 },
    { home: "巴拿馬", away: "克羅地亞", homeScore: 0, awayScore: 1 },
    { home: "巴拿馬", away: "英格蘭", homeScore: 0, awayScore: 2 },
    { home: "克羅地亞", away: "加納", homeScore: 2, awayScore: 1 },
  ],
  // A–I are populated from verified Wikipedia data (see source links above).
};

/**
 * Official Round-of-32 matchups, keyed by FIFA match number, per the Cantonese
 * Wikipedia bracket (zh-yue). The seed's per-match slot mapping (and the EN
 * article it was built from) used a different match numbering, which put the
 * wrong pairing under each number — so this overrides the dynamically-resolved
 * R32 teams for DISPLAY and for AI score lookups. `home` is the first/upper slot.
 * The R16→Final tree (winner-of-match-N feeders) was already correct.
 *
 * Source: https://zh-yue.wikipedia.org/wiki/2026年FIFA世界盃淘汰賽
 */
export interface VerifiedKnockoutTeams {
  matchId: number;
  home: string;
  away: string;
}
export const VERIFIED_KNOCKOUT_TEAMS: VerifiedKnockoutTeams[] = [
  { matchId: 73, home: "南非", away: "加拿大" },
  { matchId: 74, home: "巴西", away: "日本" },
  { matchId: 75, home: "德國", away: "巴拉圭" },
  { matchId: 76, home: "荷蘭", away: "摩洛哥" },
  { matchId: 77, home: "科特迪瓦", away: "挪威" },
  { matchId: 78, home: "法國", away: "瑞典" },
  { matchId: 79, home: "墨西哥", away: "厄瓜多" },
  { matchId: 80, home: "英格蘭", away: "剛果民主共和國" },
  { matchId: 81, home: "比利時", away: "塞內加爾" },
  { matchId: 82, home: "美國", away: "波赫" },
  { matchId: 83, home: "西班牙", away: "奧地利" },
  { matchId: 84, home: "葡萄牙", away: "克羅地亞" },
  { matchId: 85, home: "瑞士", away: "阿爾及利亞" },
  { matchId: 86, home: "澳洲", away: "埃及" },
  { matchId: 87, home: "阿根廷", away: "佛得角" },
  { matchId: 88, home: "哥倫比亞", away: "加納" },
];

/**
 * Verified Round-of-32 kickoff (UTC) + venue, keyed by FIFA match number. The
 * seed's times/venues were attached to the OLD match-number mapping, so they no
 * longer match the real matchup under each number — these correct them (applied
 * to the calendar events by scripts/apply-worldcup-knockout-teams.ts).
 *
 * Source: SI "Every Round of 32 Match" schedule (kickoffs in ET = EDT/UTC-4 in
 * late June/early July 2026; converted to UTC here).
 */
export interface VerifiedKnockoutSchedule {
  utcStart: string;
  venue: string;
}
export const VERIFIED_KNOCKOUT_SCHEDULE: Record<number, VerifiedKnockoutSchedule> = {
  73: { utcStart: "2026-06-28T19:00:00Z", venue: "SoFi Stadium, 英格爾伍德" },        // 南非 vs 加拿大 · 3pm ET
  74: { utcStart: "2026-06-29T17:00:00Z", venue: "NRG Stadium, 休斯頓" },             // 巴西 vs 日本 · 1pm ET
  75: { utcStart: "2026-06-29T20:30:00Z", venue: "Gillette Stadium, 福克斯伯勒" },    // 德國 vs 巴拉圭 · 4:30pm ET
  76: { utcStart: "2026-06-30T01:00:00Z", venue: "Estadio BBVA, 蒙特雷" },            // 荷蘭 vs 摩洛哥 · 9pm ET (29th)
  77: { utcStart: "2026-06-30T17:00:00Z", venue: "AT&T Stadium, 阿靈頓" },            // 科特迪瓦 vs 挪威 · 1pm ET
  78: { utcStart: "2026-06-30T21:00:00Z", venue: "MetLife Stadium, 東盧瑟福" },       // 法國 vs 瑞典 · 5pm ET
  79: { utcStart: "2026-07-01T01:00:00Z", venue: "Estadio Azteca, 墨西哥城" },        // 墨西哥 vs 厄瓜多 · 9pm ET (30th)
  80: { utcStart: "2026-07-01T16:00:00Z", venue: "Mercedes-Benz Stadium, 亞特蘭大" }, // 英格蘭 vs 剛果民主共和國 · 12pm ET
  81: { utcStart: "2026-07-01T20:00:00Z", venue: "Lumen Field, 西雅圖" },             // 比利時 vs 塞內加爾 · 4pm ET
  82: { utcStart: "2026-07-02T00:00:00Z", venue: "Levi's Stadium, 聖克拉拉" },        // 美國 vs 波赫 · 8pm ET (1st)
  83: { utcStart: "2026-07-02T19:00:00Z", venue: "SoFi Stadium, 英格爾伍德" },        // 西班牙 vs 奧地利 · 3pm ET
  84: { utcStart: "2026-07-02T23:00:00Z", venue: "BMO Field, 多倫多" },              // 葡萄牙 vs 克羅地亞 · 7pm ET
  85: { utcStart: "2026-07-03T03:00:00Z", venue: "BC Place, 溫哥華" },               // 瑞士 vs 阿爾及利亞 · 11pm ET (2nd)
  86: { utcStart: "2026-07-03T18:00:00Z", venue: "AT&T Stadium, 阿靈頓" },            // 澳洲 vs 埃及 · 2pm ET
  87: { utcStart: "2026-07-03T22:00:00Z", venue: "Hard Rock Stadium, 邁阿密花園" },   // 阿根廷 vs 佛得角 · 6pm ET
  88: { utcStart: "2026-07-04T01:30:00Z", venue: "Arrowhead Stadium, 堪薩斯城" },     // 哥倫比亞 vs 加納 · 9:30pm ET (3rd)
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
export const VERIFIED_KNOCKOUT_SCORES: VerifiedKnockoutScore[] = [
  // ── Round of 32 (played so far; home = first slot of VERIFIED_KNOCKOUT_TEAMS) ──
  { matchId: 73, homeScore: 0, awayScore: 1, status: "FT" }, // 南非 0–1 加拿大
  { matchId: 74, homeScore: 2, awayScore: 1, status: "FT" }, // 巴西 2–1 日本
  { matchId: 75, homeScore: 1, awayScore: 1, status: "4-3 pens", winner: "home" }, // 德國 1–1 巴拉圭 (德國 win on pens)
  { matchId: 76, homeScore: 1, awayScore: 1, status: "3-2 pens", winner: "home" }, // 荷蘭 1–1 摩洛哥 (荷蘭 win on pens)
];

// ── Lookup maps (built once) ───────────────────────────────────────────────
const groupScoreMap = new Map<string, VerifiedGroupScore>();
for (const [group, list] of Object.entries(VERIFIED_GROUP_SCORES)) {
  for (const s of list) groupScoreMap.set(`${group}|${s.home}|${s.away}`, s);
}
const knockoutScoreMap = new Map<number, VerifiedKnockoutScore>(
  VERIFIED_KNOCKOUT_SCORES.map((k) => [k.matchId, k]),
);
const knockoutTeamsMap = new Map<number, VerifiedKnockoutTeams>(
  VERIFIED_KNOCKOUT_TEAMS.map((k) => [k.matchId, k]),
);

/** Official resolved teams for a knockout match number, if known. */
export function getKnockoutTeams(matchId: number | null | undefined): VerifiedKnockoutTeams | undefined {
  if (matchId == null) return undefined;
  return knockoutTeamsMap.get(matchId);
}

/** Verified knockout scoreline for a FIFA match number, if known. */
export function getKnockoutScore(matchId: number | null | undefined): VerifiedKnockoutScore | undefined {
  if (matchId == null) return undefined;
  return knockoutScoreMap.get(matchId);
}

/** Winner of a knockout match ("home"/"away") from its score, or null. Accepts
 *  either a verified entry or an AI-snapshot entry (winner field optional). */
export function knockoutWinner(
  s: { homeScore: number | null; awayScore: number | null; winner?: "home" | "away" } | undefined | null,
): "home" | "away" | null {
  if (!s) return null;
  if (s.winner) return s.winner; // penalty decision
  if (s.homeScore == null || s.awayScore == null) return null;
  if (s.homeScore > s.awayScore) return "home";
  if (s.awayScore > s.homeScore) return "away";
  return null;
}

/** Minimal shape of a knockout score row that can be verified-overridden. */
export interface KnockoutScoreLike {
  matchId: number;
  homeScore: number | null;
  awayScore: number | null;
  status?: string | null;
  winner?: "home" | "away";
}

/**
 * Override AI/cache knockout scorelines with verified ones, keyed by FIFA match
 * number. Verified always wins; rows we have no verified score for are left as-is.
 * Mutates and returns the same array.
 */
export function mergeVerifiedKnockout<T extends KnockoutScoreLike>(list: T[]): T[] {
  for (const m of list) {
    const v = knockoutScoreMap.get(m.matchId);
    if (!v) continue;
    m.homeScore = v.homeScore;
    m.awayScore = v.awayScore;
    m.status = v.status ?? "FT";
    m.winner = v.winner; // penalty winner (or undefined)
  }
  return list;
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
