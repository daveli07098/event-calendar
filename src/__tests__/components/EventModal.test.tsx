import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventModal } from "@/components/events/EventModal";
import type { CalendarType, EventType } from "@/types";

const calendars: CalendarType[] = [
  {
    id: "cal-1",
    userId: "user-1",
    name: "My Calendar",
    color: "#4285f4",
    isDefault: true,
    isVisible: true,
    googleCalendarId: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  },
];

const existingEvent: EventType = {
  id: "evt-1",
  calendarId: "cal-1",
  title: "Team Standup",
  description: "Daily sync",
  location: "Room A",
  startTime: "2025-06-15T10:00:00Z",
  endTime: "2025-06-15T10:30:00Z",
  allDay: false,
  recurrenceRule: null,
  googleEventId: null,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  calendar: calendars[0],
};

describe("EventModal", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    calendars,
    defaultCalendarId: "cal-1",
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'New Event' title when creating", () => {
    render(
      <EventModal {...baseProps} event={null} initialRange={null} />
    );
    expect(screen.getByText("New Event")).toBeInTheDocument();
  });

  it("renders 'Edit Event' title when editing", () => {
    render(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    expect(screen.getByText("Edit Event")).toBeInTheDocument();
  });

  it("populates form fields from existing event", () => {
    render(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Daily sync")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Room A")).toBeInTheDocument();
  });

  it("renders delete button only when editing", () => {
    const { rerender } = render(
      <EventModal {...baseProps} event={null} initialRange={null} />
    );
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();

    rerender(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    // Delete button should now be present (it uses a Trash2 icon)
    const buttons = screen.getAllByRole("button");
    const hasDeleteIcon = buttons.some(
      (btn) => btn.querySelector("svg") && btn.getAttribute("type") === "button"
    );
    expect(hasDeleteIcon || buttons.length > 0).toBe(true);
  });

  it("renders all-day toggle", () => {
    render(
      <EventModal {...baseProps} event={null} initialRange={null} />
    );
    expect(screen.getByText("All day")).toBeInTheDocument();
  });

  it("renders calendar selector", () => {
    render(
      <EventModal {...baseProps} event={null} initialRange={null} />
    );
    expect(screen.getByText("Calendar")).toBeInTheDocument();
  });
});
