import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DiscountSection } from "@/components/tickets/DiscountSection";
import type { DiscountScanResult } from "@/lib/discounts/types";

// vi.mock must live in this file so Vitest hoists it above the sonner import below.
vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// The real Select is a base-ui popover/listbox that needs pointer + ResizeObserver
// APIs jsdom doesn't implement. It isn't under test here — the calendar picker's
// behaviour is exercised elsewhere — so stub it with plain passthrough markup.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const NIKE = "https://www.nike.com";

const CALENDARS = [
  { id: "cal-1", userId: "u1", name: "Personal", color: "#f00", isDefault: true, isVisible: true, googleCalendarId: null, shareToken: null, shareMode: null, createdAt: "", updatedAt: "" },
];

function baseResult(overrides: Partial<DiscountScanResult> = {}): DiscountScanResult {
  return {
    hasDiscount: true,
    confidence: "high",
    title: "Nike End of Season Sale",
    discountSummary: "Up to 70% off select styles",
    discountPercent: "up to 70%",
    promoCode: null,
    startDate: null,
    endDate: null,
    categories: [],
    offers: [],
    evidence: [],
    items: [],
    sourceUrl: NIKE,
    url: null,
    aiUsed: "gemini",
    tokensUsed: 100,
    ...overrides,
  };
}

/** Bare-minimum GET handler for the mount-time calendars fetch. */
function fetchStub() {
  return vi.fn((url: string) => {
    if (url === "/api/calendars") {
      return Promise.resolve({ ok: true, json: async () => CALENDARS } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("DiscountSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a persisted scan result from localStorage on mount, rendering the % string verbatim", async () => {
    const checkedAt = new Date().toISOString();
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [NIKE]: { result: baseResult(), checkedAt } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    // "up to 70%" is normalised by the server — the UI must render it verbatim,
    // never reinterpret/recompute it. It legitimately appears twice (badge + headline).
    await waitFor(() => {
      expect(screen.getAllByText("up to 70%").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/^checked /i)).toBeInTheDocument();
  });

  it("does not restore a result for a source that's no longer in the list", async () => {
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ "https://removed.example.com": { result: baseResult({ sourceUrl: "https://removed.example.com" }), checkedAt: new Date().toISOString() } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    await screen.findByText("nike.com");
    expect(screen.queryByText("up to 70%")).not.toBeInTheDocument();
  });

  it("drops a malformed stored entry instead of crashing the section", async () => {
    // `offers: "not-an-array"` and a non-boolean `hasDiscount` simulate a stale
    // schema or tampered storage — without the isDiscountScanResult guard this
    // would throw at `result.offers.length` and take the whole section down.
    localStorage.setItem(
      "discount-results",
      JSON.stringify({
        [NIKE]: {
          result: { hasDiscount: "yes", sourceUrl: NIKE, offers: "not-an-array" },
          checkedAt: new Date().toISOString(),
        },
      })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    // The section renders fine (all 4 default sources still show their idle
    // "Check" button) and the malformed entry left no "Checked …" trace.
    await screen.findByText("nike.com");
    expect(screen.getAllByRole("button", { name: /^check$/i })).toHaveLength(4);
    expect(screen.queryByText(/^checked /i)).not.toBeInTheDocument();
  });

  it("drops a stored entry with an invalid checkedAt timestamp", async () => {
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [NIKE]: { result: baseResult(), checkedAt: "not-a-date" } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    await screen.findByText("nike.com");
    expect(screen.queryByText("up to 70%")).not.toBeInTheDocument();
  });

  it("renders an offer's 'View offer' link only when offer.url is set", async () => {
    const result = baseResult({
      offers: [
        { label: "Storewide sale", detail: null, discountPercent: "20%", promoCode: null, minSpend: null, audience: "all", url: "https://www.nike.com/sale" },
        { label: "Member deal", detail: null, discountPercent: "10%", promoCode: null, minSpend: null, audience: "members", url: null },
      ],
    });
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [NIKE]: { result, checkedAt: new Date().toISOString() } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    await screen.findByText("Storewide sale");
    const offerLinks = screen.getAllByRole("link", { name: /^open .* page$/i });
    expect(offerLinks).toHaveLength(1);
    expect(offerLinks[0]).toHaveAttribute("href", "https://www.nike.com/sale");
    expect(offerLinks[0]).toHaveAttribute("target", "_blank");
    expect(offerLinks[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders an item's name as a link only when item.url is set", async () => {
    const result = baseResult({
      items: [
        { name: "Air Max 90", price: "$90", originalPrice: "$120", url: "https://www.nike.com/air-max-90" },
        { name: "Air Force 1", price: "$70", originalPrice: null, url: null },
      ],
    });
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [NIKE]: { result, checkedAt: new Date().toISOString() } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    const linkedItem = await screen.findByRole("link", { name: "Air Max 90" });
    expect(linkedItem).toHaveAttribute("href", "https://www.nike.com/air-max-90");

    const unlinkedItem = screen.getByText((_, el) => el?.tagName === "LI" && !!el.textContent?.includes("Air Force 1"));
    expect(unlinkedItem.querySelector("a")).toBeNull();
  });

  // The chip is rendered with `Intl.DateTimeFormat(undefined, …)` — the device's
  // own locale — which is zh-HK in this test environment, not en-US. Rather
  // than assume English month names, compute the expected string the same way
  // the component does so these assertions hold under any locale.
  const chipFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

  it("formats a start/end date pair as a 'D – D Mon'-shaped validity chip", async () => {
    const result = baseResult({ startDate: "2026-09-15", endDate: "2026-09-30" });
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [NIKE]: { result, checkedAt: new Date().toISOString() } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    const expected =
      typeof chipFmt.formatRange === "function"
        ? chipFmt.formatRange(new Date(2026, 8, 15), new Date(2026, 8, 30))
        : `${chipFmt.format(new Date(2026, 8, 15))} – ${chipFmt.format(new Date(2026, 8, 30))}`;
    await waitFor(() => {
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  it("formats an end-date-only result as an 'Until <D Mon>' validity chip", async () => {
    const result = baseResult({ startDate: null, endDate: "2026-09-30" });
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [NIKE]: { result, checkedAt: new Date().toISOString() } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    const expected = `Until ${chipFmt.format(new Date(2026, 8, 30))}`;
    await waitFor(() => {
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  it("does not shift a date-only string by a day for a device timezone west of UTC", async () => {
    // Regression guard for `new Date("YYYY-MM-DD")`, which parses as UTC
    // midnight — a day earlier once converted to a western local timezone.
    const originalTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const result = baseResult({ startDate: null, endDate: "2026-09-30" });
      localStorage.setItem(
        "discount-results",
        JSON.stringify({ [NIKE]: { result, checkedAt: new Date().toISOString() } })
      );
      vi.stubGlobal("fetch", fetchStub());

      render(<DiscountSection />);

      const correct = `Until ${chipFmt.format(new Date(2026, 8, 30))}`;
      const buggy = `Until ${chipFmt.format(new Date(2026, 8, 29))}`;
      await waitFor(() => {
        expect(screen.getByText(correct)).toBeInTheDocument();
      });
      expect(screen.queryByText(buggy)).not.toBeInTheDocument();
    } finally {
      process.env.TZ = originalTz;
    }
  });
});
