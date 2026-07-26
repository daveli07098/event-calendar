import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  prismaMock,
  setMockSession,
  mockSession,
  getMockSession,
  mockCalendar,
  toJson,
} from "../../helpers";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { GET, POST } from "@/app/api/calendars/route";

// Mirrors the (unexported) MEMBER_INCLUDE constant in the route.
const MEMBER_INCLUDE = {
  members: {
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  },
};

describe("GET /api/calendars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.calendarMember.findMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns user calendars", async () => {
    const calendars = [mockCalendar({ id: "cal-1", name: "My Calendar" })];
    prismaMock.calendar.findMany.mockResolvedValue(calendars);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(calendars.map((c) => toJson({ ...c, members: [] })));
    expect(prismaMock.calendar.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      include: MEMBER_INCLUDE,
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
    const created = mockCalendar({ id: "cal-2", name: "Work" });
    prismaMock.calendar.create.mockResolvedValue(created);

    const req = new NextRequest("http://localhost/api/calendars", {
      method: "POST",
      body: JSON.stringify({ name: "Work" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(toJson({ ...created, members: [] }));
    expect(prismaMock.calendar.create).toHaveBeenCalledWith({
      data: { userId: "user-1", name: "Work", color: "#4285f4" },
      include: MEMBER_INCLUDE,
    });
  });

  it("creates a calendar with custom color", async () => {
    const created = mockCalendar({ id: "cal-3", name: "Gym", color: "#ea4335" });
    prismaMock.calendar.create.mockResolvedValue(created);

    const req = new NextRequest("http://localhost/api/calendars", {
      method: "POST",
      body: JSON.stringify({ name: "Gym", color: "#ea4335" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prismaMock.calendar.create).toHaveBeenCalledWith({
      data: { userId: "user-1", name: "Gym", color: "#ea4335" },
      include: MEMBER_INCLUDE,
    });
  });
});
