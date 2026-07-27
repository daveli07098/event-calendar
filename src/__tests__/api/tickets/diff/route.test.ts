import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  prismaMock,
  setMockSession,
  mockSession,
  getMockSession,
  mockCalendar,
  mockEvent,
} from "../../../helpers";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { POST } from "@/app/api/tickets/diff/route";

const TICKET_URL = "https://www.livenationhip.co.jp/some-show";

const baseTicket = {
  title: "Test Show",
  date: "2026-07-31",
  time: "12:00", // venue wall-clock (JST) as freshly scraped — unchanged either way
  venue: "Test Venue",
  location: "Test City",
  description: "A great show",
  ticketPrices: null,
  ticketPlatforms: null,
  saleDate: null,
  saleFirstDate: null,
  saleDates: null,
  sourceUrl: TICKET_URL,
  category: null,
  sourceTimezone: "+09:00" as string | null,
};

function makeReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/tickets/diff", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/tickets/diff — venue-timezone-aware comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.calendar.findMany.mockResolvedValue([mockCalendar({ id: "cal-1", name: "event-reminders" })]);
  });

  it("acceptance criterion: an already-corrupted stored instant (04:00Z, should be 03:00Z for 12:00 JST) is surfaced as a real change, not 'no change'", async () => {
    // Corrupted row: 12:00 was interpreted in the client's HKT (+08:00) instead
    // of the venue's JST (+09:00) → stored as 04:00Z instead of the correct 03:00Z.
    const corruptedEvent = {
      ...mockEvent({
        id: "evt-1",
        calendarId: "cal-1",
        startTime: new Date("2026-07-31T04:00:00.000Z"),
        description: `A great show\n\nTicket URL: ${TICKET_URL}`,
      }),
      calendar: mockCalendar({ id: "cal-1", name: "event-reminders" }),
    };
    prismaMock.event.findMany.mockResolvedValue([corruptedEvent]);

    const res = await POST(
      makeReq({ url: TICKET_URL, ticket: baseTicket, tzOffsetMinutes: -480 })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasChanges).toBe(true);
    const timeChange = json.changes.find((c: { field: string }) => c.field === "time");
    expect(timeChange).toBeDefined();
    // Stored 04:00Z read back in the venue's zone (+09:00) is 13:00 — visibly
    // different from the freshly-scraped 12:00, so the discrepancy is exposed
    // and the user can repair it by re-syncing (Apply → update route, Cause B fix).
    expect(timeChange.oldValue).toBe("13:00");
    expect(timeChange.newValue).toBe("12:00");
  });

  it("false-positive fix: a correctly-stored non-HK (JST) event reports NO change on sync", async () => {
    // Correctly stored: 12:00 JST == 03:00Z.
    const correctEvent = {
      ...mockEvent({
        id: "evt-2",
        calendarId: "cal-1",
        startTime: new Date("2026-07-31T03:00:00.000Z"),
        description: `A great show\n\nTicket URL: ${TICKET_URL}`,
      }),
      calendar: mockCalendar({ id: "cal-1", name: "event-reminders" }),
    };
    prismaMock.event.findMany.mockResolvedValue([correctEvent]);

    const res = await POST(
      makeReq({ url: TICKET_URL, ticket: baseTicket, tzOffsetMinutes: -480 })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    const timeChange = json.changes.find((c: { field: string }) => c.field === "time");
    expect(timeChange).toBeUndefined();
    expect(json.hasChanges).toBe(false);
  });

  it("falls back to the client's tzOffsetMinutes when sourceTimezone is unknown (no regression)", async () => {
    const event = {
      ...mockEvent({
        id: "evt-3",
        calendarId: "cal-1",
        startTime: new Date("2026-07-31T04:00:00.000Z"), // 12:00 HKT
        description: `A great show\n\nTicket URL: ${TICKET_URL}`,
      }),
      calendar: mockCalendar({ id: "cal-1", name: "event-reminders" }),
    };
    prismaMock.event.findMany.mockResolvedValue([event]);

    // sourceUrl (used for the domain/title fallback) must itself be genuinely
    // unresolvable here — reusing TICKET_URL (a .co.jp domain) would no longer
    // exercise "unknown", now that the route re-derives from the domain too.
    // `url`/the stored event's "Ticket URL:" line stay on TICKET_URL so the
    // lookup still matches; only the ticket's own sourceUrl changes.
    const ticketNoTz = {
      ...baseTicket,
      time: "12:00",
      sourceTimezone: null,
      sourceUrl: "https://www.some-random-ticket-site.com/event/1",
    };
    const res = await POST(
      makeReq({ url: TICKET_URL, ticket: ticketNoTz, tzOffsetMinutes: -480 })
    );

    const json = await res.json();
    const timeChange = json.changes.find((c: { field: string }) => c.field === "time");
    expect(timeChange).toBeUndefined();
    expect(json.hasChanges).toBe(false);
  });
});
