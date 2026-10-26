import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventModal } from "@/components/events/EventModal";
import type { CalendarType, EventType } from "@/types";

const cal = {
  id: "cal-1", userId: "u", name: "C", color: "#4285f4", isDefault: true, isVisible: true,
  googleCalendarId: null, shareToken: null, shareMode: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
} as CalendarType;

const allDayEvent = (start: string, end: string): EventType => ({
  id: "e1", calendarId: "cal-1", title: "Expo", description: null, location: null,
  startTime: start, endTime: end, allDay: true, recurrenceRule: null, googleEventId: null, category: null,
  createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", calendar: cal,
} as EventType);

describe("EventModal all-day end (stored exclusive, shown inclusive)", () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => vi.clearAllMocks());

  const roundTrip = async (start: string, end: string) => {
    const user = userEvent.setup();
    render(
      <EventModal open onOpenChange={vi.fn()} calendars={[cal]} defaultCalendarId="cal-1"
        onSave={onSave} onDelete={vi.fn()} event={allDayEvent(start, end)} initialRange={null} />
    );
    await waitFor(() => expect(screen.getByDisplayValue("Expo")).toBeInTheDocument());
    const dates = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    await user.click(screen.getByRole("button", { name: /save|update/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    return { dates: dates.map((d) => d.value), saved: onSave.mock.calls[0][0] };
  };

  it("10-day event: End shows last day (Nov 1) and saves the same exclusive end", async () => {
    const { dates, saved } = await roundTrip("2026-10-24T00:00:00.000Z", "2026-11-02T00:00:00.000Z");
    expect(dates).toEqual(["2026-10-24", "2026-11-01"]);
    expect(saved.endTime).toBe("2026-11-02T00:00:00.000Z");
  });

  it("1-day event (exclusive end = start + 1): End shows start day, saves unchanged", async () => {
    const { dates, saved } = await roundTrip("2026-10-29T00:00:00.000Z", "2026-10-30T00:00:00.000Z");
    expect(dates).toEqual(["2026-10-29", "2026-10-29"]);
    expect(saved.endTime).toBe("2026-10-30T00:00:00.000Z");
  });

  it("legacy end == start row shows 1 day and is normalised to start + 1 on save", async () => {
    const { dates, saved } = await roundTrip("2026-10-29T00:00:00.000Z", "2026-10-29T00:00:00.000Z");
    expect(dates).toEqual(["2026-10-29", "2026-10-29"]);
    expect(saved.endTime).toBe("2026-10-30T00:00:00.000Z");
  });
});
