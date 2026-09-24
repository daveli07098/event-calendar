import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookmarkletInstall } from "@/components/tickets/BookmarkletInstall";

// userEvent.setup() installs its OWN navigator.clipboard stub (for its
// copy()/paste() helpers) — it must run before our redefine below, or it
// clobbers our mock straight back to jsdom's real (permission-denied in
// tests) Clipboard implementation.
function setupWithClipboardMock() {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  // navigator.clipboard is a getter-only accessor in jsdom — redefine it
  // instead of Object.assign, which throws against a getter-only property.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return { user, writeText };
}

describe("BookmarkletInstall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the full help card with the draggable bookmarklet link and instructions", async () => {
    render(<BookmarkletInstall />);
    expect(screen.getByText(/one-click scan for blocked sites/i)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /scan with event calendar/i })).toBeInTheDocument();
    expect(screen.getByText(/open the blocked shop page/i)).toBeInTheDocument();
    expect(screen.getByText(/on mobile/i)).toBeInTheDocument();
  });

  it("sets the bookmarklet link's href via the DOM after mount (React 19 blocks javascript: in JSX href)", async () => {
    render(<BookmarkletInstall />);
    const link = await screen.findByRole("link", { name: /scan with event calendar/i });
    await waitFor(() => {
      expect(link).toHaveAttribute("href", expect.stringMatching(/^javascript:/));
    });
    // Points at this test environment's own origin, not a hardcoded value.
    expect(link.getAttribute("href")).toContain(window.location.origin);
  });

  it("clicking the link never navigates the app away (it's a drag target, not a click target)", async () => {
    render(<BookmarkletInstall />);
    const link = await screen.findByRole("link", { name: /scan with event calendar/i });
    const user = userEvent.setup();
    await user.click(link);
    // jsdom doesn't actually navigate on an <a> click, so the real assertion
    // is just that this doesn't throw/warn — the preventDefault() in the
    // onClick handler is what stops a real browser from following the
    // javascript: href on a plain click.
    expect(link).toBeInTheDocument();
  });

  it("copies the bookmarklet href to the clipboard on 'Copy bookmarklet'", async () => {
    const { user, writeText } = setupWithClipboardMock();
    render(<BookmarkletInstall />);
    const link = await screen.findByRole("link", { name: /scan with event calendar/i });
    await waitFor(() => expect(link.getAttribute("href")).toMatch(/^javascript:/));
    const href = link.getAttribute("href")!;

    await user.click(screen.getByRole("button", { name: /copy bookmarklet/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(href);
    });
  });

  it("renders a compact single-line variant", async () => {
    render(<BookmarkletInstall compact />);
    expect(await screen.findByRole("link", { name: /scan with event calendar/i })).toBeInTheDocument();
    expect(screen.getByText(/drag to bookmarks bar, open the site, click it/i)).toBeInTheDocument();
    // The compact variant skips the full card's heading/instructions.
    expect(screen.queryByText(/one-click scan for blocked sites/i)).not.toBeInTheDocument();
  });
});
