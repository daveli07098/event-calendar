import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act, screen, within } from "@testing-library/react";
import React from "react";
import { CalendarView } from "@/components/calendar/CalendarView";
import type { CalendarType } from "@/types";

/**
 * Regression test for: on mobile, FullCalendar's `initialView` is only read once
 * at construction, but `isMobile` isn't known until after mount (matchMedia needs
 * `window`). Phones used to construct into `dayGridMonth` and never escape it —
 * and the mobile `headerToolbar` shipped no view-switcher buttons to get out
 * manually. The fix drives the view imperatively via `getApi().changeView(...)`
 * in an effect keyed off a `lastBreakpointRef`, plus a mobile `footerToolbar`
 * view-switcher.
 *
 * Rendering real FullCalendar in jsdom is impractical (it manipulates the DOM
 * directly and isn't designed for a jsdom harness), so `@fullcalendar/react` is
 * mocked here to capture the props CalendarView passes it (`initialView`,
 * `headerToolbar`, `footerToolbar`) and to expose a fake `getApi()` whose
 * `changeView` is a spy — which is exactly the seam the fix operates through.
 */

// --- Fake FullCalendar API surface, shared across renders like the real ref would be ---
const changeViewSpy = vi.fn();
const fakeCalendarApi = {
  changeView: changeViewSpy,
  gotoDate: vi.fn(),
};

// --- Capture props CalendarView passed to <FullCalendar> ---
// `firstFCProps` snapshots the FIRST render only, mirroring the real FullCalendar
// class component, which reads `initialView` once at construction and ignores it
// on every subsequent prop update. `latestFCProps` tracks the most recent render,
// for asserting props (like footerToolbar) that DO stay reactive.
let firstFCProps: Record<string, unknown> | null = null;
let latestFCProps: Record<string, unknown> | null = null;

vi.mock("@fullcalendar/react", () => {
  const FakeFullCalendar = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      if (firstFCProps === null) firstFCProps = props;
      latestFCProps = props;
      React.useImperativeHandle(ref, () => ({
        getApi: () => fakeCalendarApi,
      }));
      return React.createElement("div", { "data-testid": "fullcalendar-mock" });
    },
  );
  FakeFullCalendar.displayName = "FakeFullCalendar";
  return { default: FakeFullCalendar };
});

// Real plugin packages are inert data objects at import time — safe to leave unmocked.

// --- Isolate the breakpoint logic from unrelated CalendarView dependencies ---
vi.mock("@/components/calendar/EventReminder", () => ({
  EventReminder: () => null,
}));
vi.mock("@/components/calendar/DayDetailPanel", () => ({
  DayDetailPanel: () => null,
}));
vi.mock("@/components/calendar/BookmarkPopover", () => ({
  BookmarkPopover: () => null,
}));
vi.mock("@/components/theme/ThemeSwitcher", () => ({
  ThemeSwitcher: () => null,
}));
vi.mock("@/components/events/EventModal", () => ({
  EventModal: () => null,
}));

const calendars: CalendarType[] = [
  {
    id: "cal-1",
    userId: "user-1",
    name: "My Calendar",
    color: "#4285f4",
    isDefault: true,
    isVisible: true,
    googleCalendarId: null,
    shareToken: null,
    shareMode: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
];

/** A minimal, configurable `window.matchMedia` stub with change-event support. */
function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: initialMatches,
    media: "(max-width: 767px)",
    addEventListener: (event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === "change") listeners.add(cb);
    },
    removeEventListener: (event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === "change") listeners.delete(cb);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    /** Simulate the breakpoint being crossed (fires a `change` event). */
    fire(matches: boolean) {
      mql.matches = matches;
      const event = { matches } as MediaQueryListEvent;
      listeners.forEach((cb) => cb(event));
    },
  };
}

vi.mock("@/components/agenda/UpcomingAgenda", () => ({
  UpcomingAgenda: () => React.createElement("div", { "data-testid": "agenda-mock" }),
}));

describe("CalendarView — mobile layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, "", "/calendar");
    firstFCProps = null;
    latestFCProps = null;
  });

  it("no longer forces listWeek/dayGridMonth on breakpoint changes", async () => {
    const mm = stubMatchMedia(true);
    localStorage.setItem("calendar.view", "dayGridMonth");
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} />);
    });
    expect(firstFCProps?.initialView).toBe("dayGridMonth");
    await act(async () => { mm.fire(false); });
    expect(changeViewSpy).not.toHaveBeenCalled();
  });

  it("shows one five-tab view switcher on mobile, with no FC footer toolbar", async () => {
    stubMatchMedia(true);
    localStorage.setItem("calendar.view", "listWeek");
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} />);
    });
    expect(latestFCProps?.footerToolbar).toBeUndefined();
    const group = screen.getByRole("group", { name: "Calendar view" });
    const tabs = within(group).getAllByRole("button").map((t) => t.textContent);
    expect(tabs).toEqual(["Upcoming", "Month", "Week", "Day", "List"]);
  });

  it("offers search next to the menu in the mobile Upcoming view", async () => {
    stubMatchMedia(true);
    const onSearchOpen = vi.fn();
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} onSearchOpen={onSearchOpen} />);
    });
    expect(screen.getByTestId("agenda-mock")).toBeInTheDocument();
    screen.getByRole("button", { name: "Search events" }).click();
    expect(onSearchOpen).toHaveBeenCalled();
  });

  it("shows the same switcher on desktop and keeps view buttons out of the FC header", async () => {
    stubMatchMedia(false);
    localStorage.setItem("calendar.view", "dayGridMonth");
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} />);
    });
    expect(latestFCProps?.footerToolbar).toBeUndefined();
    expect((latestFCProps?.headerToolbar as { right: string }).right).toBe("");
    const group = screen.getByRole("group", { name: "Calendar view" });
    const tabs = within(group).getAllByRole("button").map((t) => t.textContent);
    expect(tabs).toEqual(["Upcoming", "Month", "Week", "Day", "List"]);
  });
});
