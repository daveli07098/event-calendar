import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import { CalendarView } from "@/components/calendar/CalendarView";
import type { CalendarType, EventType } from "@/types";

let latestFCProps: Record<string, unknown> | null = null;
const gotoDate = vi.fn();

vi.mock("@fullcalendar/react", () => {
  const FakeFullCalendar = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    latestFCProps = props;
    React.useImperativeHandle(ref, () => ({ getApi: () => ({ changeView: vi.fn(), gotoDate }) }));
    return React.createElement("div", { "data-testid": "fullcalendar-mock" });
  });
  FakeFullCalendar.displayName = "FakeFullCalendar";
  return { default: FakeFullCalendar };
});
vi.mock("@/components/agenda/UpcomingAgenda", () => ({
  UpcomingAgenda: ({ events }: { events: unknown[] }) =>
    React.createElement("div", { "data-testid": "agenda-mock" }, String(events.length)),
}));
vi.mock("@/components/calendar/EventReminder", () => ({ EventReminder: () => null }));
vi.mock("@/components/calendar/DayDetailPanel", () => ({ DayDetailPanel: () => null }));
vi.mock("@/components/calendar/BookmarkPopover", () => ({ BookmarkPopover: () => null }));
vi.mock("@/components/theme/ThemeSwitcher", () => ({ ThemeSwitcher: () => null }));
vi.mock("@/components/events/EventModal", () => ({
  EventModal: ({ open, event }: { open: boolean; event: EventType | null }) =>
    open ? React.createElement("div", { "data-testid": "event-modal" }, event?.id) : null,
}));

const calendars: CalendarType[] = [
  {
    id: "cal-1", userId: "u", name: "My Calendar", color: "#4285f4", isDefault: true, isVisible: true,
    googleCalendarId: null, shareToken: null, shareMode: null,
    createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  },
];

function ev(id: string, start: string, end: string): EventType {
  return {
    id, title: id, description: null, location: null, startTime: start, endTime: end, allDay: false,
    calendarId: "cal-1", category: null, calendar: calendars[0],
  } as unknown as EventType;
}

const agendaEvent = {
  id: "a1", title: "Concert", start: "2026-10-27T12:00:00.000Z", end: "2026-10-27T14:00:00.000Z",
  allDay: false, calendarId: "cal-1", calendarName: "My Calendar", color: "#4285f4", isSale: false,
};

/** Simulate FullCalendar's datesSet callback for a local-date range. */
async function fireDatesSet(type: string, start: string, end: string, currentStart = start) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const datesSet = latestFCProps?.datesSet as (arg: unknown) => Promise<void>;
  await datesSet({
    start: s, end: e, startStr: s.toISOString(), endStr: e.toISOString(),
    view: { type, currentStart: new Date(`${currentStart}T00:00:00`) },
  });
}

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

describe("CalendarView — Upcoming default and view persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestFCProps = null;
    localStorage.clear();
    window.history.replaceState(null, "", "/calendar");
    stubMatchMedia(false);
  });

  it("renders the agenda (no FullCalendar) by default, on desktop and mobile", async () => {
    for (const mobile of [false, true]) {
      stubMatchMedia(mobile);
      const { unmount } = render(
        <CalendarView initialEvents={[]} initialAgendaEvents={[agendaEvent]} calendars={calendars} />,
      );
      await act(async () => {});
      expect(screen.getByTestId("agenda-mock").textContent).toBe("1");
      expect(screen.queryByTestId("fullcalendar-mock")).toBeNull();
      unmount();
    }
  });

  it("respects a stored view", async () => {
    localStorage.setItem("calendar.view", "timeGridWeek");
    await act(async () => { render(<CalendarView initialEvents={[]} calendars={calendars} />); });
    expect(screen.queryByTestId("agenda-mock")).toBeNull();
    expect(latestFCProps?.initialView).toBe("timeGridWeek");
  });

  it("switches from the Upcoming tab to Month and persists it", async () => {
    await act(async () => { render(<CalendarView initialEvents={[]} calendars={calendars} />); });
    const group = screen.getByRole("group", { name: "Calendar view" });
    expect(within(group).getByRole("button", { name: "Upcoming" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Month" }));
    expect(latestFCProps?.initialView).toBe("dayGridMonth");
    expect(localStorage.getItem("calendar.view")).toBe("dayGridMonth");
    expect(within(group).getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
  });

  it("deep link ?date= starts in a calendar view on that date", async () => {
    window.history.replaceState(null, "", "/calendar?event=e1&date=2026-12-24");
    await act(async () => { render(<CalendarView initialEvents={[]} calendars={calendars} />); });
    expect(screen.queryByTestId("agenda-mock")).toBeNull();
    expect(latestFCProps?.initialView).toBe("dayGridMonth");
    expect(latestFCProps?.initialDate).toBe("2026-12-24");
  });

  it("deep link date is used once: cleared after datesSet, forced view not persisted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    window.history.replaceState(null, "", "/calendar?date=2026-12-01");
    const onVisibleDateChange = vi.fn();
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} onVisibleDateChange={onVisibleDateChange} />);
    });
    expect(latestFCProps?.initialDate).toBe("2026-12-01");
    await act(async () => { await fireDatesSet("dayGridMonth", "2026-11-29", "2027-01-10", "2026-12-01"); });
    expect(latestFCProps?.initialDate).toBeUndefined();
    expect(localStorage.getItem("calendar.view")).toBeNull();
    expect(onVisibleDateChange).toHaveBeenCalledWith(new Date("2026-12-01T00:00:00"));
    vi.unstubAllGlobals();
  });

  it("deep link opens the event modal", async () => {
    window.history.replaceState(null, "", "/calendar?event=e1&date=2026-12-24");
    const e1 = ev("e1", "2026-12-24T10:00:00.000Z", "2026-12-24T11:00:00.000Z");
    await act(async () => {
      render(<CalendarView initialEvents={[e1]} calendars={calendars} openEventId="e1" />);
    });
    expect(screen.getByTestId("event-modal").textContent).toBe("e1");
  });
});

describe("CalendarView — agenda refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestFCProps = null;
    localStorage.clear();
    window.history.replaceState(null, "", "/calendar");
    stubMatchMedia(false);
  });

  it("refetches when the tab becomes visible and ignores out-of-order responses", async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    const fetchMock = vi.fn(() => new Promise((r) => resolvers.push(r)));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      render(<CalendarView initialEvents={[]} initialAgendaEvents={[agendaEvent]} calendars={calendars} />);
    });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const reply = (events: EventType[]) => ({ ok: true, json: async () => events });
    const e = (id: string) => ev(id, "2026-10-27T10:00:00.000Z", "2026-10-27T11:00:00.000Z");
    // Newer request answers first (3 events), then the stale one (1 event) lands
    await act(async () => { resolvers[1](reply([e("a"), e("b"), e("c")])); });
    await act(async () => { resolvers[0](reply([e("z")])); });
    expect(screen.getByTestId("agenda-mock").textContent).toBe("3");
    vi.unstubAllGlobals();
  });
});

describe("CalendarView — list view collapses multi-day events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestFCProps = null;
    localStorage.clear();
    window.history.replaceState(null, "", "/calendar");
    stubMatchMedia(false);
    localStorage.setItem("calendar.view", "listWeek");
  });

  it("shows a multi-day event once, on the first visible day, with its end date", async () => {
    const run = ev("run", "2026-10-20T10:00:00", "2026-11-05T18:00:00");
    const short = ev("short", "2026-10-27T10:00:00", "2026-10-27T12:00:00");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [run, short] }));
    await act(async () => {
      render(<CalendarView initialEvents={[run, short]} calendars={calendars} />);
    });
    await act(async () => { await fireDatesSet("listWeek", "2026-10-25", "2026-11-01"); });
    const fc = latestFCProps?.events as { id: string; start: string; end: string; allDay: boolean; extendedProps: { untilDate?: string } }[];
    const byId = Object.fromEntries(fc.map((e) => [e.id, e]));
    expect(byId.run).toMatchObject({ start: "2026-10-25", end: "2026-10-26", allDay: true });
    expect(byId.run.extendedProps.untilDate).toBe("2026-11-05");
    expect(byId.short.start).toBe("2026-10-27T10:00:00");
    expect(byId.short.extendedProps.untilDate).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe("CalendarView — long event styling and ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestFCProps = null;
    localStorage.clear();
    window.history.replaceState(null, "", "/calendar");
    stubMatchMedia(false);
    localStorage.setItem("calendar.view", "dayGridMonth");
  });

  it("flags >=3 day events as long, ranks them after short ones, and adds the class", async () => {
    const short = ev("short", "2026-11-03T10:00:00.000Z", "2026-11-03T12:00:00.000Z");
    const long = ev("long", "2026-11-01T00:00:00.000Z", "2026-11-10T00:00:00.000Z");
    await act(async () => {
      render(<CalendarView initialEvents={[short, long]} calendars={calendars} />);
    });
    const fc = latestFCProps?.events as { id: string; extendedProps: { isLong: boolean; rank: number } }[];
    const byId = Object.fromEntries(fc.map((e) => [e.id, e.extendedProps]));
    expect(byId.short).toMatchObject({ isLong: false, rank: 0 });
    expect(byId.long).toMatchObject({ isLong: true, rank: 1 });
    expect(latestFCProps?.eventOrder).toBe("rank,start,-duration,allDay,title");
    const classNames = latestFCProps?.eventClassNames as (a: unknown) => string[];
    const mk = (isLong: boolean) => ({ event: { allDay: true, id: "x", extendedProps: { isLong } }, view: { type: "dayGridMonth" } });
    expect(classNames(mk(true))).toContain("fc-event-long");
    expect(classNames(mk(false))).not.toContain("fc-event-long");
  });
});
