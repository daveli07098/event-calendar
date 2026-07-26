import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  prismaMock,
  setMockSession,
  mockSession,
  getMockSession,
  mockCalendar,
  mockEvent,
  toJson,
} from "../../../helpers";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { PUT, DELETE } from "@/app/api/events/[id]/route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

// canAccessEvent() loads the event together with its calendar (+ the caller's
// own membership row) to decide read/write access.
function withOwnerCalendar(event: ReturnType<typeof mockEvent>, ownerId = "user-1") {
  return {
    ...event,
    calendar: { ...mockCalendar({ id: event.calendarId as string, userId: ownerId }), members: [] },
  };
}

describe("PUT /api/events/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const req = new NextRequest("http://localhost/api/events/evt-1", {
      method: "PUT",
      body: JSON.stringify({ title: "Updated" }),
    });
    const res = await PUT(req, makeParams("evt-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when event not found", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/events/missing", {
      method: "PUT",
      body: JSON.stringify({ title: "Nope" }),
    });
    const res = await PUT(req, makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("updates event title", async () => {
    const existing = withOwnerCalendar(mockEvent({ id: "evt-1", calendarId: "cal-1", title: "Old" }));
    prismaMock.event.findUnique.mockResolvedValue(existing);
    const updated = mockEvent({ id: "evt-1", calendarId: "cal-1", title: "New", calendar: existing.calendar });
    prismaMock.event.update.mockResolvedValue(updated);

    const req = new NextRequest("http://localhost/api/events/evt-1", {
      method: "PUT",
      body: JSON.stringify({ title: "New" }),
    });
    const res = await PUT(req, makeParams("evt-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(toJson(updated));
  });

  it("rejects move to unowned calendar", async () => {
    const existing = withOwnerCalendar(mockEvent({ id: "evt-1", calendarId: "cal-1", title: "Event" }));
    prismaMock.event.findUnique.mockResolvedValue(existing);
    // Target calendar lookup (canWriteToCalendar) fails.
    prismaMock.calendar.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/events/evt-1", {
      method: "PUT",
      body: JSON.stringify({ calendarId: "other-cal" }),
    });
    const res = await PUT(req, makeParams("evt-1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Target calendar not found" });
  });

  it("moves event to another owned calendar", async () => {
    const existing = withOwnerCalendar(mockEvent({ id: "evt-1", calendarId: "cal-1", title: "Event" }));
    const targetCal = { ...mockCalendar({ id: "cal-2", userId: "user-1" }), members: [] };
    prismaMock.event.findUnique.mockResolvedValue(existing);
    prismaMock.calendar.findUnique.mockResolvedValue(targetCal);
    const updated = mockEvent({ id: "evt-1", calendarId: "cal-2", title: "Event", calendar: targetCal });
    prismaMock.event.update.mockResolvedValue(updated);

    const req = new NextRequest("http://localhost/api/events/evt-1", {
      method: "PUT",
      body: JSON.stringify({ calendarId: "cal-2" }),
    });
    const res = await PUT(req, makeParams("evt-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(toJson(updated));
  });
});

describe("DELETE /api/events/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const req = new NextRequest("http://localhost/api/events/evt-1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("evt-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when event not found", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/events/missing", { method: "DELETE" });
    const res = await DELETE(req, makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("deletes an event", async () => {
    const existing = withOwnerCalendar(mockEvent({ id: "evt-1", calendarId: "cal-1" }));
    prismaMock.event.findUnique.mockResolvedValue(existing);
    prismaMock.event.delete.mockResolvedValue(mockEvent({ id: "evt-1", calendarId: "cal-1" }));

    const req = new NextRequest("http://localhost/api/events/evt-1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("evt-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(prismaMock.event.delete).toHaveBeenCalledWith({ where: { id: "evt-1" } });
  });
});
