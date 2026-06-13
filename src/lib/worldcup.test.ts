import { describe, it, expect } from "vitest";
import type { EventType } from "@/types";
import {
  isWorldCupEvent,
  parseGroupMatch,
  parseKnockoutMatch,
  buildGroups,
  buildBracket,
  computeStandings,
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
