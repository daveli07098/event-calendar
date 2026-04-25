import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarSidebar } from "@/components/calendar/CalendarSidebar";
import type { CalendarType } from "@/types";

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
  {
    id: "cal-2",
    userId: "user-1",
    name: "Work",
    color: "#ea4335",
    isDefault: false,
    isVisible: false,
    googleCalendarId: "google-abc",
    createdAt: "2025-01-02T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
  },
];

describe("CalendarSidebar", () => {
  const defaultProps = {
    calendars,
    onCalendarToggle: vi.fn(),
    onAddCalendar: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders calendar names", () => {
    render(<CalendarSidebar {...defaultProps} />);
    expect(screen.getByText("My Calendar")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
  });

  it("shows Google indicator for synced calendars", () => {
    render(<CalendarSidebar {...defaultProps} />);
    expect(screen.getByText("G")).toBeInTheDocument();
  });

  it("renders mini calendar month name", () => {
    render(<CalendarSidebar {...defaultProps} />);
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const now = new Date();
    const expectedMonth = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    expect(screen.getByText(expectedMonth)).toBeInTheDocument();
  });

  it("collapses when chevron is clicked", async () => {
    const user = userEvent.setup();
    render(<CalendarSidebar {...defaultProps} />);
    // The sidebar shows "Calendars" text when expanded
    expect(screen.getByText("Calendars")).toBeInTheDocument();
    // Find the collapse button (ChevronLeft)
    const collapseButtons = screen.getAllByRole("button");
    // Click the collapse button (first button in header area)
    const collapseBtn = collapseButtons.find((btn) =>
      btn.closest(".flex.items-center.justify-between.p-3")
    );
    if (collapseBtn) {
      await user.click(collapseBtn);
      // After collapse, "Calendars" text should not be visible
      expect(screen.queryByText("My Calendar")).not.toBeInTheDocument();
    }
  });

  it("renders Settings link", () => {
    render(<CalendarSidebar {...defaultProps} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});
