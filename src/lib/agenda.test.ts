import { describe, it, expect } from "vitest";
import { groupAgenda, isLongEvent, dayKey, type AgendaEvent } from "./agenda";

const TZ = "Asia/Hong_Kong";
// 2026-10-26 10:00 HK
const NOW = new Date("2026-10-26T02:00:00Z");

function ev(id: string, start: string, end: string, o: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id, title: id, start, end, allDay: false, calendarId: "c", calendarName: "Cal",
    color: "#123456", isSale: false, ...o,
  };
}
const ids = (l: AgendaEvent[]) => l.map((e) => e.id);

describe("dayKey / isLongEvent", () => {
  it("buckets in the given tz", () => {
    expect(dayKey(new Date("2026-10-25T16:30:00Z"), TZ)).toBe("2026-10-26");
    expect(dayKey(new Date("2026-10-25T16:30:00Z"), "UTC")).toBe("2026-10-25");
  });
  it("treats all-day end as exclusive", () => {
    const two = ev("a", "2026-10-26T00:00:00+08:00", "2026-10-28T00:00:00+08:00", { allDay: true });
    const three = ev("b", "2026-10-26T00:00:00+08:00", "2026-10-29T00:00:00+08:00", { allDay: true });
    expect(isLongEvent(two, TZ)).toBe(false);
    expect(isLongEvent(three, TZ)).toBe(true);
  });
  it("counts days by tz, not UTC", () => {
    // 23:00 HK Oct 26 -> 01:00 HK Oct 28 spans 3 HK days
    expect(isLongEvent(ev("x", "2026-10-26T23:00:00+08:00", "2026-10-28T01:00:00+08:00"), TZ)).toBe(true);
    expect(isLongEvent(ev("y", "2026-10-26T23:00:00+08:00", "2026-10-28T00:00:00+08:00"), TZ)).toBe(false);
  });
});

describe("groupAgenda", () => {
  it("drops timed events that already ended today, keeps running ones", () => {
    const g = groupAgenda([
      ev("past", "2026-10-26T07:00:00+08:00", "2026-10-26T09:00:00+08:00"),
      ev("running", "2026-10-26T09:00:00+08:00", "2026-10-26T12:00:00+08:00"),
    ], NOW, TZ);
    expect(ids(g.today)).toEqual(["running"]);
  });

  it("uses tz midnight boundary for today/tomorrow", () => {
    const g = groupAgenda([
      ev("late", "2026-10-26T23:30:00+08:00", "2026-10-26T23:45:00+08:00"),
      ev("early", "2026-10-27T00:15:00+08:00", "2026-10-27T01:00:00+08:00"),
    ], NOW, TZ);
    expect(ids(g.today)).toEqual(["late"]);
    expect(ids(g.tomorrow)).toEqual(["early"]);
  });

  it("orders timed, then all-day, then long within a day", () => {
    const g = groupAgenda([
      ev("long", "2026-10-26T00:00:00+08:00", "2026-10-31T00:00:00+08:00", { allDay: true }),
      ev("allday", "2026-10-26T00:00:00+08:00", "2026-10-27T00:00:00+08:00", { allDay: true }),
      ev("t2", "2026-10-26T20:00:00+08:00", "2026-10-26T21:00:00+08:00"),
      ev("t1", "2026-10-26T14:00:00+08:00", "2026-10-26T15:00:00+08:00"),
    ], NOW, TZ);
    expect(ids(g.today)).toEqual(["t1", "t2", "allday", "long"]);
    expect(g.ongoing).toEqual([]);
  });

  it("repeats short multi-day events on each day they overlap", () => {
    const g = groupAgenda([
      ev("fest", "2026-10-27T00:00:00+08:00", "2026-10-29T00:00:00+08:00", { allDay: true }),
    ], NOW, TZ);
    expect(ids(g.tomorrow)).toEqual(["fest"]);
    expect(g.upcoming.map((d) => d.date)).toEqual(["2026-10-28"]);
  });

  it("puts started long events in ongoing (soonest end first), not in day lists", () => {
    const g = groupAgenda([
      ev("later", "2026-10-20T00:00:00+08:00", "2026-11-10T00:00:00+08:00", { allDay: true }),
      ev("sooner", "2026-10-22T00:00:00+08:00", "2026-11-01T00:00:00+08:00", { allDay: true }),
      ev("over", "2026-10-01T00:00:00+08:00", "2026-10-20T00:00:00+08:00", { allDay: true }),
    ], NOW, TZ);
    expect(ids(g.ongoing)).toEqual(["sooner", "later"]);
    expect(g.today).toEqual([]);
    expect(g.tomorrow).toEqual([]);
    expect(g.upcoming).toEqual([]);
  });

  it("shows future long events only on their start day", () => {
    const g = groupAgenda([
      ev("expo", "2026-10-30T00:00:00+08:00", "2026-11-20T00:00:00+08:00", { allDay: true }),
    ], NOW, TZ);
    expect(g.upcoming).toHaveLength(1);
    expect(g.upcoming[0].date).toBe("2026-10-30");
    expect(g.ongoing).toEqual([]);
  });

  it("respects the days window and skips empty days", () => {
    const evs = [
      ev("in", "2026-10-28T10:00:00+08:00", "2026-10-28T11:00:00+08:00"),
      ev("out", "2026-11-05T10:00:00+08:00", "2026-11-05T11:00:00+08:00"),
    ];
    expect(groupAgenda(evs, NOW, TZ, 14).upcoming.map((d) => d.date)).toEqual(["2026-10-28", "2026-11-05"]);
    expect(groupAgenda(evs, NOW, TZ, 5).upcoming.map((d) => d.date)).toEqual(["2026-10-28"]);
  });

  it("collects sales within window and keeps them out of day lists", () => {
    const sale = (id: string, start: string) =>
      ev(id, start, new Date(new Date(start).getTime() + 3_600_000).toISOString(), { isSale: true });
    const g = groupAgenda([
      sale("soon", "2026-10-26T12:00:00+08:00"),
      sale("justStarted", "2026-10-26T09:30:00+08:00"),
      sale("old", "2026-10-26T08:00:00+08:00"),
      sale("d6", "2026-11-01T10:00:00+08:00"),
      sale("d8", "2026-11-03T10:00:00+08:00"),
    ], NOW, TZ);
    expect(ids(g.sales)).toEqual(["justStarted", "soon", "d6"]);
    expect(g.today).toEqual([]);
    expect(g.upcoming).toEqual([]);
  });
});
