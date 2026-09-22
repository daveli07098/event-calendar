import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscountSection } from "@/components/tickets/DiscountSection";
import { toast } from "sonner";
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

// Matches the current DEFAULT_SOURCES[0] — see DiscountSection's
// DEFAULT_SOURCES comment for why these three (server-rendered promo text)
// replaced the earlier nike.com/hk + hk.puma.com defaults (JS-rendered shells).
const MARATHON = "https://marathonsports.hkstore.com/marathon_tc_hk/";

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
    sourceUrl: MARATHON,
    url: null,
    aiUsed: "gemini",
    tokensUsed: 100,
    ...overrides,
  };
}

type FetchHandler = () => Promise<Response> | Response;

/**
 * Bare-minimum handler for the mount-time calendars + sources fetches, with
 * per-endpoint overrides keyed by "METHOD path" (e.g. "PUT /api/discounts/sources")
 * for tests that need to simulate a specific server response.
 */
function fetchStub(overrides: Record<string, FetchHandler> = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    if (overrides[key]) return Promise.resolve(overrides[key]());
    if (url === "/api/calendars") {
      return Promise.resolve({ ok: true, json: async () => CALENDARS } as Response);
    }
    if (url === "/api/discounts/sources") {
      return Promise.resolve({ ok: true, json: async () => ({ sources: [] }) } as Response);
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
      JSON.stringify({ [MARATHON]: { result: baseResult(), checkedAt } })
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

    await screen.findByText("marathonsports.hkstore.com");
    expect(screen.queryByText("up to 70%")).not.toBeInTheDocument();
  });

  it("drops a malformed stored entry instead of crashing the section", async () => {
    // `offers: "not-an-array"` and a non-boolean `hasDiscount` simulate a stale
    // schema or tampered storage — without the isDiscountScanResult guard this
    // would throw at `result.offers.length` and take the whole section down.
    localStorage.setItem(
      "discount-results",
      JSON.stringify({
        [MARATHON]: {
          result: { hasDiscount: "yes", sourceUrl: MARATHON, offers: "not-an-array" },
          checkedAt: new Date().toISOString(),
        },
      })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    // The section renders fine (all 3 default sources still show their idle
    // "Check" button) and the malformed entry left no "Checked …" trace.
    await screen.findByText("marathonsports.hkstore.com");
    expect(screen.getAllByRole("button", { name: /^check$/i })).toHaveLength(3);
    expect(screen.queryByText(/^checked /i)).not.toBeInTheDocument();
  });

  it("drops a stored entry with an invalid checkedAt timestamp", async () => {
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [MARATHON]: { result: baseResult(), checkedAt: "not-a-date" } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    await screen.findByText("marathonsports.hkstore.com");
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
      JSON.stringify({ [MARATHON]: { result, checkedAt: new Date().toISOString() } })
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
      JSON.stringify({ [MARATHON]: { result, checkedAt: new Date().toISOString() } })
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
      JSON.stringify({ [MARATHON]: { result, checkedAt: new Date().toISOString() } })
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
      JSON.stringify({ [MARATHON]: { result, checkedAt: new Date().toISOString() } })
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
        JSON.stringify({ [MARATHON]: { result, checkedAt: new Date().toISOString() } })
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

  // Regression guard: a persisted result with a non-ISO startDate/endDate
  // (the AI returns "Ongoing"/"TBD"/"Sept 2026" sometimes) used to throw a
  // RangeError out of Intl.DateTimeFormat on every mount, crash-looping the
  // whole section. parseDateOnly()/formatValidity() must skip it instead.
  it("renders a persisted result with a non-ISO startDate ('Ongoing') without crashing", async () => {
    const result = baseResult({ startDate: "Ongoing", endDate: "2026-09-30" });
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [MARATHON]: { result, checkedAt: new Date().toISOString() } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    // The section survived and rendered the result — proof the render path
    // didn't throw. The invalid startDate is simply dropped from the chip:
    // endDate alone still yields "Until 30 Sep" via the single-date branch.
    await screen.findByText("marathonsports.hkstore.com");
    expect(screen.getAllByText("up to 70%").length).toBeGreaterThan(0);
    expect(screen.getByText(/^checked /i)).toBeInTheDocument();
    const expectedUntil = `Until ${chipFmt.format(new Date(2026, 8, 30))}`;
    await waitFor(() => {
      expect(screen.getByText(expectedUntil)).toBeInTheDocument();
    });
  });

  it("renders a persisted result with both startDate and endDate non-ISO, with no validity chip at all", async () => {
    const result = baseResult({ startDate: "Ongoing", endDate: "TBD" });
    localStorage.setItem(
      "discount-results",
      JSON.stringify({ [MARATHON]: { result, checkedAt: new Date().toISOString() } })
    );
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    await screen.findByText("marathonsports.hkstore.com");
    expect(screen.getAllByText("up to 70%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^until/i)).not.toBeInTheDocument();
  });

  it("renders the three server-rendered HK default sources, not the JS-rendered/blocked ones", async () => {
    vi.stubGlobal("fetch", fetchStub());

    render(<DiscountSection />);

    // Each domain is exact-matched via its own nested <span> — sibling to a
    // separate path-hint span — so this also guards against a path hint
    // leaking into the domain's own text node.
    await screen.findByText("skechers.com.hk");
    expect(screen.getByText("marathonsports.hkstore.com")).toBeInTheDocument();
    expect(screen.getByText("gigasports.hkstore.com")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^check$/i })).toHaveLength(3);

    // marathonsports.hkstore.com and gigasports.hkstore.com share the same
    // "hkstore.com" platform and a similarly-shaped path — confirm the path
    // hints themselves are distinct (not truncated down to an identical
    // string), so the two rows stay tell-apart-able even at a glance.
    expect(screen.getByText("/marathon_tc_hk/")).toBeInTheDocument();
    expect(screen.getByText("/gigasports_tc_hk/")).toBeInTheDocument();
  });

  it("renders a bot_protected scan error as a muted 'Can't scan' state with an Open-site link, no Re-check", async () => {
    const fetchMock = fetchStub({
      "POST /api/discounts/scan": () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({ error: "This site blocks automated requests", reason: "bot_protected" }),
        }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    const user = userEvent.setup();
    // DEFAULT_SOURCES[0] — MARATHON
    const [firstCheck] = await screen.findAllByRole("button", { name: /^check$/i });
    await user.click(firstCheck);

    await screen.findByText("Can't scan");
    expect(screen.getByText("This site blocks automated requests")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    const openSite = screen.getByRole("link", { name: /open site/i });
    expect(openSite).toHaveAttribute("href", MARATHON);
    expect(screen.queryByRole("button", { name: /re-check/i })).not.toBeInTheDocument();
  });

  it("loads custom sources from the account-backed sources API on mount, not from localStorage", async () => {
    // No "discount-sources" localStorage entry — the server list alone should
    // populate a 4th row.
    const fetchMock = fetchStub({
      "GET /api/discounts/sources": () =>
        ({ ok: true, json: async () => ({ sources: ["https://outlet.example.com/"] }) }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);

    await screen.findByText("outlet.example.com");
    // Nothing local to migrate, so no PUT should have fired.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/discounts/sources",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("rolls back and shows an error toast when saving a newly added source fails", async () => {
    const fetchMock = fetchStub({
      "PUT /api/discounts/sources": () =>
        ({ ok: false, json: async () => ({ error: "Server exploded" }) }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    await screen.findByText("skechers.com.hk"); // wait for mount-time sources fetch to settle

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add discount source URL"), "https://shop.example.com");
    await user.click(screen.getByRole("button", { name: /add source/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Couldn't save your sources");
    });
    // The optimistic add was rolled back — the source never sticks around.
    expect(screen.queryByText("shop.example.com")).not.toBeInTheDocument();
  });

  it("rejects a new source that differs from an existing custom source only by a trailing slash", async () => {
    const fetchMock = fetchStub({
      "GET /api/discounts/sources": () =>
        ({ ok: true, json: async () => ({ sources: ["https://www.nike.com"] }) }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    // nike.com isn't a default anymore, so this is purely a custom-source row.
    await screen.findByText("nike.com");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add discount source URL"), "https://www.nike.com/");
    await user.click(screen.getByRole("button", { name: /add source/i }));

    expect(toast.info).toHaveBeenCalledWith("Source already in the list");
    // Rejected client-side before any save attempt.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/discounts/sources",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("surfaces a failed one-time migration PUT instead of swallowing it: local-only sources still render, the device-only note appears, and it toasts once", async () => {
    // This device has a custom source the server has never seen — the mount
    // effect's GET succeeds (empty server list) but the one-time union PUT
    // that would sync it up fails.
    localStorage.setItem("discount-sources", JSON.stringify(["https://shop.example.com/"]));
    const fetchMock = fetchStub({
      "GET /api/discounts/sources": () => ({ ok: true, json: async () => ({ sources: [] }) }) as Response,
      "PUT /api/discounts/sources": () => ({ ok: false, json: async () => ({ error: "Server exploded" }) }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);

    // The local-only source still renders even though syncing it failed —
    // this is exactly what "silently vanished" looked like before the fix.
    await screen.findByText("shop.example.com");
    await waitFor(() => {
      expect(screen.getByText("Saved on this device only")).toBeInTheDocument();
    });
    expect(toast.error).toHaveBeenCalledWith("Couldn't save your sources");
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("opens the paste dialog from a bot_protected row and posts pageContent to the scan endpoint", async () => {
    const fetchMock = fetchStub({
      "POST /api/discounts/scan": () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({ error: "This site blocks automated requests", reason: "bot_protected" }),
        }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    const user = userEvent.setup();
    // DEFAULT_SOURCES[0] — MARATHON
    const [firstCheck] = await screen.findAllByRole("button", { name: /^check$/i });
    await user.click(firstCheck);
    await screen.findByText("Can't scan");

    // The primary paste action next to "Open site" on a can't-scan row.
    await user.click(screen.getByRole("button", { name: /^paste page$/i }));
    await screen.findByText(`Paste ${"marathonsports.hkstore.com"}`);

    fireEvent.change(screen.getByLabelText("Page content"), { target: { value: "some raw pasted page markup" } });
    await user.click(screen.getByRole("button", { name: /scan pasted page/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => url === "/api/discounts/scan" && (init as RequestInit | undefined)?.method === "POST")
      ).toBe(true);
    });
    const scanCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/discounts/scan");
    const lastBody = JSON.parse((scanCalls.at(-1)![1] as RequestInit).body as string);
    expect(lastBody).toEqual({ url: MARATHON, pageContent: "some raw pasted page markup" });
  });

  it("renders offers and a 'from pasted page' marker after a successful pasted scan", async () => {
    const result = baseResult({
      fromPastedContent: true,
      offers: [
        { label: "Storewide sale", detail: null, discountPercent: "20%", promoCode: null, minSpend: null, audience: "all", url: null },
      ],
    });
    const fetchMock = fetchStub({
      "POST /api/discounts/scan": () => ({ ok: true, json: async () => ({ result }) }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    const user = userEvent.setup();
    // The small, always-available paste affordance next to the external-link icon.
    const [pasteAffordance] = await screen.findAllByRole("button", { name: /paste page content for marathonsports\.hkstore\.com/i });
    await user.click(pasteAffordance);

    fireEvent.change(screen.getByLabelText("Page content"), { target: { value: "pasted markup with the sale text" } });
    await user.click(screen.getByRole("button", { name: /scan pasted page/i }));

    await screen.findByText("Storewide sale");
    expect(screen.getByText(/from pasted page/i)).toBeInTheDocument();
    // The dialog closes on success.
    expect(screen.queryByLabelText("Page content")).not.toBeInTheDocument();
  });

  it("keeps the paste dialog open and shows the server message inline on empty_content", async () => {
    const fetchMock = fetchStub({
      "POST /api/discounts/scan": () =>
        ({
          ok: false,
          status: 422,
          json: async () => ({ error: "That paste doesn't contain any readable text", reason: "empty_content" }),
        }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    const user = userEvent.setup();
    const [pasteAffordance] = await screen.findAllByRole("button", { name: /paste page content for marathonsports\.hkstore\.com/i });
    await user.click(pasteAffordance);

    fireEvent.change(screen.getByLabelText("Page content"), { target: { value: "just some pasted text" } });
    await user.click(screen.getByRole("button", { name: /scan pasted page/i }));

    // Appears twice: the sr-only aria-live announcement and the dialog's own
    // inline message paragraph.
    await waitFor(() => {
      expect(screen.getAllByText("That paste doesn't contain any readable text").length).toBeGreaterThan(0);
    });
    // Dialog stayed open — the textarea and submit button are still there.
    expect(screen.getByLabelText("Page content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan pasted page/i })).toBeInTheDocument();

    // Closing the dialog reveals the row untouched — nothing was written
    // back as an error state on the source itself.
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Can't scan")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^check$/i })).toHaveLength(3);
  });

  it("renders a corporate_redirect scan error as a muted 'Can't scan' state with an Open-site link, no Re-check", async () => {
    const fetchMock = fetchStub({
      "POST /api/discounts/scan": () =>
        ({
          ok: false,
          status: 422,
          json: async () => ({
            error: "This redirects to the corporate site — use the regional store URL instead",
            reason: "corporate_redirect",
          }),
        }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    const user = userEvent.setup();
    // DEFAULT_SOURCES[1] — https://gigasports.hkstore.com/gigasports_tc_hk/
    const [, gigasportsCheck] = await screen.findAllByRole("button", { name: /^check$/i });
    await user.click(gigasportsCheck);

    await screen.findByText("Can't scan");
    expect(screen.getByText(/use the regional store url instead/i)).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    const openSite = screen.getByRole("link", { name: /open site/i });
    expect(openSite).toHaveAttribute("href", "https://gigasports.hkstore.com/gigasports_tc_hk/");
    expect(screen.queryByRole("button", { name: /re-check/i })).not.toBeInTheDocument();
  });

  // Regression guard for the "superseded" abort race: useAbortableRequest
  // aborts an in-flight request under the same key (source URL) with reason
  // "superseded" as soon as a NEWER request for that same source starts (e.g.
  // "Check all" reaching a source that's already mid single-row scan). The
  // older request's catch block must not write anything — it no longer owns
  // this row's status — or it clobbers whatever the newer request is doing
  // with a false "Network error".
  it("does not overwrite a newer superseding request's status with a false 'Network error'", async () => {
    let callIndex = 0;
    let resolveSuperseding = null as (() => void) | null;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/calendars") return Promise.resolve({ ok: true, json: async () => CALENDARS } as Response);
      if (url === "/api/discounts/sources") return Promise.resolve({ ok: true, json: async () => ({ sources: [] }) } as Response);
      if (url === "/api/discounts/scan" && method === "POST") {
        callIndex += 1;
        if (callIndex === 1) {
          // The first, single-row scan of MARATHON — this is the one that
          // gets superseded. A real fetch rejects when its signal aborts;
          // mirror that so the component's catch block actually runs.
          return new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          });
        }
        if (callIndex === 2) {
          // "Check all" reaching MARATHON — the newer request that supersedes
          // call #1. Stays pending so the intermediate "scanning" state (after
          // call #1's abort settles) can be asserted before it resolves.
          return new Promise<Response>((resolve) => {
            resolveSuperseding = () => resolve({ ok: true, json: async () => ({ result: baseResult() }) } as Response);
          });
        }
        // "Check all" continuing on to gigasports/skechers — resolve normally
        // so they don't pollute a page-wide "Network error"/"Failed" check.
        return Promise.resolve({ ok: true, json: async () => ({ result: baseResult({ sourceUrl: url }) }) } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    const user = userEvent.setup();
    const [firstCheck] = await screen.findAllByRole("button", { name: /^check$/i });
    await user.click(firstCheck); // kicks off call #1 (pending; aborts once superseded)

    // "Check all" is only disabled while a Check-all loop is already running,
    // not while a single row is mid-scan — reachable here.
    await user.click(screen.getByRole("button", { name: /^check all$/i }));

    // Flush the microtask/macrotask queue so call #1's abort → rejection →
    // catch block settles before asserting the intermediate state.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByText("Network error")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/scanning marathonsports/i);

    // Resolve the superseding request — the row should land on its real
    // result, not an error the older, aborted request would have written.
    resolveSuperseding?.();
    await waitFor(() => {
      expect(screen.getAllByText("up to 70%").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Network error")).not.toBeInTheDocument();
  });
});
