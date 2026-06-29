import { describe, it, expect } from "vitest";
import {
  mergeVerifiedGroups,
  getKnockoutScore,
  knockoutWinner,
  VERIFIED_GROUP_SCORES,
} from "./worldcup-results";
import { computeStandings, type MatchScore } from "./worldcup";

describe("mergeVerifiedGroups", () => {
  it("overrides wrong AI scorelines with verified ones and recomputes standings", () => {
    // Simulate an AI snapshot for Group J with a WRONG scoreline (阿根廷 lost).
    const matches: MatchScore[] = VERIFIED_GROUP_SCORES.J.map((v) => ({
      home: v.home,
      away: v.away,
      homeScore: v.homeScore,
      awayScore: v.awayScore,
      status: "FT",
    }));
    // Corrupt the first match: pretend AI recorded 阿根廷 0-3 阿爾及利亞.
    matches[0] = { ...matches[0], homeScore: 0, awayScore: 3 };
    const teams = [...new Set(matches.flatMap((m) => [m.home, m.away]))];

    const groups = { J: { matches, standings: computeStandings(teams, matches) } };
    // Before the merge the corrupted score is present.
    expect(groups.J.matches[0].homeScore).toBe(0);

    mergeVerifiedGroups(groups);

    // Verified value wins.
    expect(groups.J.matches[0].homeScore).toBe(3);
    expect(groups.J.matches[0].awayScore).toBe(0);
    // Standings recomputed: 阿根廷 win all three → 9 pts, top of the group.
    const top = groups.J.standings[0];
    expect(top.team).toBe("阿根廷");
    expect(top.pts).toBe(9);
  });

  it("leaves matches without a verified score untouched", () => {
    const matches: MatchScore[] = [
      { home: "X", away: "Y", homeScore: 1, awayScore: 1, status: "FT" },
    ];
    const groups = { Z: { matches, standings: computeStandings(["X", "Y"], matches) } };
    mergeVerifiedGroups(groups);
    expect(groups.Z.matches[0].homeScore).toBe(1);
    expect(groups.Z.matches[0].awayScore).toBe(1);
  });
});

describe("knockout helpers", () => {
  it("returns the winning side from a verified knockout score", () => {
    expect(knockoutWinner({ matchId: 1, homeScore: 2, awayScore: 1 })).toBe("home");
    expect(knockoutWinner({ matchId: 1, homeScore: 0, awayScore: 3 })).toBe("away");
    // Level after AET → decided by the explicit penalty winner.
    expect(knockoutWinner({ matchId: 1, homeScore: 1, awayScore: 1, winner: "away" })).toBe("away");
    // Level with no penalty winner → no winner.
    expect(knockoutWinner({ matchId: 1, homeScore: 1, awayScore: 1 })).toBeNull();
    expect(knockoutWinner(undefined)).toBeNull();
  });

  it("getKnockoutScore is null-safe for unknown / missing match ids", () => {
    expect(getKnockoutScore(null)).toBeUndefined();
    expect(getKnockoutScore(99999)).toBeUndefined();
  });
});
