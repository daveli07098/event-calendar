import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  prismaMock,
  setMockSession,
  mockSession,
  getMockSession,
  mockCalendar,
  toJson,
} from "../../../helpers";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { PUT, DELETE } from "@/app/api/calendars/[id]/route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PUT /api/calendars/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const req = new NextRequest("http://localhost/api/calendars/cal-1", {
      method: "PUT",
      body: JSON.stringify({ name: "Renamed" }),
    });
    const res = await PUT(req, makeParams("cal-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when calendar not found", async () => {
    prismaMock.calendar.findFirst.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/calendars/missing", {
      method: "PUT",
      body: JSON.stringify({ name: "Nope" }),
    });
    const res = await PUT(req, makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("updates calendar name", async () => {
    const existing = mockCalendar({ id: "cal-1", name: "Old" });
    const updated = { ...mockCalendar({ id: "cal-1", name: "New" }), members: [] };
    prismaMock.calendar.findFirst.mockResolvedValue(existing);
    prismaMock.calendar.update.mockResolvedValue(updated);

    const req = new NextRequest("http://localhost/api/calendars/cal-1", {
      method: "PUT",
      body: JSON.stringify({ name: "New" }),
    });
    const res = await PUT(req, makeParams("cal-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(toJson({ ...updated, members: [] }));
  });

  it("updates calendar visibility", async () => {
    const existing = mockCalendar({ id: "cal-1", isVisible: true });
    const updated = { ...mockCalendar({ id: "cal-1", isVisible: false }), members: [] };
    prismaMock.calendar.findFirst.mockResolvedValue(existing);
    prismaMock.calendar.update.mockResolvedValue(updated);

    const req = new NextRequest("http://localhost/api/calendars/cal-1", {
      method: "PUT",
      body: JSON.stringify({ isVisible: false }),
    });
    const res = await PUT(req, makeParams("cal-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(toJson({ ...updated, members: [] }));
  });
});

describe("DELETE /api/calendars/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const req = new NextRequest("http://localhost/api/calendars/cal-1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("cal-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when calendar not found", async () => {
    // Not owned; also not a member (route allows a member to "leave" instead of 404).
    prismaMock.calendar.findFirst.mockResolvedValue(null);
    prismaMock.calendarMember.findUnique.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/calendars/missing", { method: "DELETE" });
    const res = await DELETE(req, makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when trying to delete default calendar", async () => {
    prismaMock.calendar.findFirst.mockResolvedValue(mockCalendar({ id: "cal-1", isDefault: true }));
    const req = new NextRequest("http://localhost/api/calendars/cal-1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("cal-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot delete default calendar" });
  });

  it("deletes a non-default calendar", async () => {
    prismaMock.calendar.findFirst.mockResolvedValue(mockCalendar({ id: "cal-2", isDefault: false }));
    prismaMock.calendar.delete.mockResolvedValue(mockCalendar({ id: "cal-2" }));

    const req = new NextRequest("http://localhost/api/calendars/cal-2", { method: "DELETE" });
    const res = await DELETE(req, makeParams("cal-2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(prismaMock.calendar.delete).toHaveBeenCalledWith({ where: { id: "cal-2" } });
  });
});
