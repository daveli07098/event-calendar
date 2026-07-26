import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EventReminder } from "@/components/calendar/EventReminder";
import {
  setReminderLeadMinutes,
  DEFAULT_REMINDER_LEAD_MINUTES,
} from "@/lib/reminder-prefs";
import { hasFired, markFired } from "@/lib/reminder-fired-store";
import type { CalendarType, EventType } from "@/types";

const calendar: CalendarType = {
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
};

function buildEvent(overrides: Partial<EventType> = {}): EventType {
  return {
    id: "evt-1",
    calendarId: "cal-1",
    title: "Team Standup",
    description: null,
    location: null,
    startTime: "2025-06-15T10:00:00.000Z",
    endTime: "2025-06-15T10:30:00.000Z",
    allDay: false,
    recurrenceRule: null,
    googleEventId: null,
    category: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const NOW = new Date("2025-06-15T09:55:00.000Z"); // 5 minutes before evt-1 starts

describe("EventReminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    setReminderLeadMinutes(DEFAULT_REMINDER_LEAD_MINUTES); // reset to the default between tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a reminder once for an event inside the lead window", () => {
    const event = buildEvent(); // starts in 5 min, default lead is 10 min
    render(<EventReminder events={[event]} calendars={[calendar]} />);

    expect(screen.getByText("Team Standup")).toBeInTheDocument();
    expect(screen.getByText("In 5 min")).toBeInTheDocument();
    expect(hasFired("evt-1:soon")).toBe(true);
  });

  it("does not fire again after a simulated reload (fired-set persisted in localStorage)", () => {
    const event = buildEvent();
    const { unmount } = render(<EventReminder events={[event]} calendars={[calendar]} />);
    expect(screen.getByText("Team Standup")).toBeInTheDocument();
    unmount();

    // Simulate a full page reload: fresh component instance, same localStorage.
    render(<EventReminder events={[event]} calendars={[calendar]} />);
    expect(screen.queryByText("Team Standup")).not.toBeInTheDocument();
  });

  it("respects a custom lead time when deciding which events qualify", () => {
    // 20 minutes out: doesn't qualify at the default 10-minute lead...
    const event = buildEvent({
      id: "evt-2",
      startTime: "2025-06-15T10:15:00.000Z", // 20 min after NOW
      endTime: "2025-06-15T10:45:00.000Z",
    });
    const { unmount } = render(<EventReminder events={[event]} calendars={[calendar]} />);
    expect(screen.queryByText("Team Standup")).not.toBeInTheDocument();
    expect(hasFired("evt-2:soon")).toBe(false);
    unmount();

    // ...but does once the lead time is widened to 30 minutes.
    setReminderLeadMinutes(30);
    render(<EventReminder events={[event]} calendars={[calendar]} />);
    expect(screen.getByText("Team Standup")).toBeInTheDocument();
    expect(screen.getByText("In 20 min")).toBeInTheDocument();
    expect(hasFired("evt-2:soon")).toBe(true);
  });

  it("prunes stale fired-entries (events long in the past) on write", () => {
    // Fire a reminder "now" — freshly written, so not stale yet.
    markFired("evt-stale:soon", NOW.getTime());
    expect(hasFired("evt-stale:soon")).toBe(true);

    // Move the clock forward >24h past that event's start; the entry is now
    // stale but (per spec) is only pruned on the *next write*, not eagerly.
    const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    vi.setSystemTime(later);
    expect(hasFired("evt-stale:soon")).toBe(true);

    // A new reminder firing triggers a write, which prunes the stale entry.
    const event = buildEvent({
      id: "evt-3",
      startTime: new Date(later.getTime() + 5 * 60 * 1000).toISOString(),
      endTime: new Date(later.getTime() + 35 * 60 * 1000).toISOString(),
    });
    render(<EventReminder events={[event]} calendars={[calendar]} />);

    expect(hasFired("evt-stale:soon")).toBe(false);
    expect(hasFired("evt-3:soon")).toBe(true);
  });

  it("advances the 'starting soon' -> 'starting now' transition without re-firing the soon key", () => {
    const event = buildEvent(); // starts in 5 min
    render(<EventReminder events={[event]} calendars={[calendar]} />);
    expect(screen.getByText("In 5 min")).toBeInTheDocument();

    // Jump to just after the event's start time; the 30s poll should fire the
    // distinct "now" key without re-firing "soon".
    act(() => {
      vi.setSystemTime(new Date("2025-06-15T10:00:10.000Z"));
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("Starting now")).toBeInTheDocument();
    expect(hasFired("evt-1:soon")).toBe(true);
    expect(hasFired("evt-1:now")).toBe(true);
  });
});

// Cross-tab coordination (BroadcastChannel) note: jsdom/vitest runs both
// "tabs" in the same Node process and event loop, so a same-process
// BroadcastChannel round trip cannot exercise the real-world race this
// coordination guards against (two independent browser processes reading
// localStorage before either has written). A test that mounts two
// EventReminder instances and asserts no duplicate toast would pass
// trivially here regardless of whether the BroadcastChannel wiring is
// correct — the localStorage-backed `hasFired` check alone already prevents
// it in a single process. We rely on the reminder-fired-store module's own
// contract (announce on `markFired`, drop duplicates in `onFiredElsewhere`)
// plus manual verification for the actual cross-process behavior, rather
// than writing a test that would be vacuous.
