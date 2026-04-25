import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession } from "../../../helpers";

import { PUT, DELETE } from "@/app/api/events/[id]/route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

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
    prismaMock.event.findFirst.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/events/missing", {
      method: "PUT",
      body: JSON.stringify({ title: "Nope" }),
    });
    const res = await PUT(req, makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("updates event title", async () => {
    const existing = { id: "evt-1", calendarId: "cal-1", title: "Old" };
    const updated = { ...existing, title: "New", calendar: { id: "cal-1" } };
    prismaMock.event.findFirst.mockResolvedValue(existing);
    prismaMock.event.update.mockResolvedValue(updated);

    const req = new NextRequest("http://localhost/api/events/evt-1", {
      method: "PUT",
      body: JSON.stringify({ title: "New" }),
    });
    const res = await PUT(req, makeParams("evt-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
  });

  it("rejects move to unowned calendar", async () => {
    const existing = { id: "evt-1", calendarId: "cal-1", title: "Event" };
    prismaMock.event.findFirst.mockResolvedValue(existing);
    prismaMock.calendar.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/events/evt-1", {
      method: "PUT",
      body: JSON.stringify({ calendarId: "other-cal" }),
    });
    const res = await PUT(req, makeParams("evt-1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Target calendar not found" });
  });

  it("moves event to another owned calendar", async () => {
    const existing = { id: "evt-1", calendarId: "cal-1", title: "Event" };
    const targetCal = { id: "cal-2", userId: "user-1" };
    const updated = { ...existing, calendarId: "cal-2", calendar: targetCal };
    prismaMock.event.findFirst.mockResolvedValue(existing);
    prismaMock.calendar.findFirst.mockResolvedValue(targetCal);
    prismaMock.event.update.mockResolvedValue(updated);

    const req = new NextRequest("http://localhost/api/events/evt-1", {
      method: "PUT",
      body: JSON.stringify({ calendarId: "cal-2" }),
    });
    const res = await PUT(req, makeParams("evt-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
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
    prismaMock.event.findFirst.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/events/missing", { method: "DELETE" });
    const res = await DELETE(req, makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("deletes an event", async () => {
    prismaMock.event.findFirst.mockResolvedValue({ id: "evt-1", calendarId: "cal-1" });
    prismaMock.event.delete.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/events/evt-1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("evt-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(prismaMock.event.delete).toHaveBeenCalledWith({ where: { id: "evt-1" } });
  });
});
