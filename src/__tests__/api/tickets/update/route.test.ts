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

  // --- Timezone data-corruption fix: sourceTimezone must win over tzOffsetMinutes ---
  describe("sourceTimezone precedence (Cause B fix)", () => {
    it("uses ticket.sourceTimezone, not the client's tzOffsetMinutes, when applying a date/time change", async () => {
      const ownEvent = withCalendar(
        mockEvent({ id: "evt-own", calendarId: "cal-1" }),
        { userId: "user-1" }
      );
      prismaMock.event.findMany.mockResolvedValue([ownEvent]);
      prismaMock.event.update.mockResolvedValue(mockEvent({ id: "evt-own", calendarId: "cal-1" }));

      const jstTicket = { ...baseTicket, date: "2026-07-31", time: "12:00", sourceTimezone: "+09:00" };

      await PATCH(
        makeReq({
          eventId: "evt-own",
          appliedFields: ["date", "time"],
          ticket: jstTicket,
          // Client is on HKT (+08:00) → getTimezoneOffset() = -480. If this were
          // used instead of sourceTimezone, 12:00 would wrongly become 04:00Z
          // (the exact reported bug) instead of the correct 03:00Z.
          tzOffsetMinutes: -480,
        })
      );

      expect(prismaMock.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "evt-own" },
          data: expect.objectContaining({ startTime: new Date("2026-07-31T03:00:00.000Z") }),
        })
      );
    });

    it("falls back to tzOffsetMinutes when sourceTimezone is unknown (no regression)", async () => {
      const ownEvent = withCalendar(
        mockEvent({ id: "evt-own", calendarId: "cal-1" }),
        { userId: "user-1" }
      );
      prismaMock.event.findMany.mockResolvedValue([ownEvent]);
      prismaMock.event.update.mockResolvedValue(mockEvent({ id: "evt-own", calendarId: "cal-1" }));

      const unresolvedTicket = { ...baseTicket, date: "2026-07-31", time: "12:00", sourceTimezone: null };

      await PATCH(
        makeReq({
          eventId: "evt-own",
          appliedFields: ["date", "time"],
          ticket: unresolvedTicket,
          tzOffsetMinutes: -480, // HKT
        })
      );

      // 12:00 HKT (client) with no known source timezone → 04:00Z, unchanged behavior.
      expect(prismaMock.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "evt-own" },
          data: expect.objectContaining({ startTime: new Date("2026-07-31T04:00:00.000Z") }),
        })
      );
    });

    it("does not re-offset an unchanged stored time when only the date is applied", async () => {
      // Existing stored startTime is 2025-01-15T10:00:00Z (from mockEvent default).
      const ownEvent = withCalendar(
        mockEvent({ id: "evt-own", calendarId: "cal-1", startTime: new Date("2025-01-15T10:00:00.000Z") }),
        { userId: "user-1" }
      );
      prismaMock.event.findMany.mockResolvedValue([ownEvent]);
      prismaMock.event.update.mockResolvedValue(mockEvent({ id: "evt-own", calendarId: "cal-1" }));

      const jstTicket = { ...baseTicket, date: "2026-07-31", time: "12:00", sourceTimezone: "+09:00" };

      await PATCH(
        makeReq({
          eventId: "evt-own",
          appliedFields: ["date"], // date only — time is NOT applied
          ticket: jstTicket,
          tzOffsetMinutes: -480,
        })
      );

      // Date changes to 2026-07-31 but the stored 10:00 UTC time-of-day must be
      // preserved verbatim — NOT reinterpreted as venue-local time and re-offset.
      expect(prismaMock.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "evt-own" },
          data: expect.objectContaining({ startTime: new Date("2026-07-31T10:00:00.000Z") }),
        })
      );
    });
  });
});
