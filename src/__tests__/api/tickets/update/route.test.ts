import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  prismaMock,
  setMockSession,
  mockSession,
  getMockSession,
  mockCalendar,
  mockEvent,
  mockMember,
} from "../../../helpers";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { PATCH } from "@/app/api/tickets/update/route";

// Minimal ScrapedTicket fixture — fields the route reads while building
// descriptions/dates. Kept deliberately plain (no date/time-changing fields
// applied) except where a specific test needs them.
const baseTicket = {
  title: "Test Show",
  date: "2025-06-01",
  time: "20:00",
  venue: "Test Venue",
  location: "Test City",
  description: "A great show",
  ticketPrices: ["$100"],
  ticketPlatforms: ["Platform"],
  saleDate: null,
  saleFirstDate: null,
  saleDates: null,
  sourceUrl: "https://example.com/ticket",
  category: null,
  country: null,
};

function makeReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/tickets/update", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** A candidate event row as returned by the batched authorization findMany:
 * the event joined with its calendar + the caller's own membership row. */
function withCalendar(
  event: ReturnType<typeof mockEvent>,
  calendarOverrides: Record<string, unknown> = {},
  members: ReturnType<typeof mockMember>[] = []
) {
  return {
    ...event,
    calendar: { ...mockCalendar({ id: event.calendarId as string, ...calendarOverrides }), members },
  };
}

describe("PATCH /api/tickets/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await PATCH(
      makeReq({ eventId: "evt-own", appliedFields: ["description"], ticket: baseTicket })
    );
    expect(res.status).toBe(401);
  });

  it("blocks the exploit: own eventId + a saleEventId on an inaccessible calendar is rejected, no write happens", async () => {
    const ownEvent = withCalendar(
      mockEvent({ id: "evt-own", calendarId: "cal-1" }),
      { userId: "user-1" }
    );
    // Victim's event lives on a calendar the caller has no access to at all.
    const victimEvent = withCalendar(
      mockEvent({ id: "evt-victim", calendarId: "cal-victim" }),
      { userId: "user-2", shareMode: null },
      []
    );
    prismaMock.event.findMany.mockResolvedValue([ownEvent, victimEvent]);

    const res = await PATCH(
      makeReq({
        eventId: "evt-own",
        saleEventId: "evt-victim",
        appliedFields: ["saleDate"],
        ticket: baseTicket,
      })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found or access denied" });
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });

  it("blocks the exploit via presaleEventId on an inaccessible calendar", async () => {
    const ownEvent = withCalendar(
      mockEvent({ id: "evt-own", calendarId: "cal-1" }),
      { userId: "user-1" }
    );
    const victimEvent = withCalendar(
      mockEvent({ id: "evt-victim", calendarId: "cal-victim" }),
      { userId: "user-2", shareMode: null },
      []
    );
    prismaMock.event.findMany.mockResolvedValue([ownEvent, victimEvent]);

    const res = await PATCH(
      makeReq({
        eventId: "evt-own",
        presaleEventId: "evt-victim",
        appliedFields: ["saleFirstDate"],
        ticket: baseTicket,
      })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found or access denied" });
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });

  it("blocks the exploit via a value inside saleEventIds on an inaccessible calendar", async () => {
    const ownEvent = withCalendar(
      mockEvent({ id: "evt-own", calendarId: "cal-1" }),
      { userId: "user-1" }
    );
    const victimEvent = withCalendar(
      mockEvent({ id: "evt-victim", calendarId: "cal-victim" }),
      { userId: "user-2", shareMode: null },
      []
    );
    prismaMock.event.findMany.mockResolvedValue([ownEvent, victimEvent]);

    const res = await PATCH(
      makeReq({
        eventId: "evt-own",
        saleEventIds: { "Public Sale": "evt-victim" },
        appliedFields: ["saleWin::Public Sale"],
        ticket: baseTicket,
      })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found or access denied" });
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });

  it("allows a legitimate owner-driven update", async () => {
    const ownEvent = withCalendar(
      mockEvent({ id: "evt-own", calendarId: "cal-1" }),
      { userId: "user-1" }
    );
    prismaMock.event.findMany.mockResolvedValue([ownEvent]);
    prismaMock.event.update.mockResolvedValue(mockEvent({ id: "evt-own", calendarId: "cal-1" }));

    const res = await PATCH(
      makeReq({ eventId: "evt-own", appliedFields: ["description"], ticket: baseTicket })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(true);
    expect(json.eventId).toBe("evt-own");
    expect(prismaMock.event.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "evt-own" } })
    );
  });

  it("allows a collaborative editor on a shared calendar to update (fix must not over-restrict)", async () => {
    const sharedEvent = withCalendar(
      mockEvent({ id: "evt-shared", calendarId: "cal-shared" }),
      { userId: "user-2", shareMode: "collaborative" },
      [mockMember({ userId: "user-1", role: "editor" })]
    );
    prismaMock.event.findMany.mockResolvedValue([sharedEvent]);
    prismaMock.event.update.mockResolvedValue(mockEvent({ id: "evt-shared", calendarId: "cal-shared" }));

    const res = await PATCH(
      makeReq({ eventId: "evt-shared", appliedFields: ["description"], ticket: baseTicket })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(true);
    expect(json.eventId).toBe("evt-shared");
  });

  it("rejects a viewer (role 'viewer') on a collaborative calendar", async () => {
    const sharedEvent = withCalendar(
      mockEvent({ id: "evt-shared", calendarId: "cal-shared" }),
      { userId: "user-2", shareMode: "collaborative" },
      [mockMember({ userId: "user-1", role: "viewer" })]
    );
    prismaMock.event.findMany.mockResolvedValue([sharedEvent]);

    const res = await PATCH(
      makeReq({ eventId: "evt-shared", appliedFields: ["description"], ticket: baseTicket })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found or access denied" });
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });

  it("rejects an editor member on a 'broadcast' (non-collaborative) calendar", async () => {
    const broadcastEvent = withCalendar(
      mockEvent({ id: "evt-broadcast", calendarId: "cal-broadcast" }),
      { userId: "user-2", shareMode: "broadcast" },
      [mockMember({ userId: "user-1", role: "editor" })]
    );
    prismaMock.event.findMany.mockResolvedValue([broadcastEvent]);

    const res = await PATCH(
      makeReq({ eventId: "evt-broadcast", appliedFields: ["description"], ticket: baseTicket })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found or access denied" });
    expect(prismaMock.event.update).not.toHaveBeenCalled();
  });
});
