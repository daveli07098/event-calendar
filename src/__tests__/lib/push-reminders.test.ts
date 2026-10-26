import { describe, expect, it } from "vitest";
import { buildPayload, dueReminders, type ReminderEvent } from "@/lib/push-reminders";

const MIN = 60_000;
const HOUR = 60 * MIN;
const base = new Date("2026-11-10T10:00:00Z");

function ev(over: Partial<ReminderEvent> = {}): ReminderEvent {
  return {
    id: "e1",
    title: "Concert",
    location: "AsiaWorld-Expo",
    startTime: base,
    endTime: new Date(base.getTime() + 3 * HOUR),
    allDay: false,
    calendarName: "event-reminders",
    ...over,
  };
}
const kinds = (events: ReminderEvent[], now: Date) => dueReminders(events, now).map((d) => d.kind);

describe("dueReminders", () => {
  it("fires sale kinds on the sale-ticket calendar", () => {
    const sale = ev({ calendarName: "sale-ticket" });
    expect(kinds([sale], new Date(base.getTime() - 24 * HOUR))).toEqual(["sale-1d"]);
    expect(kinds([sale], new Date(base.getTime() - HOUR))).toEqual(["sale-1h"]);
    expect(kinds([sale], new Date(base.getTime() - 15 * MIN))).toEqual(["sale-15m"]);
  });

  it("fires event kinds for other timed events", () => {
    expect(kinds([ev()], new Date(base.getTime() - 24 * HOUR))).toEqual(["event-1d"]);
    expect(kinds([ev()], new Date(base.getTime() - HOUR))).toEqual(["event-1h"]);
    expect(kinds([ev()], new Date(base.getTime() - 15 * MIN))).toEqual([]);
  });

  it("tolerates a late cron within 30 min but not beyond", () => {
    expect(kinds([ev()], new Date(base.getTime() - HOUR + 29 * MIN))).toEqual(["event-1h"]);
    expect(kinds([ev()], new Date(base.getTime() - HOUR + 31 * MIN))).toEqual([]);
  });

  it("does not fire before the fire time or after the event started", () => {
    expect(kinds([ev()], new Date(base.getTime() - HOUR - MIN))).toEqual([]);
    const sale = ev({ calendarName: "sale-ticket" });
    expect(kinds([sale], new Date(base.getTime() + MIN))).toEqual([]);
  });

  it("fires event-day for UTC-midnight all-day events (Google import / ICS storage)", () => {
    const allDay = ev({
      allDay: true,
      startTime: new Date("2026-11-10T00:00:00Z"),
      endTime: new Date("2026-11-11T00:00:00Z"),
    });
    expect(kinds([allDay], new Date("2026-11-10T01:05:00Z"))).toEqual(["event-day"]);
    expect(kinds([allDay], new Date("2026-11-09T01:05:00Z"))).toEqual([]);
  });

  it("fires event-day on a multi-day event's start day even though it started earlier that day", () => {
    const long = ev({ startTime: new Date("2026-11-09T16:00:00Z"), endTime: new Date("2026-11-14T16:00:00Z") });
    expect(kinds([long], new Date("2026-11-10T01:05:00Z"))).toEqual(["event-day"]);
  });

  it("fires event-day at 09:00 HKT for all-day and long events", () => {
    // 2026-11-10 09:00 HKT = 01:00 UTC
    const allDay = ev({
      allDay: true,
      startTime: new Date("2026-11-09T16:00:00Z"), // HKT midnight on the 10th
      endTime: new Date("2026-11-10T16:00:00Z"),
    });
    expect(kinds([allDay], new Date("2026-11-10T01:05:00Z"))).toEqual(["event-day"]);
    expect(kinds([allDay], new Date("2026-11-10T00:59:00Z"))).toEqual([]);
    expect(kinds([allDay], new Date("2026-11-10T01:31:00Z"))).toEqual([]);

    const long = ev({ startTime: new Date("2026-11-10T04:00:00Z"), endTime: new Date("2026-11-14T04:00:00Z") });
    expect(kinds([long], new Date("2026-11-10T01:00:00Z"))).toEqual(["event-day"]);
    // Only on the start day: later days never fire
    expect(kinds([long], new Date("2026-11-11T01:00:00Z"))).toEqual([]);
  });

  it("fires event-day even when the event started earlier that morning", () => {
    const long = ev({ startTime: new Date("2026-11-10T00:30:00Z"), endTime: new Date("2026-11-14T00:30:00Z") });
    expect(kinds([long], new Date("2026-11-10T01:00:00Z"))).toEqual(["event-day"]);
  });
});

describe("buildPayload", () => {
  it("builds title, body and deep link", () => {
    const p = buildPayload(ev({ calendarName: "sale-ticket" }), "sale-15m");
    expect(p.title).toBe("🎫 Sale opens in 15 min");
    expect(p.body).toBe("Concert · 18:00 HKT · AsiaWorld-Expo");
    expect(p.url).toBe("/calendar?date=2026-11-10&event=e1");
    expect(p.tag).toBe("e1:sale-15m");
  });
});
