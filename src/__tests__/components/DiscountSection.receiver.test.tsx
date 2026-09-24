import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscountSection } from "@/components/tickets/DiscountSection";
import { PAGE_MESSAGE_TYPE } from "@/lib/discounts/bookmarklet";

// vi.mock must live in this file so Vitest hoists it above the sonner import below.
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const CALENDARS = [
  { id: "cal-1", userId: "u1", name: "Personal", color: "#f00", isDefault: true, isVisible: true, googleCalendarId: null, shareToken: null, shareMode: null, createdAt: "", updatedAt: "" },
];

type FetchHandler = () => Promise<Response> | Response;

function fetchStub(overrides: Record<string, FetchHandler> = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    if (overrides[key]) return Promise.resolve(overrides[key]());
    if (url === "/api/calendars") return Promise.resolve({ ok: true, json: async () => CALENDARS } as Response);
    if (url === "/api/discounts/sources") return Promise.resolve({ ok: true, json: async () => ({ sources: [] }) } as Response);
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

const SHOP_ORIGIN = "https://fanatics.com";
const SHOP_URL = "https://fanatics.com/nba/sale";
const HTML = "<html><body>Summer sale 30% off code SAVE30</body></html>";

/** Puts the app on the same URL the bookmarklet's window.open() target uses. */
function goToReceiveUrl() {
  window.history.pushState({}, "", "/tickets?section=discounts&receive=1");
}

function postDiscountPage(overrides: Record<string, unknown> = {}) {
  const data = { type: PAGE_MESSAGE_TYPE, v: 1, url: SHOP_URL, title: "NBA Sale", html: HTML, ...overrides };
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: SHOP_ORIGIN }));
  });
}

describe("DiscountSection — bookmarklet receiver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  it("accepts a valid ec-discount-page message matched to an existing source, and scans it on 'Scan now'", async () => {
    goToReceiveUrl();
    const fetchMock = fetchStub({
      "GET /api/discounts/sources": () => ({ ok: true, json: async () => ({ sources: [SHOP_URL] }) }) as Response,
      "POST /api/discounts/scan": () => ({ ok: true, json: async () => ({ result: null }) }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    await screen.findByText("fanatics.com"); // the custom source row from the sources GET

    postDiscountPage();

    await screen.findByText(/received page from/i);
    expect(screen.getByText("fanatics.com", { selector: "strong" })).toBeInTheDocument();
    // ~2 KB of pasted HTML rounds up to at least 1 KB.
    expect(screen.getByText(/\(\d+ KB\)/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^scan now$/i }));

    await waitFor(() => {
      const scanCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/discounts/scan");
      expect(scanCalls.length).toBeGreaterThan(0);
    });
    const scanCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/discounts/scan");
    const lastBody = JSON.parse((scanCalls.at(-1)![1] as RequestInit).body as string);
    expect(lastBody).toEqual({ url: SHOP_URL, pageContent: HTML });

    // The strip is gone once "Scan now" is clicked.
    expect(screen.queryByText(/received page from/i)).not.toBeInTheDocument();
  });

  it("strips receive=1 from the URL once a page is accepted", async () => {
    goToReceiveUrl();
    vi.stubGlobal("fetch", fetchStub());
    render(<DiscountSection />);
    await screen.findByText("marathonsports.hkstore.com");

    postDiscountPage();

    await screen.findByText(/received page from/i);
    expect(window.location.search).not.toContain("receive=1");
  });

  it("rejects a message with the wrong type", async () => {
    goToReceiveUrl();
    vi.stubGlobal("fetch", fetchStub());
    render(<DiscountSection />);
    await screen.findByText("marathonsports.hkstore.com");

    postDiscountPage({ type: "some-other-type" });

    expect(screen.queryByText(/received page from/i)).not.toBeInTheDocument();
  });

  it("rejects a message whose url hostname doesn't match the sending window's origin (spoofed url)", async () => {
    goToReceiveUrl();
    vi.stubGlobal("fetch", fetchStub());
    render(<DiscountSection />);
    await screen.findByText("marathonsports.hkstore.com");

    // Claims to be nike.com while actually posted from fanatics.com.
    postDiscountPage({ url: "https://www.nike.com/sale" });

    expect(screen.queryByText(/received page from/i)).not.toBeInTheDocument();
  });

  it("rejects an oversized html payload", async () => {
    goToReceiveUrl();
    vi.stubGlobal("fetch", fetchStub());
    render(<DiscountSection />);
    await screen.findByText("marathonsports.hkstore.com");

    postDiscountPage({ html: "x".repeat(400_001) });

    expect(screen.queryByText(/received page from/i)).not.toBeInTheDocument();
  });

  it("does nothing when the URL has no receive=1 param (normal page load)", async () => {
    vi.stubGlobal("fetch", fetchStub());
    render(<DiscountSection />);
    await screen.findByText("marathonsports.hkstore.com");

    postDiscountPage();

    expect(screen.queryByText(/received page from/i)).not.toBeInTheDocument();
  });

  it("offers 'Add as source & scan' when the received page's host isn't in the source list, and saves it before scanning", async () => {
    goToReceiveUrl();
    const fetchMock = fetchStub({
      "PUT /api/discounts/sources": () => ({ ok: true, json: async () => ({ sources: [SHOP_URL] }) }) as Response,
      "POST /api/discounts/scan": () => ({ ok: true, json: async () => ({ result: null }) }) as Response,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiscountSection />);
    await screen.findByText("marathonsports.hkstore.com");

    postDiscountPage();

    await screen.findByText(/not yet in your sources/i);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add as source & scan/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/discounts/sources",
        expect.objectContaining({ method: "PUT" })
      );
    });
    await waitFor(() => {
      const scanCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/discounts/scan");
      expect(scanCalls.length).toBeGreaterThan(0);
    });
  });

  it("dismisses the strip without scanning", async () => {
    goToReceiveUrl();
    const fetchMock = fetchStub();
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscountSection />);
    await screen.findByText("marathonsports.hkstore.com");

    postDiscountPage();
    await screen.findByText(/received page from/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^dismiss$/i }));

    expect(screen.queryByText(/received page from/i)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/discounts/scan")).toBe(false);
  });
});
