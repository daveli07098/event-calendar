import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession, mockCalendar, mockEvent } from "../../helpers";

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { POST } from "@/app/api/events/route";
import { PUT, DELETE } from "@/app/api/events/[id]/route";
import { writableCalendarIds } from "@/lib/event-access";

// A viewer (member of someone else's broadcast / site-shared calendar)
const broadcastCal = mockCalendar({ id: "site-1", userId: "owner", shareMode: "broadcast", isSiteShared: true });

describe("viewers of a broadcast calendar cannot write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.calendar.findUnique.mockResolvedValue({ ...broadcastCal, members: [{ role: "viewer" }] } as never);
  });

  it("POST /api/events -> 404", async () => {
    const req = new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({ title: "x", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-01T01:00:00Z", calendarId: "site-1" }),
    });
    expect((await POST(req)).status).toBe(404);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("PUT and DELETE /api/events/:id -> 403", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ ...mockEvent({ calendarId: "site-1" }), calendar: { ...broadcastCal, members: [{ role: "viewer" }] } } as never);
    const params = { params: Promise.resolve({ id: "evt-1" }) };
    const put = await PUT(new NextRequest("http://localhost/api/events/evt-1", { method: "PUT", body: JSON.stringify({ title: "y" }) }), params);
    expect(put.status).toBe(403);
    const del = await DELETE(new NextRequest("http://localhost/api/events/evt-1", { method: "DELETE" }), params);
    expect(del.status).toBe(403);
    expect(prismaMock.event.update).not.toHaveBeenCalled();
    expect(prismaMock.event.delete).not.toHaveBeenCalled();
  });

  it("writableCalendarIds only counts owned + collaborative-editor memberships", async () => {
    prismaMock.calendar.findMany.mockResolvedValue([{ id: "mine" }] as never);
    prismaMock.calendarMember.findMany.mockResolvedValue([{ calendarId: "collab" }] as never);
    expect(await writableCalendarIds("user-1")).toEqual(["mine", "collab"]);
    expect(prismaMock.calendarMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", role: "editor", calendar: { shareMode: "collaborative" } },
      select: { calendarId: true },
    });
  });
});
