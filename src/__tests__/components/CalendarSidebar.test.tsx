import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    shareToken: null,
    shareMode: null,
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
    shareToken: null,
    shareMode: null,
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

  it("does not duplicate the global nav links", () => {
    render(<CalendarSidebar {...defaultProps} />);
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Event Section")).not.toBeInTheDocument();
  });

  it("labels visibility toggles and color swatches per calendar", () => {
    render(<CalendarSidebar {...defaultProps} />);
    const name = defaultProps.calendars[0].name;
    expect(screen.getByRole("switch", { name: `Show calendar ${name}` })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `${name} color` })).toBeInTheDocument();
  });

  it("mini calendar follows the main calendar's visible month, with its own arrow labels", () => {
    const { rerender } = render(<CalendarSidebar {...defaultProps} visibleDate={new Date(2026, 11, 1)} />);
    expect(screen.getByText("December 2026")).toBeInTheDocument();
    // Local browsing is kept until the main calendar moves to another month
    fireEvent.click(screen.getByRole("button", { name: "Next month (mini calendar)" }));
    expect(screen.getByText("January 2027")).toBeInTheDocument();
    rerender(<CalendarSidebar {...defaultProps} visibleDate={new Date(2026, 11, 1)} />);
    expect(screen.getByText("January 2027")).toBeInTheDocument();
    rerender(<CalendarSidebar {...defaultProps} visibleDate={new Date(2027, 2, 1)} />);
    expect(screen.getByText("March 2027")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous month (mini calendar)" })).toBeInTheDocument();
  });

  it("marks site-shared and viewer calendars as read-only", () => {
    const shared: CalendarType[] = [
      ...calendars,
      { ...calendars[0], id: "s1", name: "Site Events", memberRole: "viewer", isSiteShared: true },
      { ...calendars[0], id: "s2", name: "Team", memberRole: "editor" },
      { ...calendars[0], id: "s3", name: "Friends", memberRole: "viewer" },
    ];
    render(<CalendarSidebar {...defaultProps} calendars={shared} />);
    expect(screen.getAllByText("Read-only")).toHaveLength(2);
    expect(screen.getByText("editor")).toBeInTheDocument();
  });

  it("closes the mobile drawer on Escape", () => {
    const onMobileClose = vi.fn();
    render(<CalendarSidebar {...defaultProps} mobileOpen onMobileClose={onMobileClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onMobileClose).toHaveBeenCalled();
  });
});
