import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
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

describe("CalendarView — mobile breakpoint view sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firstFCProps = null;
    latestFCProps = null;
  });

  it("switches to listWeek once matchMedia resolves mobile at mount", async () => {
    stubMatchMedia(true);
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} />);
    });

    // Bug: FullCalendar always constructs as dayGridMonth on first render because
    // isMobile starts false — this is unavoidable and not itself the bug. The real
    // FullCalendar reads `initialView` only at construction, so only the FIRST
    // render's value matters here.
    expect(firstFCProps?.initialView).toBe("dayGridMonth");
    // Fix: the post-mount effect must correct it imperatively once mobile resolves.
    expect(changeViewSpy).toHaveBeenCalledWith("listWeek");
  });

  it("stays on dayGridMonth when matchMedia resolves desktop at mount", async () => {
    stubMatchMedia(false);
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} />);
    });

    expect(firstFCProps?.initialView).toBe("dayGridMonth");
    // Guard: must not clobber the desktop default with a spurious changeView call.
    expect(changeViewSpy).not.toHaveBeenCalled();
  });

  it("re-syncs the view when the breakpoint is crossed after mount", async () => {
    const mm = stubMatchMedia(false);
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} />);
    });
    expect(changeViewSpy).not.toHaveBeenCalled();

    // Simulate rotating into / resizing down to a phone-width viewport.
    await act(async () => {
      mm.fire(true);
    });
    expect(changeViewSpy).toHaveBeenCalledWith("listWeek");

    changeViewSpy.mockClear();

    // Cross back the other way too.
    await act(async () => {
      mm.fire(false);
    });
    expect(changeViewSpy).toHaveBeenCalledWith("dayGridMonth");
  });

  it("does not reset a user's manually chosen view on a re-render that doesn't cross the breakpoint", async () => {
    stubMatchMedia(true);
    const { rerender } = render(
      <CalendarView initialEvents={[]} calendars={calendars} categoryFilter={null} />,
    );
    await act(async () => {});
    expect(changeViewSpy).toHaveBeenCalledWith("listWeek");
    changeViewSpy.mockClear();

    // User taps "Day" on the mobile footer toolbar — a real user action would
    // drive this same fake API, so simulate it directly on the spy's target.
    fakeCalendarApi.changeView("timeGridDay");

    // An unrelated prop change causes CalendarView to re-render without the
    // breakpoint changing (e.g. a filter toggled elsewhere in the app).
    await act(async () => {
      rerender(
        <CalendarView initialEvents={[]} calendars={calendars} categoryFilter={"concert"} />,
      );
    });

    // The mobile-sync effect is keyed off `isMobile`, which hasn't changed, so
    // it must not fire again and stomp the user's manual selection back to listWeek.
    expect(changeViewSpy).not.toHaveBeenCalledWith("listWeek");
  });

  it("gives mobile a footer view-switcher (listWeek, dayGridMonth, timeGridDay) since the header has no room for one", async () => {
    stubMatchMedia(true);
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} />);
    });

    expect(latestFCProps?.footerToolbar).toEqual({
      center: "listWeek,dayGridMonth,timeGridDay",
    });
  });

  it("gives desktop no footer toolbar", async () => {
    stubMatchMedia(false);
    await act(async () => {
      render(<CalendarView initialEvents={[]} calendars={calendars} />);
    });

    expect(latestFCProps?.footerToolbar).toBe(false);
  });
});
