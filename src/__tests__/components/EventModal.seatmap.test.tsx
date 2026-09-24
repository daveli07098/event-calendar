import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventModal } from "@/components/events/EventModal";
import { invalidateVenueSeatMapsCache } from "@/lib/venue-seatmap/use-venue-seatmaps";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";
import type { CalendarType, EventType } from "@/types";

// Mounting the panel (dynamic imports, several fetch round-trips) is slow when the whole
// suite runs in parallel; the default 5 s limit made these flaky there, not in isolation.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/components/venue/SeatMap", () => ({
  SeatMap: ({ config }: { config?: { id: string } | null }) => <div data-testid="seatmap-2d-stub" data-config={config?.id ?? ""} />,
}));
vi.mock("@/components/venue/SeatMap3D", () => ({
  SeatMap3D: ({ config }: { config?: { id: string } | null }) => <div data-testid="seatmap-3d-stub" data-config={config?.id ?? ""} />,
}));

const calendars: CalendarType[] = [
  {
    id: "cal-1", userId: "user-1", name: "My Calendar", color: "#4285f4", isDefault: true, isVisible: true,
    googleCalendarId: null, shareToken: null, shareMode: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  },
];

const approved: VenueSeatMapConfig = {
  id: "venue-arena",
  name: "Test Arena",
  aliases: ["Test Arena"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  levels: [{ id: "l1", label: "Level 1", tier: 1, radiusRange: [0.1, 0.9], blockNumberRanges: [{ min: 1, max: 20, positionConfidence: "confirmed" }] }],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
};

function eventAt(location: string): EventType {
  return {
    id: "evt-1", calendarId: "cal-1", title: "Show", description: "", location,
    startTime: "2026-10-15T10:00:00Z", endTime: "2026-10-15T12:00:00Z", allDay: false, recurrenceRule: null,
    googleEventId: null, category: null, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", calendar: calendars[0],
  };
}

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  calendars,
  defaultCalendarId: "cal-1",
  onSave: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invalidateVenueSeatMapsCache();
  fetchMock = vi.fn(((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/venues/seatmaps") {
      return Promise.resolve(new Response(JSON.stringify({
        venues: [
          { venueId: "venue-arena", venueName: "Test Arena", aliases: [], status: "approved", source: "user", planUrl: null, updatedAt: null, config: approved },
          { venueId: "venue-draft", venueName: "Draft Hall", aliases: [], status: "draft", source: "ai-draft", planUrl: null, updatedAt: null, config: { ...approved, id: "venue-draft", name: "Draft Hall", aliases: ["Draft Hall"] } },
        ],
      }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as unknown as typeof fetch);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EventModal seat map — approved directory configs", () => {
  it("shows the 2D/3D toggle and passes the approved config for a DB venue", async () => {
    const user = userEvent.setup();
    render(<EventModal {...baseProps} event={eventAt("Test Arena, Hong Kong")} initialRange={null} />);
    // No seat yet — the list isn't fetched.
    expect(fetchMock).not.toHaveBeenCalledWith("/api/venues/seatmaps");

    await user.type(screen.getByLabelText("Seat 座位"), "Block 5 Row F Seat 12");
    expect(await screen.findByRole("button", { name: "3D" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2D" })).toBeInTheDocument();
    expect(await screen.findByTestId("seatmap-2d-stub")).toHaveAttribute("data-config", "venue-arena");
    // Fetched once, not per keystroke.
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/venues/seatmaps")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "3D" }));
    expect(await screen.findByTestId("seatmap-3d-stub")).toHaveAttribute("data-config", "venue-arena");
  });

  it("ignores draft configs", async () => {
    const user = userEvent.setup();
    render(<EventModal {...baseProps} event={eventAt("Draft Hall")} initialRange={null} />);
    await user.type(screen.getByLabelText("Seat 座位"), "Block 5 Row F Seat 12");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/venues/seatmaps"));
    await screen.findByTestId("seatmap-2d-stub");
    expect(screen.queryByRole("button", { name: "3D" })).not.toBeInTheDocument();
  });

  it("keeps the built-in Kai Tak config ahead of directory configs", async () => {
    const user = userEvent.setup();
    render(<EventModal {...baseProps} event={eventAt("Kai Tak Stadium")} initialRange={null} />);
    await user.type(screen.getByLabelText("Seat 座位"), "Level 2 Block 225 Row J Seat 78");
    expect(await screen.findByTestId("seatmap-2d-stub")).toHaveAttribute("data-config", "kai-tak-stadium");
  });

  it("notes additional tickets in one seat line", async () => {
    const user = userEvent.setup();
    render(<EventModal {...baseProps} event={eventAt("Kai Tak Stadium")} initialRange={null} />);
    await user.type(screen.getByLabelText("Seat 座位"), "Block 109·RowJ·Seat223 Block 225·RowJ·Seat78");
    expect(await screen.findByText(/1 more ticket found in this line — showing the first/)).toBeInTheDocument();
  });
});
