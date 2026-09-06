import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VenueSection } from "@/components/tickets/VenueSection";
import type { VenueEventSummary, VenueEventsResponse } from "@/app/api/venues/events/route";

// vi.mock must live in this file so Vitest hoists it above the sonner import below.
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

const venues = [
  {
    id: "venue-1",
    name: "Hong Kong Coliseum",
    aliases: [],
    address: null,
    city: "Hong Kong",
    country: "HK",
    tags: [],
    imageUrls: [],
    createdAt: "2025-01-01T00:00:00Z",
  },
  {
    id: "venue-2",
    name: "AsiaWorld-Expo",
    aliases: [],
    address: null,
    city: "Hong Kong",
    country: "HK",
    tags: [],
    imageUrls: [],
    createdAt: "2025-01-01T00:00:00Z",
  },
];

const concertNight: VenueEventSummary = {
  id: "event-1",
  title: "Concert Night",
  start: "2026-10-01T12:00:00.000Z",
  end: "2026-10-01T14:00:00.000Z",
  allDay: false,
  calendarName: "Tickets",
  isTicket: true,
  seat: "Block A Row 3 Seat 12",
  ticketUrl: "https://tickets.example.com/order/123",
  hasSeatMap: true,
};

const eventsResponse: VenueEventsResponse = {
  venues: [
    {
      venueId: "venue-1",
      hasSeatMap: true,
      pastCount: 3,
      upcoming: [concertNight],
    },
  ],
  unmatched: [
    { location: "Star Hall", count: 2, sampleEventId: "event-9", sampleTitle: "Some Show" },
  ],
};

function routeFetchMock(url: string, init?: RequestInit) {
  if (url === "/api/venues" && (!init || !init.method)) {
    return Promise.resolve(new Response(JSON.stringify(venues), { status: 200 }));
  }
  if (url === "/api/venues/events") {
    return Promise.resolve(new Response(JSON.stringify(eventsResponse), { status: 200 }));
  }
  if (url === "/api/venues/venue-1" && init?.method === "DELETE") {
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
}

describe("VenueSection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      return routeFetchMock(url, init);
    }) as unknown as typeof fetch);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function getVenueCard(name: string) {
    const heading = screen.getByText(name);
    const card = heading.closest("div.rounded-lg.border.border-border.bg-card");
    if (!card) throw new Error(`Could not find card for venue "${name}"`);
    return card as HTMLElement;
  }

  it("renders badges from the events payload (upcoming, ticketed, seat map, past)", async () => {
    render(<VenueSection />);

    await waitFor(() => expect(screen.getByText("Hong Kong Coliseum")).toBeInTheDocument());

    const card = getVenueCard("Hong Kong Coliseum");
    expect(within(card).getByText("1 upcoming")).toBeInTheDocument();
    expect(within(card).getByText(/1 ticketed/)).toBeInTheDocument();
    expect(within(card).getByText(/Seat map/)).toBeInTheDocument();
    expect(within(card).getByText("3 past")).toBeInTheDocument();

    // Venue with no event activity shows no badges and no disclosure.
    const otherCard = getVenueCard("AsiaWorld-Expo");
    expect(within(otherCard).queryByText(/upcoming/)).not.toBeInTheDocument();
    expect(within(otherCard).queryByText(/Show events/)).not.toBeInTheDocument();
  });

  it("expands to show seat text and a ticket link when 'Show events' is clicked", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);

    await waitFor(() => expect(screen.getByText("Hong Kong Coliseum")).toBeInTheDocument());
    const card = getVenueCard("Hong Kong Coliseum");

    const disclosure = within(card).getByRole("button", { name: /show events for hong kong coliseum/i });
    await user.click(disclosure);

    expect(within(card).getByText("Concert Night")).toBeInTheDocument();
    expect(within(card).getByText(/Seat Block A Row 3 Seat 12/)).toBeInTheDocument();
    const ticketLink = within(card).getByRole("link", { name: /ticket/i });
    expect(ticketLink).toHaveAttribute("href", "https://tickets.example.com/order/123");

    // Deep-links back into the calendar using the ?event= param it reads on mount.
    const openLink = within(card).getByRole("link", { name: /open/i });
    expect(openLink).toHaveAttribute("href", "/?event=event-1");
  });

  it("posts to /api/venues when 'Add to directory' is clicked for an unmatched location", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/venues" && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "venue-3",
              name: "Star Hall",
              aliases: [],
              address: null,
              city: "Hong Kong",
              country: "HK",
              tags: [],
              imageUrls: [],
              createdAt: "2025-01-01T00:00:00Z",
            }),
            { status: 201 },
          ),
        );
      }
      return routeFetchMock(url);
    }) as unknown as typeof fetch);

    render(<VenueSection />);

    await waitFor(() => expect(screen.getByText("Star Hall")).toBeInTheDocument());
    expect(screen.getByText("Locations in your events not in the directory")).toBeInTheDocument();

    const addButton = screen.getByRole("button", { name: /add to directory/i });
    await user.click(addButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/venues",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Star Hall" }),
        }),
      );
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("opens a confirmation dialog on delete and only deletes after confirming", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);

    await waitFor(() => expect(screen.getByText("Hong Kong Coliseum")).toBeInTheDocument());
    const card = getVenueCard("Hong Kong Coliseum");

    const deleteButton = within(card).getByRole("button", { name: /remove hong kong coliseum/i });
    await user.click(deleteButton);

    expect(fetchMock).not.toHaveBeenCalledWith("/api/venues/venue-1", expect.anything());
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/shared venue directory/i)).toBeInTheDocument();

    const confirmButton = within(dialog).getByRole("button", { name: /^remove$/i });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/venues/venue-1", { method: "DELETE" });
    });
    await waitFor(() => expect(screen.queryByText("Hong Kong Coliseum")).not.toBeInTheDocument());
  });
});
