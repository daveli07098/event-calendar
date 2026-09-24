import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setMockSession, mockSession, getMockSession } from "../../../../helpers";
import { kaiTakStadium } from "@/lib/venue-seatmap/venues/kai-tak";

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
  return { eventVenue: createMockModel() };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { PUT, DELETE } from "@/app/api/venues/[id]/seatmap/route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

function makePut(body: unknown) {
  return new NextRequest("http://localhost/api/venues/venue-1/seatmap", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("PUT /api/venues/[id]/seatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.eventVenue.findUnique.mockResolvedValue({ id: "venue-1" });
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await PUT(makePut({ config: kaiTakStadium, status: "draft" }), makeParams("venue-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the venue doesn't exist", async () => {
    prismaMock.eventVenue.findUnique.mockResolvedValue(null);
    const res = await PUT(makePut({ config: kaiTakStadium, status: "draft" }), makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("rejects invalid JSON with 400", async () => {
    const req = new NextRequest("http://localhost/api/venues/venue-1/seatmap", { method: "PUT", body: "{not json" });
    const res = await PUT(req, makeParams("venue-1"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid status with 400", async () => {
    const res = await PUT(makePut({ config: kaiTakStadium, status: "published" }), makeParams("venue-1"));
    expect(res.status).toBe(400);
    expect(prismaMock.eventVenue.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid source with 400", async () => {
    const res = await PUT(
      makePut({ config: kaiTakStadium, status: "draft", source: "made-up" }),
      makeParams("venue-1")
    );
    expect(res.status).toBe(400);
    expect(prismaMock.eventVenue.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid config with 400 and a list of errors, writing nothing", async () => {
    const res = await PUT(
      makePut({ config: { ...kaiTakStadium, bowlShape: "oval", levels: [] }, status: "draft" }),
      makeParams("venue-1")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(prismaMock.eventVenue.update).not.toHaveBeenCalled();
  });

  it("saves a valid config, stamping updatedBy from the session email and defaulting source to 'user'", async () => {
    prismaMock.eventVenue.update.mockResolvedValue({
      id: "venue-1",
      seatMapConfig: kaiTakStadium,
      seatMapStatus: "draft",
      seatMapSource: "user",
      seatMapPlanUrl: null,
      seatMapUpdatedBy: mockSession.user.email,
      seatMapUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const res = await PUT(makePut({ config: kaiTakStadium, status: "draft" }), makeParams("venue-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("draft");
    expect(body.source).toBe("user");
    expect(prismaMock.eventVenue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "venue-1" },
        data: expect.objectContaining({
          seatMapStatus: "draft",
          seatMapSource: "user",
          seatMapUpdatedBy: mockSession.user.email,
        }),
      })
    );
  });

  it("accepts an explicit source", async () => {
    prismaMock.eventVenue.update.mockResolvedValue({
      id: "venue-1",
      seatMapConfig: kaiTakStadium,
      seatMapStatus: "approved",
      seatMapSource: "research",
      seatMapPlanUrl: null,
      seatMapUpdatedBy: mockSession.user.email,
      seatMapUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const res = await PUT(
      makePut({ config: kaiTakStadium, status: "approved", source: "research" }),
      makeParams("venue-1")
    );
    expect(res.status).toBe(200);
    expect(prismaMock.eventVenue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seatMapSource: "research" }) })
    );
  });
});

describe("DELETE /api/venues/[id]/seatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.eventVenue.findUnique.mockResolvedValue({ id: "venue-1" });
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await DELETE(new NextRequest("http://localhost/api/venues/venue-1/seatmap"), makeParams("venue-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the venue doesn't exist", async () => {
    prismaMock.eventVenue.findUnique.mockResolvedValue(null);
    const res = await DELETE(new NextRequest("http://localhost/api/venues/missing/seatmap"), makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("clears every seatMap* field", async () => {
    prismaMock.eventVenue.update.mockResolvedValue({});
    const res = await DELETE(new NextRequest("http://localhost/api/venues/venue-1/seatmap"), makeParams("venue-1"));
    expect(res.status).toBe(200);
    expect(prismaMock.eventVenue.update).toHaveBeenCalledWith({
      where: { id: "venue-1" },
      data: expect.objectContaining({
        seatMapStatus: null,
        seatMapSource: null,
        seatMapPlanUrl: null,
        seatMapUpdatedBy: null,
        seatMapUpdatedAt: null,
      }),
    });
  });
});
