import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.mock must live in this file so Vitest hoists it above the imports below.
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { STORAGE_KEY } from "@/lib/theme";

/** A minimal `window.matchMedia` stub — no listener plumbing needed for these tests. */
function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }) as unknown as typeof window.matchMedia;
}

function Harness() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="mode">{theme.mode}</span>
      <button onClick={() => setTheme({ mode: "dark" })}>set-dark</button>
    </div>
  );
}

/** A controllable, never-resolving-until-you-say-so fetch response. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not let a stale server GET overwrite a theme the user changed while it was in flight", async () => {
    const getDeferred = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        // GET /api/user/settings — held open until the test resolves it.
        return getDeferred.promise;
      }
      // PUT /api/user/settings — resolve immediately, uninteresting here.
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    // GET is in flight. User makes a fresh choice before it resolves.
    const user = userEvent.setup();
    await user.click(screen.getByText("set-dark"));
    expect(screen.getByTestId("mode").textContent).toBe("dark");

    // Now the stale server GET resolves with a different (light) theme.
    await act(async () => {
      getDeferred.resolve(
        new Response(JSON.stringify({ theme: { mode: "light" } }), { status: 200 }),
      );
      await getDeferred.promise;
    });

    // The user's choice must win — not silently reverted to the stale server value.
    expect(screen.getByTestId("mode").textContent).toBe("dark");
  });

  it("applies the server theme when the GET resolves before any user change", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve(
          new Response(JSON.stringify({ theme: { mode: "dark" } }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("mode").textContent).toBe("dark"));
  });

  it("surfaces exactly one toast when persisting a theme change to the server fails", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve(new Response(JSON.stringify({ theme: null }), { status: 200 }));
      }
      // PUT fails.
      return Promise.resolve(new Response(JSON.stringify({ error: "nope" }), { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByText("set-dark"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith("nope");
    // localStorage still holds the user's choice even though the server sync failed.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).mode).toBe("dark");
  });
});
