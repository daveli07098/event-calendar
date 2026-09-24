import { describe, it, expect, beforeEach } from "vitest";
import { setMockSession, mockSession, getMockSession, mockCalendar, mockEvent } from "../helpers";

// The shared `prismaMock` in ../helpers.ts doesn't include an `eventVenue` model (no other
// route needed it before this one), so this file defines its own minimal mock following the
// same `createMockModel()` pattern as helpers.ts rather than editing the shared fixture.
// `vi.hoisted` is required (rather than a plain top-level const) because `vi.mock`'s factory
// below is hoisted above this file's other imports/statements by Vitest.
const prismaMock = vi.hoisted(() => {
  function createMockModel() {
    return {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    };
  }
  return {
    calendar: createMockModel(),
    calendarMember: createMockModel(),
    event: createMockModel(),
    eventVenue: createMockModel(),
  };
});

// vi.mock must live in this file (not a helper) so Vitest hoists it above the route import
// below — see the comment in ../helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { GET } from "@/app/api/venues/events/route";

const KAI_TAK_VENUE = { id: "kai-tak", name: "啟德體育園 主場館", aliases: [] as string[] };

describe("GET /api/venues/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    // accessibleCalendarIds() combines owned calendars + shared memberships.
    prismaMock.calendar.findMany.mockResolvedValue([mockCalendar({ id: "cal-1" })]);
    prismaMock.calendarMember.findMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("groups matched events by venue, flags tickets/seats/seat-maps, and buckets unmatched text", async () => {
    const now = Date.now();
    const future1 = new Date(now + 7 * 24 * 60 * 60 * 1000);
    const future2 = new Date(now + 14 * 24 * 60 * 60 * 1000);
    const futureUnmatched = new Date(now + 3 * 24 * 60 * 60 * 1000);

    const events = [
      // event-reminders (ticket) event with a Seat: and Ticket URL: line in its description.
      mockEvent({
        id: "evt-1",
        calendarId: "cal-1",
        title: "Concert A",
        location: "啟德體育園主場館, Hong Kong",
        description:
          "Some details\nSeat: Level 5 Block 519B Row M Seat 547\nTicket URL: https://example.com/t1",
        startTime: future1,
        endTime: new Date(future1.getTime() + 2 * 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "event-reminders" }),
      }),
      // Regular (non-ticket) calendar event at the same venue, written without the comma suffix.
      mockEvent({
        id: "evt-2",
        calendarId: "cal-1",
        title: "Concert B",
        location: "啟德體育園主場館",
        description: null,
        startTime: future2,
        endTime: new Date(future2.getTime() + 2 * 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "My Calendar" }),
      }),
      // Upcoming event whose location matches nothing in the venue directory.
      mockEvent({
        id: "evt-3",
        calendarId: "cal-1",
        title: "Random Show",
        location: "Some Random Hall",
        description: null,
        startTime: futureUnmatched,
        endTime: new Date(futureUnmatched.getTime() + 2 * 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "My Calendar" }),
      }),
    ];

    prismaMock.event.findMany.mockResolvedValue(events);
    prismaMock.eventVenue.findMany.mockResolvedValue([KAI_TAK_VENUE]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.venues).toHaveLength(1);
    const venue = body.venues[0];
    expect(venue.venueId).toBe("kai-tak");
    // "啟德體育園" is one of Kai Tak Stadium's registered seat-map aliases.
    expect(venue.hasSeatMap).toBe(true);
    expect(venue.pastCount).toBe(0);
    expect(venue.upcoming).toHaveLength(2);

    const evt1 = venue.upcoming.find((e: { id: string }) => e.id === "evt-1");
    expect(evt1).toMatchObject({
      isTicket: true,
      seat: "Level 5 Block 519B Row M Seat 547",
      ticketUrl: "https://example.com/t1",
      hasSeatMap: true,
      calendarName: "event-reminders",
    });

    const evt2 = venue.upcoming.find((e: { id: string }) => e.id === "evt-2");
    expect(evt2).toMatchObject({
      isTicket: false,
      seat: null,
      ticketUrl: null,
      calendarName: "My Calendar",
    });

    expect(body.unmatched).toEqual([
      { location: "Some Random Hall", count: 1, sampleEventId: "evt-3", sampleTitle: "Random Show" },
    ]);
  });

  it("flags hasSeatMap for a venue with an approved community seat-map config, even with no built-in match", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const communityVenue = { id: "community-1", name: "Some Random Hall", aliases: [] as string[], seatMapStatus: "approved" };
    prismaMock.event.findMany.mockResolvedValue([
      mockEvent({
        id: "evt-community",
        calendarId: "cal-1",
        location: "Some Random Hall",
        startTime: future,
        endTime: new Date(future.getTime() + 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "My Calendar" }),
      }),
    ]);
    prismaMock.eventVenue.findMany.mockResolvedValue([communityVenue]);

    const res = await GET();
    const body = await res.json();
    expect(body.venues).toHaveLength(1);
    expect(body.venues[0].hasSeatMap).toBe(true);
    expect(body.venues[0].upcoming[0].hasSeatMap).toBe(true);
  });

  it("does not flag hasSeatMap for a venue with only a DRAFT (not approved) community config", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const communityVenue = { id: "community-2", name: "Some Random Hall", aliases: [] as string[], seatMapStatus: "draft" };
    prismaMock.event.findMany.mockResolvedValue([
      mockEvent({
        id: "evt-community-2",
        calendarId: "cal-1",
        location: "Some Random Hall",
        startTime: future,
        endTime: new Date(future.getTime() + 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "My Calendar" }),
      }),
    ]);
    prismaMock.eventVenue.findMany.mockResolvedValue([communityVenue]);

    const res = await GET();
    const body = await res.json();
    expect(body.venues).toHaveLength(1);
    expect(body.venues[0].hasSeatMap).toBe(false);
  });

  it("counts past matched events without listing them in upcoming", async () => {
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const events = [
      mockEvent({
        id: "evt-old",
        calendarId: "cal-1",
        location: "啟德體育園主場館",
        startTime: past,
        endTime: new Date(past.getTime() + 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "My Calendar" }),
      }),
    ];
    prismaMock.event.findMany.mockResolvedValue(events);
    prismaMock.eventVenue.findMany.mockResolvedValue([KAI_TAK_VENUE]);

    const res = await GET();
    const body = await res.json();
    expect(body.venues).toHaveLength(1);
    expect(body.venues[0].pastCount).toBe(1);
    expect(body.venues[0].upcoming).toHaveLength(0);
  });

  it("excludes bare placeholder locations (e.g. 'Hong Kong') from unmatched", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const events = [
      mockEvent({
        id: "evt-placeholder",
        calendarId: "cal-1",
        title: "Mystery Event",
        location: "Hong Kong",
        startTime: future,
        endTime: new Date(future.getTime() + 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "My Calendar" }),
      }),
    ];
    prismaMock.event.findMany.mockResolvedValue(events);
    prismaMock.eventVenue.findMany.mockResolvedValue([KAI_TAK_VENUE]);

    const res = await GET();
    const body = await res.json();
    expect(body.unmatched).toEqual([]);
    expect(body.venues).toEqual([]);
  });

  it("groups multiple unmatched events with the same raw text and caps at 20 groups", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const events = [
      mockEvent({
        id: "evt-a",
        calendarId: "cal-1",
        location: "Some Random Hall",
        startTime: future,
        endTime: new Date(future.getTime() + 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "My Calendar" }),
      }),
      mockEvent({
        id: "evt-b",
        calendarId: "cal-1",
        location: "Some Random Hall",
        startTime: new Date(future.getTime() + 60 * 60 * 1000),
        endTime: new Date(future.getTime() + 2 * 60 * 60 * 1000),
        calendar: mockCalendar({ id: "cal-1", name: "My Calendar" }),
      }),
    ];
    prismaMock.event.findMany.mockResolvedValue(events);
    prismaMock.eventVenue.findMany.mockResolvedValue([KAI_TAK_VENUE]);

    const res = await GET();
    const body = await res.json();
    expect(body.unmatched).toEqual([
      { location: "Some Random Hall", count: 2, sampleEventId: "evt-a", sampleTitle: "Event" },
    ]);
  });
});
