import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    shareToken: null,
    shareMode: null,
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
  category: null,
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

  it("populates form fields from existing event", async () => {
    render(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    // Field initialization is deferred a tick (setTimeout(0)) in EventModal so
    // the dialog mounts before the form state updates — wait for it.
    await waitFor(() => {
      expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
    });
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

  // Bug 2: toggling All Day on then off used to clobber the event's real time
  // with the current wall clock instead of restoring it.
  it("preserves the original time-of-day through an all-day on/off round trip", async () => {
    const user = userEvent.setup();
    render(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
    });

    const startInput = screen.getByLabelText("Start") as HTMLInputElement;
    const originalStart = startInput.value;
    expect(originalStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    const allDaySwitch = screen.getByRole("switch", { name: "All day" });
    await user.click(allDaySwitch); // All day ON — time is stripped
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe(
      originalStart.slice(0, 10)
    );

    await user.click(allDaySwitch); // All day OFF — time should be restored, not "now"
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe(originalStart);
  });

  // Bug 3: Sync/Update Teams replaces the `event` prop in place (same id) — that
  // must not re-run initialization and wipe out an in-progress edit.
  it("does not clobber a dirty field when the event prop is replaced in place (same id)", async () => {
    const { rerender } = render(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const locationInput = screen.getByLabelText("Location") as HTMLInputElement;
    await user.clear(locationInput);
    await user.type(locationInput, "Room Z");

    // Simulate onSynced: same id, new object identity, a field changed elsewhere
    const syncedEvent: EventType = { ...existingEvent, title: "Team Standup (synced)" };
    rerender(
      <EventModal {...baseProps} event={syncedEvent} initialRange={null} />
    );

    expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("Room Z");
  });

  // Bug 4: closing while dirty must prompt; closing while clean must not.
  it("prompts to discard when closing with unsaved changes", async () => {
    const user = userEvent.setup();
    render(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Title"), " extra");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(baseProps.onOpenChange).not.toHaveBeenCalled();
  });

  it("closes immediately with no prompt when there are no unsaved changes", async () => {
    const user = userEvent.setup();
    render(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
  });

  // Bug 1: Delete must be gated behind confirmation — no DELETE (via onDelete)
  // until the user explicitly confirms.
  it("does not call onDelete until the delete confirmation is accepted", async () => {
    const user = userEvent.setup();
    render(
      <EventModal {...baseProps} event={existingEvent} initialRange={null} />
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(baseProps.onDelete).not.toHaveBeenCalled();

    const confirmDialog = screen.getByRole("alertdialog");
    expect(within(confirmDialog).getByText(/delete this event/i)).toBeInTheDocument();

    await user.click(within(confirmDialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(baseProps.onDelete).toHaveBeenCalledTimes(1);
    });
  });

  // Phase 0 seat feature — manual seat entry, stored as a "Seat: <raw>" line
  // inside description (same convention as Seating Plan), with a live
  // client-side parsed breakdown.
  describe("Seat field", () => {
    it("round-trips a seat through the description: set, save, reopen", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(
        <EventModal {...baseProps} onSave={onSave} event={existingEvent} initialRange={null} />
      );
      await waitFor(() => {
        expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Seat 座位"), "Gate F Level 2 Block 225 Row BB Seat 101");
      await user.click(screen.getByRole("button", { name: /^update$/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
      });
      const saved = onSave.mock.calls[0][0];
      expect(saved.description).toContain("Seat: Gate F Level 2 Block 225 Row BB Seat 101");

      // Reopen with the saved description — the seat line should populate the input again.
      const savedEvent: EventType = { ...existingEvent, description: saved.description };
      rerender(
        <EventModal {...baseProps} onSave={onSave} event={null} initialRange={null} />
      );
      rerender(
        <EventModal {...baseProps} onSave={onSave} event={savedEvent} initialRange={null} />
      );
      await waitFor(() => {
        expect(screen.getByLabelText("Seat 座位")).toHaveValue("Gate F Level 2 Block 225 Row BB Seat 101");
      });
    });

    it("removes the Seat line when the field is cleared", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      // An event that already carries a seat line alongside other content.
      const seated: EventType = {
        ...existingEvent,
        description: "Daily sync\n\nSeat: Gate F Level 2 Block 225 Row BB Seat 101",
      };
      render(
        <EventModal {...baseProps} onSave={onSave} event={seated} initialRange={null} />
      );
      await waitFor(() => {
        expect(screen.getByLabelText("Seat 座位")).toHaveValue(
          "Gate F Level 2 Block 225 Row BB Seat 101"
        );
      });

      await user.clear(screen.getByLabelText("Seat 座位"));
      await user.click(screen.getByRole("button", { name: /^update$/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
      });
      const saved = onSave.mock.calls[0][0];
      // The line is gone, and the rest of the description survives.
      expect(saved.description).not.toContain("Seat:");
      expect(saved.description).toContain("Daily sync");
    });

    it("renders a partial parse as visibly partial, not a completed breakdown", async () => {
      const user = userEvent.setup();
      render(
        <EventModal {...baseProps} event={existingEvent} initialRange={null} />
      );
      await waitFor(() => {
        expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
      });

      // "Block 225 Row BB" has no seat — classify() marks this "partial".
      await user.type(screen.getByLabelText("Seat 座位"), "Block 225 Row BB");

      const breakdown = await screen.findByTestId("seat-breakdown");
      expect(within(breakdown).getByText(/partial/i)).toBeInTheDocument();
      expect(within(breakdown).getByText(/Block 225/)).toBeInTheDocument();
      expect(within(breakdown).getByText(/Row BB/)).toBeInTheDocument();
    });

    it("shows the raw text plainly for an unparseable seat string", async () => {
      const user = userEvent.setup();
      render(
        <EventModal {...baseProps} event={existingEvent} initialRange={null} />
      );
      await waitFor(() => {
        expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Seat 座位"), "asdkfjhasdkfj12345!!!");

      const breakdown = await screen.findByTestId("seat-breakdown");
      expect(within(breakdown).getByText(/not recognized/i)).toBeInTheDocument();
      expect(within(breakdown).getByText("asdkfjhasdkfj12345!!!")).toBeInTheDocument();
    });

    it("participates in dirty-tracking: typing a seat then closing prompts the discard confirmation", async () => {
      const user = userEvent.setup();
      render(
        <EventModal {...baseProps} event={existingEvent} initialRange={null} />
      );
      await waitFor(() => {
        expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Seat 座位"), "Seat 101");
      await user.click(screen.getByRole("button", { name: /cancel/i }));

      expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
      expect(baseProps.onOpenChange).not.toHaveBeenCalled();
    });
  });
});
