import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession } from "../../helpers";

import { GET, POST } from "@/app/api/events/route";

describe("GET /api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const req = new NextRequest("http://localhost/api/events?start=2025-01-01&end=2025-01-31");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when start/end missing", async () => {
    const req = new NextRequest("http://localhost/api/events");
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "start and end query params are required" });
  });

  it("returns 400 when only start is provided", async () => {
    const req = new NextRequest("http://localhost/api/events?start=2025-01-01");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns events within date range", async () => {
    const events = [
      {
        id: "evt-1",
        calendarId: "cal-1",
        title: "Meeting",
        startTime: "2025-01-15T10:00:00Z",
        endTime: "2025-01-15T11:00:00Z",
        allDay: false,
        calendar: { id: "cal-1", name: "My Calendar", color: "#4285f4" },
      },
    ];
    prismaMock.event.findMany.mockResolvedValue(events);

    const req = new NextRequest("http://localhost/api/events?start=2025-01-01&end=2025-01-31");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(events);
    expect(prismaMock.event.findMany).toHaveBeenCalledWith({
      where: {
        calendar: { userId: "user-1" },
        startTime: { lte: new Date("2025-01-31") },
        endTime: { gte: new Date("2025-01-01") },
      },
      include: { calendar: true },
      orderBy: { startTime: "asc" },
    });
  });
});

describe("POST /api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const req = new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({ title: "Test" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when title is missing", async () => {
    const req = new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({ startTime: "2025-01-15T10:00:00Z", endTime: "2025-01-15T11:00:00Z", calendarId: "cal-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Title is required" });
  });

  it("returns 400 when times are missing", async () => {
    const req = new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({ title: "Test", calendarId: "cal-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Start and end times are required" });
  });

  it("returns 404 when calendar not owned by user", async () => {
    prismaMock.calendar.findFirst.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({
        title: "Test",
        startTime: "2025-01-15T10:00:00Z",
        endTime: "2025-01-15T11:00:00Z",
        calendarId: "someone-elses-cal",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Calendar not found" });
  });

  it("creates an event successfully", async () => {
    const calendar = { id: "cal-1", userId: "user-1", name: "My Calendar" };
    const created = {
      id: "evt-1",
      calendarId: "cal-1",
      title: "Team Standup",
      startTime: new Date("2025-01-15T10:00:00Z"),
      endTime: new Date("2025-01-15T10:30:00Z"),
      allDay: false,
      calendar,
    };
    prismaMock.calendar.findFirst.mockResolvedValue(calendar);
    prismaMock.event.create.mockResolvedValue(created);

    const req = new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({
        title: "  Team Standup  ",
        startTime: "2025-01-15T10:00:00Z",
        endTime: "2025-01-15T10:30:00Z",
        calendarId: "cal-1",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prismaMock.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: "Team Standup", calendarId: "cal-1" }),
      include: { calendar: true },
    });
  });
});
