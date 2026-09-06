import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TicketSection } from "@/components/tickets/TicketSection";

// vi.mock must live in this file so Vitest hoists it above the sonner import below.
vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Overrides the global next/navigation stub from src/__tests__/setup.ts with a
// version whose router.replace / searchParams we can inspect and mutate —
// needed to assert the tab ↔ URL sync behaviour.
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/tickets",
  useSearchParams: () => mockSearchParams,
}));

/** Bare-minimum GET handler for the mount-time quota fetch ("/api/tickets/scrape"). */
function okJson(body: unknown = {}) {
  return Promise.resolve({ ok: true, json: async () => body } as Response);
}

describe("TicketSection — nav tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => okJson({}))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicking a tab updates the URL via router.replace with the section param", async () => {
    render(<TicketSection />);

    const classifyTab = screen.getByRole("button", { name: /category detection/i });
    fireEvent.click(classifyTab);

    expect(mockReplace).toHaveBeenCalledWith("/tickets?section=classify", { scroll: false });

    const worldCupTab = screen.getByRole("button", { name: /world cup/i });
    fireEvent.click(worldCupTab);
    expect(mockReplace).toHaveBeenCalledWith("/tickets?section=worldcup", { scroll: false });
  });

  it("marks only the active tab with aria-current=page, defaulting to Import Event", async () => {
    render(<TicketSection />);

    const importTab = screen.getByRole("button", { name: /import event/i });
    const venuesTab = screen.getByRole("button", { name: /^venues$/i });
    expect(importTab).toHaveAttribute("aria-current", "page");
    expect(venuesTab).not.toHaveAttribute("aria-current");

    fireEvent.click(venuesTab);
    expect(venuesTab).toHaveAttribute("aria-current", "page");
    expect(importTab).not.toHaveAttribute("aria-current");
  });

  it("opens directly on the section named in the ?section= query param", async () => {
    mockSearchParams = new URLSearchParams("section=discounts");
    render(<TicketSection />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /discount sale/i })).toHaveAttribute("aria-current", "page");
    });
  });

  it("nav has an accessible label for the tab strip", () => {
    render(<TicketSection />);
    expect(screen.getByRole("navigation", { name: /event section tabs/i })).toBeInTheDocument();
  });

  it("syncs to a new section when searchParams changes after mount (browser back/forward)", async () => {
    const { rerender } = render(<TicketSection />);
    expect(screen.getByRole("button", { name: /import event/i })).toHaveAttribute("aria-current", "page");

    // Simulates a back/forward navigation: the URL changes, useSearchParams
    // returns a new instance, and the effect should re-sync local state.
    mockSearchParams = new URLSearchParams("section=venues");
    rerender(<TicketSection />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^venues$/i })).toHaveAttribute("aria-current", "page");
    });
    expect(screen.getByRole("button", { name: /import event/i })).not.toHaveAttribute("aria-current");
  });
});

describe("TicketSection — mobile nav scroll fade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => okJson({}))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** jsdom reports 0 for all scroll/layout metrics by default; stub them on the
   * <nav> node to simulate a horizontally-overflowing strip. */
  function stubNavScrollMetrics(
    nav: HTMLElement,
    { scrollLeft, clientWidth, scrollWidth }: { scrollLeft: number; clientWidth: number; scrollWidth: number }
  ) {
    Object.defineProperty(nav, "scrollLeft", { value: scrollLeft, configurable: true });
    Object.defineProperty(nav, "clientWidth", { value: clientWidth, configurable: true });
    Object.defineProperty(nav, "scrollWidth", { value: scrollWidth, configurable: true });
  }

  it("shows the right-edge fade overlay when the strip has not been scrolled to its end", () => {
    render(<TicketSection />);
    const nav = screen.getByRole("navigation", { name: /event section tabs/i });

    stubNavScrollMetrics(nav, { scrollLeft: 0, clientWidth: 300, scrollWidth: 500 });
    fireEvent.scroll(nav);

    expect(screen.getByTestId("nav-scroll-fade")).toBeInTheDocument();
  });

  it("hides the fade once scrolled to the strip's end", () => {
    render(<TicketSection />);
    const nav = screen.getByRole("navigation", { name: /event section tabs/i });

    stubNavScrollMetrics(nav, { scrollLeft: 0, clientWidth: 300, scrollWidth: 500 });
    fireEvent.scroll(nav);
    expect(screen.getByTestId("nav-scroll-fade")).toBeInTheDocument();

    stubNavScrollMetrics(nav, { scrollLeft: 200, clientWidth: 300, scrollWidth: 500 });
    fireEvent.scroll(nav);
    expect(screen.queryByTestId("nav-scroll-fade")).not.toBeInTheDocument();
  });
});

describe("TicketSection — venue seat-map hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const TEST_URL = "https://example.com/event/1";

  function scrapedTicket(venue: string | null) {
    return {
      title: "Test Event",
      date: "2026-07-18",
      time: "20:00",
      venue,
      location: null,
      description: null,
      imageUrl: null,
      sourceUrl: TEST_URL,
      aiUsed: "og-meta",
      aiError: null,
      aiTokensUsed: null,
      aiQuota: { used: 0, limit: 10, remaining: 10 },
      ticketPrices: null,
      ticketPlatforms: null,
      endDate: null,
      endTime: null,
      saleDate: null,
      saleFirstDate: null,
      saleDates: null,
      category: null,
      artist: null,
      slots: [],
      venueRuns: [],
      duplicateCandidates: [],
    };
  }

  /** Existing-event-with-no-changes diff response — routes the scan straight to the
   * "already in your calendar — up to date" card, which shows a static Venue 場地 row. */
  function upToDateDiff(venue: string | null) {
    return {
      hasExisting: true,
      hasChanges: false,
      eventId: "existing-1",
      saleEventIds: {},
      saleEventId: null,
      presaleEventId: null,
      changes: [],
      storedDate: "2026-07-18",
      storedTime: "20:00",
      storedVenue: venue,
      storedSaleWindows: [],
    };
  }

  async function scanAndAwaitUpToDateCard(venue: string | null) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/tickets/scrape" && init?.method === "POST") {
        return okJson(scrapedTicket(venue));
      }
      if (url === "/api/tickets/diff" && init?.method === "POST") {
        return okJson(upToDateDiff(venue));
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TicketSection />);
    fireEvent.change(screen.getByPlaceholderText(/timable\.com/i), { target: { value: TEST_URL } });
    fireEvent.click(screen.getByRole("button", { name: /^scan$/i }));

    await waitFor(() => {
      expect(screen.getByText(/up to date/i)).toBeInTheDocument();
    });
  }

  it("shows a seat map badge for a venue that matches the built-in registry (Kai Tak Stadium)", async () => {
    await scanAndAwaitUpToDateCard("啟德體育園主場館");
    expect(screen.getByText(/seat map available · kai tak stadium/i)).toBeInTheDocument();
  });

  it("shows no badge for a venue that isn't in the built-in registry", async () => {
    await scanAndAwaitUpToDateCard("MOM Livehouse");
    expect(screen.queryByText(/seat map available/i)).not.toBeInTheDocument();
  });
});

describe("TicketSection — Category Detection calendar list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an error state with a Retry button when the calendar fetch fails, and recovers on retry", async () => {
    let calendarsCallCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/calendars") {
        calendarsCallCount += 1;
        if (calendarsCallCount === 1) {
          return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
        }
        return okJson([{ id: "cal-1", name: "event-reminders", color: "#fff" }]);
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TicketSection />);
    fireEvent.click(screen.getByRole("button", { name: /category detection/i }));

    await waitFor(() => {
      expect(screen.getByText(/couldn.t load calendars/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
    expect(calendarsCallCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/couldn.t load calendars/i)).not.toBeInTheDocument();
    });
    expect(calendarsCallCount).toBe(2);
    expect(screen.getByText("event-reminders")).toBeInTheDocument();
  });

  it("shows an empty state when the calendar list loads with zero calendars", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/calendars") return okJson([]);
        return okJson({});
      })
    );

    render(<TicketSection />);
    fireEvent.click(screen.getByRole("button", { name: /category detection/i }));

    await waitFor(() => {
      expect(screen.getByText(/no calendars to classify yet/i)).toBeInTheDocument();
    });
  });
});
