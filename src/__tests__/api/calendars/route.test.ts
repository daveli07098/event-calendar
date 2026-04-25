import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession } from "../../helpers";

// Must import helpers before the routes so mocks are registered
import { GET, POST } from "@/app/api/calendars/route";

describe("GET /api/calendars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns user calendars", async () => {
    const calendars = [
      { id: "cal-1", userId: "user-1", name: "My Calendar", color: "#4285f4", isDefault: true, isVisible: true },
    ];
    prismaMock.calendar.findMany.mockResolvedValue(calendars);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(calendars);
    expect(prismaMock.calendar.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("POST /api/calendars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const req = new NextRequest("http://localhost/api/calendars", {
      method: "POST",
      body: JSON.stringify({ name: "Work" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const req = new NextRequest("http://localhost/api/calendars", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name is required" });
  });

  it("returns 400 when name is empty string", async () => {
    const req = new NextRequest("http://localhost/api/calendars", {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates a calendar with default color", async () => {
    const created = { id: "cal-2", userId: "user-1", name: "Work", color: "#4285f4" };
    prismaMock.calendar.create.mockResolvedValue(created);

    const req = new NextRequest("http://localhost/api/calendars", {
      method: "POST",
      body: JSON.stringify({ name: "Work" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    expect(prismaMock.calendar.create).toHaveBeenCalledWith({
      data: { userId: "user-1", name: "Work", color: "#4285f4" },
    });
  });

  it("creates a calendar with custom color", async () => {
    const created = { id: "cal-3", userId: "user-1", name: "Gym", color: "#ea4335" };
    prismaMock.calendar.create.mockResolvedValue(created);

    const req = new NextRequest("http://localhost/api/calendars", {
      method: "POST",
      body: JSON.stringify({ name: "Gym", color: "#ea4335" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prismaMock.calendar.create).toHaveBeenCalledWith({
      data: { userId: "user-1", name: "Gym", color: "#ea4335" },
    });
  });
});
