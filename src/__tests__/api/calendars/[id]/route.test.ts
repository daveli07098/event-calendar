import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession } from "../../../helpers";

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
    const existing = { id: "cal-1", userId: "user-1", name: "Old", color: "#4285f4", isDefault: false };
    const updated = { ...existing, name: "New" };
    prismaMock.calendar.findFirst.mockResolvedValue(existing);
    prismaMock.calendar.update.mockResolvedValue(updated);

    const req = new NextRequest("http://localhost/api/calendars/cal-1", {
      method: "PUT",
      body: JSON.stringify({ name: "New" }),
    });
    const res = await PUT(req, makeParams("cal-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
  });

  it("updates calendar visibility", async () => {
    const existing = { id: "cal-1", userId: "user-1", name: "Cal", isVisible: true };
    const updated = { ...existing, isVisible: false };
    prismaMock.calendar.findFirst.mockResolvedValue(existing);
    prismaMock.calendar.update.mockResolvedValue(updated);

    const req = new NextRequest("http://localhost/api/calendars/cal-1", {
      method: "PUT",
      body: JSON.stringify({ isVisible: false }),
    });
    const res = await PUT(req, makeParams("cal-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
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
    prismaMock.calendar.findFirst.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/calendars/missing", { method: "DELETE" });
    const res = await DELETE(req, makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when trying to delete default calendar", async () => {
    prismaMock.calendar.findFirst.mockResolvedValue({
      id: "cal-1", userId: "user-1", isDefault: true,
    });
    const req = new NextRequest("http://localhost/api/calendars/cal-1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("cal-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot delete default calendar" });
  });

  it("deletes a non-default calendar", async () => {
    prismaMock.calendar.findFirst.mockResolvedValue({
      id: "cal-2", userId: "user-1", isDefault: false,
    });
    prismaMock.calendar.delete.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/calendars/cal-2", { method: "DELETE" });
    const res = await DELETE(req, makeParams("cal-2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(prismaMock.calendar.delete).toHaveBeenCalledWith({ where: { id: "cal-2" } });
  });
});
