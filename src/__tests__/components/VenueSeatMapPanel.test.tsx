import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VenueSection } from "@/components/tickets/VenueSection";
import { invalidateVenueSeatMapsCache } from "@/lib/venue-seatmap/use-venue-seatmaps";
import { validateSeatMapConfig } from "@/lib/venue-seatmap/validate";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";
import type { VenueEventSummary, VenueEventsResponse } from "@/app/api/venues/events/route";
import type { VenueSeatMapListEntry } from "@/app/api/venues/seatmaps/route";

// Mounting the panel (dynamic imports, several fetch round-trips) is slow when the whole
// suite runs in parallel; the default 5 s limit made these flaky there, not in isolation.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

// The real maps pull in SVG geometry / three.js; stubs expose which config they were given.
vi.mock("@/components/venue/SeatMap", () => ({
  SeatMap: ({ config, seat }: { config?: { id: string } | null; seat?: { raw: string } | null }) => (
    <div data-testid="seatmap-2d-stub" data-config={config?.id ?? ""} data-seat={seat?.raw ?? ""} />
  ),
}));
vi.mock("@/components/venue/SeatMap3D", () => ({
  SeatMap3D: ({ config }: { config?: { id: string } | null }) => <div data-testid="seatmap-3d-stub" data-config={config?.id ?? ""} />,
}));

const arenaConfig: VenueSeatMapConfig = {
  id: "venue-arena",
  name: "Test Arena",
  aliases: ["Test Arena"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "bowl-end-stage",
  levels: [
    {
      id: "l1",
      label: "Level 1",
      tier: 1,
      radiusRange: [0.1, 0.9],
      blockNumberRanges: [{ min: 1, max: 20, positionConfidence: "confirmed" }],
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
};

const venues = [
  { id: "venue-kt", name: "Kai Tak Stadium", aliases: [], address: null, city: "Hong Kong", country: "HK", tags: [], imageUrls: [], createdAt: "2025-01-01T00:00:00Z" },
  { id: "venue-arena", name: "Test Arena", aliases: [], address: null, city: "Hong Kong", country: "HK", tags: [], imageUrls: [], createdAt: "2025-01-01T00:00:00Z" },
  { id: "venue-draft", name: "Draft Hall", aliases: [], address: null, city: "Hong Kong", country: "HK", tags: [], imageUrls: [], createdAt: "2025-01-01T00:00:00Z" },
  { id: "venue-new", name: "Empty Theatre", aliases: [], address: null, city: "Hong Kong", country: "HK", tags: [], imageUrls: [], createdAt: "2025-01-01T00:00:00Z" },
];

const seatMaps: VenueSeatMapListEntry[] = [
  { venueId: "venue-arena", venueName: "Test Arena", aliases: [], status: "approved", source: "user", planUrl: "https://blob.example.com/plan.png", updatedAt: "2026-09-01T00:00:00.000Z", config: arenaConfig },
  { venueId: "venue-draft", venueName: "Draft Hall", aliases: [], status: "draft", source: "ai-draft", planUrl: null, updatedAt: "2026-09-02T00:00:00.000Z", config: { ...arenaConfig, id: "venue-draft", name: "Draft Hall", aliases: ["Draft Hall"] } },
];

const ktEvent: VenueEventSummary = {
  id: "ev-kt",
  title: "Stadium Concert",
  start: "2026-11-01T12:00:00.000Z",
  end: "2026-11-01T14:00:00.000Z",
  allDay: false,
  calendarName: "Tickets",
  isTicket: true,
  seat: "Block 109·RowJ·Seat223 Block 225·RowJ·Seat78",
  ticketUrl: null,
  hasSeatMap: true,
};

const eventsResponse: VenueEventsResponse = {
  venues: [{ venueId: "venue-kt", hasSeatMap: true, pastCount: 0, upcoming: [ktEvent] }],
  unmatched: [],
};

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

let fetchMock: ReturnType<typeof vi.fn>;
const calls = (pred: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([u, init]) => pred(String(u), init as RequestInit | undefined));

beforeEach(() => {
  vi.clearAllMocks();
  invalidateVenueSeatMapsCache();
  fetchMock = vi.fn(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url === "/api/venues" && method === "GET") return json(venues);
    if (url === "/api/venues/events") return json(eventsResponse);
    if (url === "/api/venues/seatmaps") return json({ venues: seatMaps });
    if (url === "/api/venues/venue-new/seatmap/plan" && method === "POST") return json({ planUrl: "https://blob.example.com/new-plan.png" });
    if (url === "/api/venues/venue-draft/seatmap/plan" && method === "POST") return json({ planUrl: JSON.parse(String(init?.body)).url });
    if (url === "/api/venues/venue-draft/seatmap/draft" && method === "POST") return json({ draft: { ...arenaConfig, id: "venue-draft", name: "Draft Hall" }, warnings: ["1 block range(s) have unconfirmed position — review before approving."] });
    if (url.endsWith("/seatmap") && method === "PUT") {
      const body = JSON.parse(String(init?.body));
      return json({ venueId: "x", config: body.config, status: body.status, source: body.source ?? "user", planUrl: null, updatedBy: "someone@example.com", updatedAt: "2026-09-24T00:00:00.000Z" });
    }
    return json({}, 404);
  }) as unknown as typeof fetch);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openPanel(user: ReturnType<typeof userEvent.setup>, name: string) {
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  const toggle = await screen.findByRole("button", { name: new RegExp(`show seat map for ${name}`, "i") });
  await user.click(toggle);
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(panel).toBeVisible();
  return { toggle, panel };
}

describe("venue seat-map panel", () => {
  it("fixture config is valid", () => {
    expect(validateSeatMapConfig(arenaConfig).ok).toBe(true);
  });

  it("shows a status chip per venue", async () => {
    render(<VenueSection />);
    await waitFor(() => expect(screen.getByRole("button", { name: /seat map for test arena/i })).toHaveTextContent("Approved"));
    expect(screen.getByRole("button", { name: /seat map for kai tak stadium/i })).toHaveTextContent("Built-in");
    expect(screen.getByRole("button", { name: /seat map for draft hall/i })).toHaveTextContent("Draft");
    expect(screen.getByRole("button", { name: /seat map for empty theatre/i })).toHaveTextContent("No seat map");
  });

  it("toggles with aria-expanded and keeps the panel mounted when collapsed", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { toggle, panel } = await openPanel(user, "Empty Theatre");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
  });

  it("uploads a plan to the plan route and previews it", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { panel } = await openPanel(user, "Empty Theatre");
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["png"], "plan.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(calls((u, i) => u === "/api/venues/venue-new/seatmap/plan" && i?.method === "POST")).toHaveLength(1));
    const [, init] = calls((u) => u === "/api/venues/venue-new/seatmap/plan")[0];
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(await within(panel).findAllByAltText(/seating plan for empty theatre/i)).not.toHaveLength(0);
    expect(within(panel).getByRole("button", { name: /draft with ai/i })).toBeEnabled();
  });

  it("disables Draft with AI until a plan exists", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { panel } = await openPanel(user, "Empty Theatre");
    expect(within(panel).getByRole("button", { name: /draft with ai/i })).toBeDisabled();
  });

  it("drafts via the draft route, shows warnings and renders the preview from the draft", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    // Draft Hall has a saved draft config but no plan; give it one via the link form first.
    const { panel } = await openPanel(user, "Draft Hall");
    await user.type(within(panel).getByLabelText(/seating plan link for draft hall/i), "https://blob.example.com/hall.pdf");
    await user.click(within(panel).getByRole("button", { name: /use link/i }));
    expect(await within(panel).findAllByText(/seating plan \(pdf\)/i)).not.toHaveLength(0);

    await user.type(within(panel).getByLabelText(/notes for the ai draft/i), "stage at the north end");
    await user.click(within(panel).getByRole("button", { name: /draft with ai/i }));

    await waitFor(() => expect(calls((u) => u === "/api/venues/venue-draft/seatmap/draft")).toHaveLength(1));
    const [, init] = calls((u) => u === "/api/venues/venue-draft/seatmap/draft")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ planUrl: "https://blob.example.com/hall.pdf", notes: "stage at the north end" });
    expect(await within(panel).findByText(/unconfirmed position — review before approving/i)).toBeInTheDocument();
    // A sample seat is filled in so the preview renders straight away, from the draft config.
    const map = await within(panel).findByTestId("seatmap-2d-stub");
    expect(map).toHaveAttribute("data-config", "venue-draft");
    expect(within(panel).getByTestId("seatmap-summary")).toHaveTextContent("Level 1");
  });

  it("shows validator errors for invalid JSON edits and blocks saving", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { panel } = await openPanel(user, "Draft Hall");
    await user.click(within(panel).getByRole("button", { name: /advanced: edit json/i }));
    const textarea = within(panel).getByLabelText(/seat-map config json/i);

    fireEvent.change(textarea, { target: { value: "{ not json" } });
    expect(within(panel).getByText(/json syntax error/i)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /save draft/i })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: /approve for tickets/i })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: JSON.stringify({ ...arenaConfig, levels: "nope" }) } });
    expect(within(panel).getByText(/levels/i, { selector: "li" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /approve for tickets/i })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: JSON.stringify(arenaConfig) } });
    expect(within(panel).getByText(/valid config/i)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /approve for tickets/i })).toBeEnabled();
  });

  it("approve PUTs status approved and updates the chip", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { toggle, panel } = await openPanel(user, "Draft Hall");
    await user.click(within(panel).getByRole("button", { name: /approve for tickets/i }));

    await waitFor(() => expect(calls((u, i) => u === "/api/venues/venue-draft/seatmap" && i?.method === "PUT")).toHaveLength(1));
    const [, init] = calls((u, i) => u === "/api/venues/venue-draft/seatmap" && i?.method === "PUT")[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.status).toBe("approved");
    expect(body.config.id).toBe("venue-draft");
    await waitFor(() => expect(toggle).toHaveTextContent("Approved"));
    expect(within(panel).getByText(/by someone@example.com/)).toBeInTheDocument();
  });

  it("test seat box renders the breakdown and projects it", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { panel } = await openPanel(user, "Kai Tak Stadium");
    const box = within(panel).getByRole("textbox", { name: /^test seat$/i });
    expect(box).toHaveAttribute("id", "venue-seatmap-test-seat-venue-kt");
    await user.type(box, "Level 2 Block 225 Row J Seat 78");
    expect(within(panel).getByTestId("seat-breakdown")).toHaveTextContent("Block 225");
    const map = await within(panel).findByTestId("seatmap-2d-stub");
    expect(map).toHaveAttribute("data-config", "kai-tak-stadium");
    // Built-in venues are read-only.
    expect(within(panel).queryByRole("button", { name: /approve for tickets/i })).not.toBeInTheDocument();
  });

  it("lists this venue's tickets, one row per seat, and View seat fills the test box", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { panel } = await openPanel(user, "Kai Tak Stadium");
    const viewButtons = await within(panel).findAllByRole("button", { name: /^view seat/i });
    expect(viewButtons).toHaveLength(2);
    await user.click(viewButtons[1]);
    expect(within(panel).getByRole("textbox", { name: /^test seat$/i })).toHaveValue("Block 225·RowJ·Seat78");
  });
  it("explains a 429 quota error from the draft route", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { panel } = await openPanel(user, "Draft Hall");
    await user.type(within(panel).getByLabelText(/seating plan link for draft hall/i), "https://blob.example.com/hall.png");
    await user.click(within(panel).getByRole("button", { name: /use link/i }));
    await within(panel).findAllByAltText(/seating plan for draft hall/i);
    fetchMock.mockImplementationOnce(() => json({ error: "Daily AI limit reached (20/day)", resetAt: "2026-09-25T00:00:00.000Z" }, 429));
    await user.click(within(panel).getByRole("button", { name: /draft with ai/i }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/daily ai limit reached \(20\/day\)\. try again after/i);
  });

  it("theatre configs explain that 3D isn't available but still allow saving", async () => {
    const user = userEvent.setup();
    render(<VenueSection />);
    const { panel } = await openPanel(user, "Draft Hall");
    await user.click(within(panel).getByRole("button", { name: /advanced: edit json/i }));
    fireEvent.change(within(panel).getByLabelText(/seat-map config json/i), {
      target: { value: JSON.stringify({ ...arenaConfig, id: "venue-draft", layout: "theatre" }) },
    });
    expect(within(panel).getByText(/3D isn't available yet for theatres/i)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "3D" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /save draft/i })).toBeEnabled();
  });
});
