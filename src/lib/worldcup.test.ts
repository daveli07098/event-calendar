import { describe, it, expect } from "vitest";
import type { EventType } from "@/types";
import {
  isWorldCupEvent,
  parseGroupMatch,
  parseKnockoutMatch,
  buildGroups,
  buildBracket,
  computeStandings,
  rankThirds,
  resolveKnockout,
  clinchedPositions,
  type TeamStanding,
  type KnockoutMatch,
} from "@/lib/worldcup";

// Minimal EventType factory — only the fields the parser reads matter.
function ev(partial: Partial<EventType> & { title: string }): EventType {
  return {
    id: partial.id ?? `evt-${Math.random().toString(36).slice(2)}`,
    calendarId: "cal-1",
    title: partial.title,
    description: partial.description ?? null,
    location: partial.location ?? null,
    startTime: partial.startTime ?? "2026-06-12T03:00:00.000Z",
    endTime: partial.endTime ?? "2026-06-12T05:00:00.000Z",
    allDay: false,
    recurrenceRule: null,
    googleEventId: null,
    category: "sports",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    calendar: partial.calendar,
  };
}

describe("parseGroupMatch", () => {
  it("parses a group fixture title", () => {
    const m = parseGroupMatch(ev({ title: "A組 墨西哥 vs 南非", location: "Estadio Azteca" }));
    expect(m).toMatchObject({ group: "A", home: "墨西哥", away: "南非", location: "Estadio Azteca" });
  });

  it("returns null for knockout titles", () => {
    expect(parseGroupMatch(ev({ title: "32強 | C組冠軍 vs F組亞軍" }))).toBeNull();
  });
});

describe("parseKnockoutMatch", () => {
  it("parses round, teams and match id from description", () => {
    const m = parseKnockoutMatch(
      ev({
        title: "16強 | M73勝者 vs M74勝者",
        description: "2026 FIFA 世界盃 | 16強\nM73勝者 vs M74勝者\nWorld Cup Match ID: 89",
      }),
    );
    expect(m).toMatchObject({ round: "R16", roundLabel: "16強", matchId: 89, home: "M73勝者", away: "M74勝者" });
  });

  it("maps 4強 and 準決賽 to the same semi-final round", () => {
    expect(parseKnockoutMatch(ev({ title: "4強 | A vs B" }))?.round).toBe("SF");
    expect(parseKnockoutMatch(ev({ title: "準決賽 | A vs B" }))?.round).toBe("SF");
  });

  it("returns null when there is no match id (still parses round/teams)", () => {
    const m = parseKnockoutMatch(ev({ title: "決賽 | A vs B" }));
    expect(m).toMatchObject({ round: "Final", matchId: null });
  });
});

describe("isWorldCupEvent", () => {
  it("matches by description marker, calendar name, and title shape", () => {
    expect(isWorldCupEvent(ev({ title: "x", description: "2026 FIFA 世界盃 | A組" }))).toBe(true);
    expect(
      isWorldCupEvent(
        ev({ title: "x", calendar: { name: "world cup" } as EventType["calendar"] }),
      ),
    ).toBe(true);
    expect(isWorldCupEvent(ev({ title: "B組 加拿大 vs 波赫" }))).toBe(true);
    expect(isWorldCupEvent(ev({ title: "Random concert" }))).toBe(false);
  });
});

describe("buildGroups", () => {
  it("groups fixtures and collects distinct teams", () => {
    const events = [
      ev({ title: "A組 墨西哥 vs 南非", startTime: "2026-06-12T03:00:00.000Z" }),
      ev({ title: "A組 加拿大 vs 美國", startTime: "2026-06-13T03:00:00.000Z" }),
      ev({ title: "B組 法國 vs 德國", startTime: "2026-06-12T03:00:00.000Z" }),
      ev({ title: "Random concert" }),
    ];
    const groups = buildGroups(events);
    expect(groups.map((g) => g.group)).toEqual(["A", "B"]);
    expect(groups[0].teams).toContain("墨西哥");
    expect(groups[0].teams).toContain("美國");
    expect(groups[0].matches).toHaveLength(2);
  });
});

describe("buildBracket", () => {
  it("orders rounds and splits each into left/right halves by matchId", () => {
    const mk = (round: string, id: number) =>
      ev({ title: `${round} | M vs N`, description: `x\nWorld Cup Match ID: ${id}` });
    const events = [
      mk("16強", 90), mk("16強", 89), mk("16強", 96), mk("16強", 95),
      ev({ title: "決賽 | A vs B", description: "x\nWorld Cup Match ID: 104" }),
      ev({ title: "32強 | A vs B", description: "x\nWorld Cup Match ID: 73" }),
    ];
    const bracket = buildBracket(events);
    expect(bracket.map((r) => r.round)).toEqual(["R32", "R16", "Final"]);

    const r16 = bracket.find((r) => r.round === "R16")!;
    // sorted by matchId: 89, 90 | 95, 96  → first half left, second half right
    expect(r16.matches.map((m) => m.matchId)).toEqual([89, 90, 95, 96]);
    expect(r16.matches.filter((m) => m.side === "left").map((m) => m.matchId)).toEqual([89, 90]);
    expect(r16.matches.filter((m) => m.side === "right").map((m) => m.matchId)).toEqual([95, 96]);

    // Final is centered
    expect(bracket.find((r) => r.round === "Final")!.matches[0].side).toBe("center");
  });
});

describe("computeStandings", () => {
  it("applies 3/1/0 points and orders by pts → gd → gf", () => {
    const teams = ["A", "B", "C", "D"];
    const scores = [
      { home: "A", away: "B", homeScore: 2, awayScore: 0 }, // A win
      { home: "C", away: "D", homeScore: 1, awayScore: 1 }, // draw
      { home: "A", away: "C", homeScore: 1, awayScore: 0 }, // A win
      { home: "B", away: "D", homeScore: 0, awayScore: 0 }, // draw, not yet played below
    ];
    const table = computeStandings(teams, scores);
    expect(table[0]).toMatchObject({ team: "A", pts: 6, w: 2, gf: 3, ga: 0, gd: 3, rank: 1 });
    const a = table.find((t) => t.team === "A")!;
    const c = table.find((t) => t.team === "C")!;
    expect(a.rank).toBe(1);
    expect(c.pts).toBe(1); // one draw
  });

  it("ignores matches with missing scores", () => {
    const table = computeStandings(["A", "B"], [{ home: "A", away: "B", homeScore: null, awayScore: 2 }]);
    expect(table.every((t) => t.p === 0 && t.pts === 0)).toBe(true);
  });
});

describe("computeStandings head-to-head tiebreak", () => {
  it("separates teams level on pts/GD/GF by their head-to-head result", () => {
    // Z and A both finish pts 6, GD +1, GF 2 — but Z beat A, so Z ranks above
    // A (alphabetical order would wrongly put A first).
    const teams = ["Z", "A", "C", "D"];
    const scores = [
      { home: "Z", away: "A", homeScore: 1, awayScore: 0 }, // Z beats A (h2h)
      { home: "Z", away: "C", homeScore: 1, awayScore: 0 },
      { home: "D", away: "Z", homeScore: 1, awayScore: 0 }, // Z loses to D
      { home: "A", away: "C", homeScore: 1, awayScore: 0 },
      { home: "A", away: "D", homeScore: 1, awayScore: 0 },
      { home: "C", away: "D", homeScore: 0, awayScore: 0 },
    ];
    const table = computeStandings(teams, scores);
    const z = table.find((t) => t.team === "Z")!;
    const a = table.find((t) => t.team === "A")!;
    expect(z.pts).toBe(a.pts);
    expect(z.gd).toBe(a.gd);
    expect(z.gf).toBe(a.gf);
    expect(table[0].team).toBe("Z"); // head-to-head winner ranked first
    expect(table[1].team).toBe("A");
  });
});

// Build a finished group standing (p=3) quickly.
function st(team: string, pts: number, gd: number, gf: number, rank: number): TeamStanding {
  return { team, p: 3, w: 0, d: 0, l: 0, gf, ga: gf - gd, gd, pts, rank };
}

describe("clinchedPositions", () => {
  // Group A after round 2 (the user's real scenario):
  //   Mexico 6 (beat S.Africa 2-0, beat Korea 1-0), Korea 3, Czechia 1, S.Africa 1.
  //   Remaining: Czechia v Mexico, S.Africa v Korea.
  const teams = ["墨西哥", "韓國", "捷克", "南非"];
  const fixtures = [
    { home: "墨西哥", away: "南非" },
    { home: "韓國", away: "捷克" },
    { home: "捷克", away: "南非" },
    { home: "墨西哥", away: "韓國" },
    { home: "捷克", away: "墨西哥" }, // remaining
    { home: "南非", away: "韓國" },   // remaining
  ];
  const scores = [
    { home: "墨西哥", away: "南非", homeScore: 2, awayScore: 0 },
    { home: "韓國", away: "捷克", homeScore: 2, awayScore: 1 },
    { home: "捷克", away: "南非", homeScore: 1, awayScore: 1 },
    { home: "墨西哥", away: "韓國", homeScore: 1, awayScore: 0 },
  ];

  it("clinches 1st for a leader who won the head-to-head against its only challenger", () => {
    const c = clinchedPositions(teams, fixtures, scores);
    // Korea can reach 6 pts but Mexico beat Korea → 2026 h2h precedes overall GD,
    // so Mexico is mathematically 1st even if it loses its last game.
    expect(c.first).toBe("墨西哥");
    expect(c.byTeam["墨西哥"]).toEqual({ best: 1, worst: 1 });
    // 2nd is NOT locked yet — Korea/Czechia/S.Africa can still rearrange.
    expect(c.second).toBeNull();
  });

  it("does not clinch 1st when the leader only drew the challenger (overall GD could decide)", () => {
    const drawScores = scores.map((s) =>
      s.home === "墨西哥" && s.away === "韓國" ? { ...s, homeScore: 1, awayScore: 1 } : s,
    );
    // Now Mexico 4, Korea 4 — tie possible and the h2h was a draw, so GD (which a
    // big remaining win can swing) would decide → not yet clinched.
    const c = clinchedPositions(teams, fixtures, drawScores);
    expect(c.first).toBeNull();
  });
});

describe("rankThirds", () => {
  it("orders third-placed teams by pts → GD → GF", () => {
    const perGroup = {
      A: [st("A1", 9, 5, 6, 1), st("A2", 6, 2, 4, 2), st("A3", 3, 0, 2, 3)],
      B: [st("B1", 9, 4, 5, 1), st("B2", 6, 1, 3, 2), st("B3", 4, 1, 3, 3)],
    };
    const thirds = rankThirds(perGroup);
    expect(thirds.map((t) => t.standing.team)).toEqual(["B3", "A3"]); // B3 has 4 pts > A3's 3
  });
});

describe("resolveKnockout", () => {
  const r32: KnockoutMatch[] = [
    { eventId: "e1", round: "R32", roundLabel: "32強", matchId: 73, home: "A組冠軍", away: "B組亞軍", kickoff: "2026-06-28T19:00:00Z", side: "left" },
    { eventId: "e2", round: "R32", roundLabel: "32強", matchId: 74, home: "最佳第三名(AB)", away: "M70勝者", kickoff: "2026-06-29T19:00:00Z", side: "left" },
  ];

  it("resolves group winner/runner-up and marks them confirmed when the group is complete", () => {
    const perGroup = {
      A: [st("Mexico", 9, 5, 6, 1), st("Korea", 6, 2, 4, 2), st("Czechia", 3, 0, 2, 3), st("South Africa", 0, -7, 1, 4)],
      B: [st("Canada", 7, 3, 5, 1), st("Qatar", 5, 1, 3, 2), st("Bosnia", 4, 0, 3, 3), st("Switzerland", 1, -4, 2, 4)],
    };
    const out = resolveKnockout(r32, perGroup);
    expect(out["e1"].home).toMatchObject({ team: "Mexico", confirmed: true }); // A組冠軍
    expect(out["e1"].away).toMatchObject({ team: "Qatar", confirmed: true });  // B組亞軍
    // best third among {A,B}: Bosnia (4) > Czechia (3); not all 12 groups present → provisional
    expect(out["e2"].home.team).toBe("Bosnia");
    expect(out["e2"].home.confirmed).toBe(false);
    expect(out["e2"].home.thirdGroups).toEqual(["A", "B", "C", "D", "F"]); // official slot for match 74
    expect(out["e2"].away.team).toBeNull(); // M70勝者 — not derivable
  });

  it("takes the candidate group-set from the official table even for a generic 最佳第三名 label", () => {
    const generic: KnockoutMatch[] = [
      { eventId: "g1", round: "R32", roundLabel: "32強", matchId: 74, home: "E組冠軍", away: "最佳第三名", kickoff: "2026-06-30T19:00:00Z", side: "left" },
    ];
    const perGroup = {
      A: [st("A1", 9, 5, 6, 1), st("A2", 6, 2, 4, 2), st("A3rd", 4, 1, 3, 3), st("A4", 0, -8, 1, 4)],
      B: [st("B1", 9, 4, 5, 1), st("B2", 6, 1, 3, 2), st("B3rd", 3, 0, 2, 3), st("B4", 1, -5, 2, 4)],
    };
    const out = resolveKnockout(generic, perGroup);
    // Match 74's third comes from A/B/C/D/F → among present groups, A3rd (4 pts) wins.
    expect(out["g1"].away.position).toBe(3);
    expect(out["g1"].away.thirdGroups).toEqual(["A", "B", "C", "D", "F"]);
    expect(out["g1"].away.team).toBe("A3rd");
  });
});
