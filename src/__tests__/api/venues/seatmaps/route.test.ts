import { describe, it, expect, beforeEach } from "vitest";
import { setMockSession, mockSession, getMockSession } from "../../../helpers";
import { kaiTakStadium } from "@/lib/venue-seatmap/venues/kai-tak";

// See src/__tests__/api/venues-events.test.ts for why eventVenue gets its own local mock
// rather than living in the shared helpers.ts fixture.
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

import { GET } from "@/app/api/venues/seatmaps/route";

function venueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "venue-1",
    name: "Test Arena",
    aliases: ["Test Arena HK"],
    seatMapConfig: null as unknown,
    seatMapStatus: null as string | null,
    seatMapSource: null as string | null,
    seatMapPlanUrl: null as string | null,
    seatMapUpdatedAt: null as Date | null,
    ...overrides,
  };
}

describe("GET /api/venues/seatmaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("omits venues with neither a config nor a plan url", async () => {
    prismaMock.eventVenue.findMany.mockResolvedValue([venueRow()]);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.venues).toEqual([]);
  });

  it("includes a venue with only a plan url (no config yet)", async () => {
    prismaMock.eventVenue.findMany.mockResolvedValue([
      venueRow({ seatMapPlanUrl: "https://blob.example.com/plan.pdf" }),
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body.venues).toHaveLength(1);
    expect(body.venues[0]).toMatchObject({
      venueId: "venue-1",
      venueName: "Test Arena",
      planUrl: "https://blob.example.com/plan.pdf",
      status: null,
      config: null,
    });
  });

  it("includes a venue with a saved config, serialising updatedAt to ISO", async () => {
    const updatedAt = new Date("2026-01-02T03:04:05.000Z");
    prismaMock.eventVenue.findMany.mockResolvedValue([
      venueRow({
        seatMapConfig: kaiTakStadium,
        seatMapStatus: "approved",
        seatMapSource: "research",
        seatMapUpdatedAt: updatedAt,
      }),
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body.venues).toHaveLength(1);
    expect(body.venues[0]).toMatchObject({
      venueId: "venue-1",
      status: "approved",
      source: "research",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });
    expect(body.venues[0].config).toEqual(kaiTakStadium);
  });
});
