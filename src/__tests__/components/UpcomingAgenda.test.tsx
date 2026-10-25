import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UpcomingAgenda } from "@/components/agenda/UpcomingAgenda";
import type { AgendaEvent } from "@/lib/agenda";

const TZ = "Asia/Hong_Kong";

function ev(id: string, start: string, end: string, o: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id, title: id, start, end, allDay: false, calendarId: "c", calendarName: "Cal",
    color: "#123456", isSale: false, ...o,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T02:00:00Z")); // 10:00 HK
});
afterEach(() => vi.useRealTimers());

describe("UpcomingAgenda", () => {
  it("shows the empty state for today", () => {
    render(<UpcomingAgenda events={[]} timeZone={TZ} />);
    expect(screen.getByText("Nothing today")).toBeTruthy();
  });

  it("renders today card with countdown chip and fires onEventClick", () => {
    const onClick = vi.fn();
    render(
      <UpcomingAgenda
        events={[ev("Gig", "2026-10-26T12:00:00+08:00", "2026-10-26T14:00:00+08:00", { location: "Hall" })]}
        timeZone={TZ}
        onEventClick={onClick}
      />,
    );
    expect(screen.getByText("in 2 h")).toBeTruthy();
    expect(screen.getByText(/Hall/)).toBeTruthy();
    fireEvent.click(screen.getByText("Gig"));
    expect(onClick).toHaveBeenCalledWith("Gig");
  });

  it("shows sales with urgent styling under an hour", () => {
    render(
      <UpcomingAgenda
        events={[
          ev("Soon", "2026-10-26T10:35:00+08:00", "2026-10-26T11:00:00+08:00", { isSale: true }),
          ev("Later", "2026-10-28T10:00:00+08:00", "2026-10-28T11:00:00+08:00", { isSale: true }),
        ]}
        timeZone={TZ}
      />,
    );
    const cards = screen.getAllByTestId("sale-card");
    expect(cards[0].getAttribute("data-urgent")).toBe("true");
    expect(cards[1].getAttribute("data-urgent")).toBe("false");
    expect(screen.getByText("opens in 35 min")).toBeTruthy();
    expect(screen.getByText("opens in 2 d")).toBeTruthy();
  });

  it("groups upcoming days under a header", () => {
    render(
      <UpcomingAgenda
        events={[ev("Later", "2026-10-29T19:00:00+08:00", "2026-10-29T21:00:00+08:00")]}
        timeZone={TZ}
      />,
    );
    expect(screen.getByText("Thu 29 Oct")).toBeTruthy();
  });

  it("collapses ongoing long events and expands on toggle", () => {
    render(
      <UpcomingAgenda
        events={[
          ev("Conan Expo", "2026-10-20T00:00:00+08:00", "2026-11-01T00:00:00+08:00", { allDay: true }),
          ev("Popup", "2026-10-22T00:00:00+08:00", "2026-11-20T00:00:00+08:00", { allDay: true }),
        ]}
        timeZone={TZ}
      />,
    );
    const row = screen.getByTestId("ongoing");
    expect(row.textContent).toContain("2 ongoing");
    expect(row.textContent).toContain("Conan Expo ends in 6 d");
    expect(screen.queryByText("Popup")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Popup")).toBeTruthy();
  });

  it("compact hides days beyond the narrower window", () => {
    const far = ev("Far", "2026-11-03T10:00:00+08:00", "2026-11-03T11:00:00+08:00");
    const { rerender } = render(<UpcomingAgenda events={[far]} timeZone={TZ} />);
    expect(screen.getByText("Far")).toBeTruthy();
    rerender(<UpcomingAgenda events={[far]} timeZone={TZ} compact />);
    expect(screen.queryByText("Far")).toBeNull();
  });

  it("recomputes every minute", () => {
    render(
      <UpcomingAgenda
        events={[ev("Gig", "2026-10-26T12:00:00+08:00", "2026-10-26T13:00:00+08:00")]}
        timeZone={TZ}
      />,
    );
    expect(screen.getByText("in 2 h")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(90 * 60_000); });
    expect(screen.getByText("in 30 min")).toBeTruthy();
  });
});
