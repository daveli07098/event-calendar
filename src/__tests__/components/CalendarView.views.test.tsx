import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    expect(latestFCProps?.initialView).toBe("dayGridMonth");
    expect(localStorage.getItem("calendar.view")).toBe("dayGridMonth");
  });

  it("deep link ?date= starts in a calendar view on that date", async () => {
    window.history.replaceState(null, "", "/calendar?event=e1&date=2026-12-24");
    await act(async () => { render(<CalendarView initialEvents={[]} calendars={calendars} />); });
    expect(screen.queryByTestId("agenda-mock")).toBeNull();
    expect(latestFCProps?.initialView).toBe("dayGridMonth");
    expect(latestFCProps?.initialDate).toBe("2026-12-24");
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
    expect(byId.short).toMatchObject({ isLong: false, rank: 1 });
    expect(byId.long).toMatchObject({ isLong: true, rank: 2 });
    expect(String(latestFCProps?.eventOrder).startsWith("rank,")).toBe(true);
    const classNames = latestFCProps?.eventClassNames as (a: unknown) => string[];
    const mk = (isLong: boolean) => ({ event: { allDay: true, id: "x", extendedProps: { isLong } }, view: { type: "dayGridMonth" } });
    expect(classNames(mk(true))).toContain("fc-event-long");
    expect(classNames(mk(false))).not.toContain("fc-event-long");
  });
});
