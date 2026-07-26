import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TicketSection } from "@/components/tickets/TicketSection";

// vi.mock must live in this file so Vitest hoists it above the sonner import below.
const toastWarning = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarning(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

const TEST_URL = "https://example.com/event/1";

/** Bare-minimum GET handler for the mount-time quota fetch ("/api/tickets/scrape"). */
function okJson(body: unknown = {}) {
  return Promise.resolve({ ok: true, json: async () => body } as Response);
}

/** Types the ticket URL and clicks Scan. */
async function scanUrl(url = TEST_URL) {
  const input = screen.getByPlaceholderText(/timable\.com/i);
  fireEvent.change(input, { target: { value: url } });
  const scanBtn = screen.getByRole("button", { name: /^scan$/i });
  fireEvent.click(scanBtn);
}

describe("TicketSection — abort/timeout/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("Cancel aborts the in-flight scrape request and preserves the typed URL", async () => {
    const scrapeCalls: Array<{ signal?: AbortSignal }> = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/tickets/scrape" && init?.method === "POST") {
        scrapeCalls.push({ signal: init.signal ?? undefined });
        // Simulates a hung request: only ever settles if the caller aborts it.
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      // Mount-time quota GET and any other incidental calls.
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TicketSection />);
    await scanUrl();

    // Scan is in flight — the Cancel button should be visible.
    const cancelBtn = await screen.findByRole("button", { name: /cancel/i });
    expect(scrapeCalls).toHaveLength(1);

    fireEvent.click(cancelBtn);

    // Back to the idle input state — Scan button reappears...
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^scan$/i })).toBeInTheDocument();
    });
    // ...and the typed URL is still there (handleReset was NOT called).
    expect(screen.getByPlaceholderText(/timable\.com/i)).toHaveValue(TEST_URL);
  });

  it("shows a distinct message when the scrape request times out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/tickets/scrape" && init?.method === "POST") {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TicketSection />);
    await scanUrl();

    // Advance past the 45s client-side timeout. RTL's own waitFor polls via
    // setTimeout, which fake timers would also intercept — advance instead of
    // waitFor, then assert directly once the (already-flushed) microtasks land.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_001);
    });

    expect(screen.getByText(/took too long/i)).toBeInTheDocument();
    // Distinct from the generic network-error copy.
    expect(screen.queryByText(/^network error/i)).not.toBeInTheDocument();
  });

  it("Retry re-issues the scrape request with the same URL", async () => {
    let scrapeCallCount = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/tickets/scrape" && init?.method === "POST") {
        scrapeCallCount += 1;
        const body = JSON.parse(init.body as string);
        expect(body.url).toBe(TEST_URL);
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "Simulated scrape failure" }),
        } as Response);
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TicketSection />);
    await scanUrl();

    await waitFor(() => {
      expect(screen.getByText(/could not extract ticket info/i)).toBeInTheDocument();
    });
    expect(scrapeCallCount).toBe(1);

    const retryBtn = screen.getByRole("button", { name: /^retry$/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(scrapeCallCount).toBe(2);
    });
    // Still on the same URL — "Try another URL" is a separate action from Retry.
    expect(screen.getByPlaceholderText(/timable\.com/i)).toHaveValue(TEST_URL);
  });
});
