import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { HomeDashboard } from "@/components/home/HomeDashboard";

const TZ = "Asia/Hong_Kong";
const NOW = "2026-10-26T02:00:00Z"; // 10:00 HK, Monday

const base = {
  firstName: "Dave",
  nowIso: NOW,
  timeZone: TZ,
  events: [],
  countdowns: [],
  bookmarks: [],
  notes: [],
};

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("HomeDashboard", () => {
  it("renders the greeting, date and summary", () => {
    render(<HomeDashboard {...base} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good morning, Dave");
    expect(screen.getByText("Monday 26 October")).toBeTruthy();
    expect(screen.getByText("Nothing on today")).toBeTruthy();
  });

  it("shows countdown tiles and the empty hint", () => {
    const { unmount } = render(<HomeDashboard {...base} />);
    expect(screen.getByText(/Pin an event from its bookmark/)).toBeTruthy();
    unmount();
    render(
      <HomeDashboard
        {...base}
        countdowns={[
          { eventId: "a", title: "NCT 127", start: "2026-11-07T10:00:00Z", allDay: false, color: "#f00", countdown: true },
          { eventId: "b", title: "Gig", start: "2026-10-26T10:00:00Z", allDay: false, color: "#0f0", countdown: true },
        ]}
      />,
    );
    const tiles = screen.getAllByTestId("countdown-tile");
    expect(tiles[0].textContent).toContain("12");
    expect(tiles[0].textContent).toContain("NCT 127");
    expect(tiles[1].textContent).toContain("Today!");
  });

  it("saves a URL note optimistically and links to the Event Section", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "n1", text: "https://e.com/x", url: "https://e.com/x" }),
    });
    render(<HomeDashboard {...base} />);
    fireEvent.change(screen.getByLabelText("Quick note"), { target: { value: "https://e.com/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const link = await screen.findByText("Scan in Event Section →");
    expect(link.getAttribute("href")).toBe(`/tickets?url=${encodeURIComponent("https://e.com/x")}`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notes");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: "https://e.com/x" });
  });

  it("checks off a note", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<HomeDashboard {...base} notes={[{ id: "n1", text: "buy milk" }]} />);
    fireEvent.click(screen.getByLabelText("Mark done: buy milk"));
    expect(screen.queryByText("buy milk")).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notes/n1");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
  });

  it("pins a bookmark as a countdown", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(
      <HomeDashboard
        {...base}
        bookmarks={[{ eventId: "a", title: "NCT 127", start: "2026-11-07T10:00:00Z", allDay: false, color: "#f00", countdown: false }]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Pin countdown for NCT 127"));
    expect(await screen.findByTestId("countdown-tile")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/bookmarks/a/countdown");
  });
});
