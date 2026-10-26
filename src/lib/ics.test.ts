import { describe, expect, it } from "vitest";
import { buildCalendarFeed, esc, fold, safeUrl, type FeedEvent } from "./ics";

const base: FeedEvent = {
  id: "e1",
  title: "Concert",
  startTime: new Date("2026-11-10T12:00:00Z"),
  endTime: new Date("2026-11-10T14:00:00Z"),
  allDay: false,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
  calendarName: "main",
};
const now = new Date("2026-10-26T00:00:00Z");
const feed = (e: Partial<FeedEvent>) =>
  buildCalendarFeed({ name: "Me, Cal", events: [{ ...base, ...e }], now });

describe("ics helpers", () => {
  it("folds lines over 75 chars", () => {
    const out = fold("X".repeat(160)).split("\r\n");
    expect(out[0]).toHaveLength(75);
    expect(out[1].startsWith(" ")).toBe(true);
  });
  it("escapes text", () => {
    expect(esc("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(esc("x\r\ny")).toBe("x\\ny");
  });
  it("folds by UTF-8 octets without splitting surrogate pairs", () => {
    const orig = "SUMMARY:" + "演唱會🎤".repeat(40);
    const folded = fold(orig);
    const lines = folded.split("\r\n");
    const enc = new TextEncoder();
    for (const l of lines) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    expect(lines.length).toBeGreaterThan(1);
    expect(folded.replace(/\r\n /g, "")).toBe(orig);
  });
  it("safeUrl accepts only clean http(s) URLs", () => {
    expect(safeUrl("https://x.test/a?b=1")).toBe("https://x.test/a?b=1");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://x.test/\r\nEND:VEVENT")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
});

describe("buildCalendarFeed", () => {
  it("emits header, refresh hints, stable UID and DTSTAMP", () => {
    const out = feed({});
    expect(out).toContain("X-WR-CALNAME:Me\\, Cal");
    expect(out).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(out).toContain("X-PUBLISHED-TTL:PT1H");
    expect(out).toContain("UID:e1@event-calendar");
    expect(out).toContain("DTSTAMP:20261026T000000Z");
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("includes URL, location, description", () => {
    const out = feed({ referenceUrl: "https://x.test/a", location: "AWE", description: "hi" });
    expect(out).toContain("URL:https://x.test/a");
    expect(out).toContain("LOCATION:AWE");
    expect(out).toContain("DESCRIPTION:hi");
  });
  it("timed events get -P1D and -PT1H", () => {
    const out = feed({});
    expect(out).toContain("TRIGGER:-P1D");
    expect(out).toContain("TRIGGER:-PT1H");
    expect(out.match(/BEGIN:VALARM/g)).toHaveLength(2);
  });
  it("sale events get -P1D and -PT15M", () => {
    const out = feed({ calendarName: "sale-ticket" });
    expect(out).toContain("TRIGGER:-PT15M");
    expect(out).toContain("TRIGGER:-P1D");
    expect(out).toContain("🎫 Sale opens in 15 min: Concert");
    expect(out).toContain("ACTION:DISPLAY");
  });
  it("all-day events use absolute HKT alarms and exclusive DTEND", () => {
    const out = feed({
      allDay: true,
      startTime: new Date("2026-11-10T00:00:00Z"),
      endTime: new Date("2026-11-10T00:00:00Z"),
    });
    expect(out).toContain("DTSTART;VALUE=DATE:20261110");
    expect(out).toContain("DTEND;VALUE=DATE:20261111");
    expect(out).toContain("TRIGGER;VALUE=DATE-TIME:20261110T010000Z");
    expect(out).toContain("TRIGGER;VALUE=DATE-TIME:20261109T120000Z");
  });
  it("all-day multi-day events keep the stored exclusive end", () => {
    const out = feed({
      allDay: true,
      startTime: new Date("2026-11-10T00:00:00Z"),
      endTime: new Date("2026-11-13T00:00:00Z"),
    });
    expect(out).toContain("DTSTART;VALUE=DATE:20261110");
    expect(out).toContain("DTEND;VALUE=DATE:20261113");
  });
  it("drops injected referenceUrl", () => {
    const out = feed({ referenceUrl: "https://x.test/\r\nEND:VEVENT" });
    expect(out).not.toContain("URL:");
  });
  it("long timed events (>=3 days) use date-based alarms", () => {
    const out = feed({ endTime: new Date("2026-11-14T12:00:00Z") });
    expect(out).toContain("TRIGGER;VALUE=DATE-TIME:20261110T010000Z");
    expect(out).not.toContain("TRIGGER:-PT1H");
  });
});
