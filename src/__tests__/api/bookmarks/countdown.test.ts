import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession, mockEvent } from "../../helpers";

vi.mock("@/lib/prisma", () => ({
  prisma: { ...prismaMock, eventBookmark: { upsert: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { prisma } from "@/lib/prisma";
import { PUT } from "@/app/api/bookmarks/[eventId]/countdown/route";

const upsert = (prisma.eventBookmark as unknown as { upsert: ReturnType<typeof vi.fn> }).upsert;
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/bookmarks/evt-1/countdown", { method: "PUT", body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ eventId: "evt-1" }) };
const eventWith = (calUser: string, members: unknown[]) => ({
  ...mockEvent(),
  calendar: { userId: calUser, shareMode: null, members },
});

beforeEach(() => {
  vi.clearAllMocks();
  setMockSession(mockSession);
});

describe("PUT /api/bookmarks/:eventId/countdown", () => {
  it("401 when signed out", async () => {
    setMockSession(null);
    expect((await PUT(req({ countdown: true }), ctx)).status).toBe(401);
  });

  it("400 for a non-boolean", async () => {
    expect((await PUT(req({ countdown: "yes" }), ctx)).status).toBe(400);
  });

  it("404 when the event is missing or unreadable", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);
    expect((await PUT(req({ countdown: true }), ctx)).status).toBe(404);
    prismaMock.event.findUnique.mockResolvedValue(eventWith("other", []) as never);
    expect((await PUT(req({ countdown: true }), ctx)).status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts the bookmark for a viewer-member", async () => {
    prismaMock.event.findUnique.mockResolvedValue(eventWith("other", [{ role: "viewer" }]) as never);
    const res = await PUT(req({ countdown: true }), ctx);
    expect(res.status).toBe(200);
    expect(upsert.mock.calls[0][0]).toEqual({
      where: { userId_eventId: { userId: "user-1", eventId: "evt-1" } },
      create: { userId: "user-1", eventId: "evt-1", countdown: true },
      update: { countdown: true },
    });
  });
});
