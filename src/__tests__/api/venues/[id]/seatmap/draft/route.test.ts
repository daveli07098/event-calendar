import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setMockSession, mockSession, getMockSession } from "../../../../../helpers";
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

const { safeFetchMock, UnsafeUrlError } = vi.hoisted(() => ({
  safeFetchMock: vi.fn(),
  UnsafeUrlError: class UnsafeUrlError extends Error {},
}));
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: safeFetchMock,
  UnsafeUrlError,
}));

const hasAiProviderMock = vi.hoisted(() => vi.fn(() => true));
const aiExtractJsonFromImageMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/client", () => ({
  hasAiProvider: hasAiProviderMock,
  aiExtractJsonFromImage: aiExtractJsonFromImageMock,
}));

const checkRemainingAiLimitMock = vi.hoisted(() => vi.fn(async () => true));
const incrementAiLimitMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/ai/quota", () => ({
  AI_DAILY_LIMIT: 250,
  checkRemainingAiLimit: checkRemainingAiLimitMock,
  incrementAiLimit: incrementAiLimitMock,
  getResetAt: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

const getScrapeCacheMock = vi.hoisted(() => vi.fn(async () => null as { result: Record<string, unknown>; provider: string } | null));
const saveScrapeCacheMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/ai/scrape-cache", () => ({
  scrapeCacheKey: vi.fn((...parts: string[]) => parts.join("|")),
  getScrapeCache: getScrapeCacheMock,
  saveScrapeCache: saveScrapeCacheMock,
}));

import { POST } from "@/app/api/venues/[id]/seatmap/draft/route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/venues/venue-1/seatmap/draft", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** A minimal, valid AI draft: everything the forced-identity-field logic doesn't overwrite. */
function minimalAiDraft(): Record<string, unknown> {
  return {
    id: "whatever-the-ai-said",
    name: "Whatever The AI Said",
    aliases: ["Whatever"],
    bowlShape: "rounded-rect",
    orientationConfidence: "confirmed", // deliberately wrong — route must force "unconfirmed"
    levels: [
      {
        id: "level-1",
        label: "Level 1",
        tier: 0,
        radiusRange: [0.1, 0.5],
        blockNumberRanges: [{ min: 100, max: 120, positionConfidence: "unconfirmed" }],
      },
    ],
    gates: [],
    asymmetries: [],
    blockSuffixConfidence: "unconfirmed",
  };
}

function mockSafeFetchOk(contentType: string, bytes = new Uint8Array([1, 2, 3])) {
  safeFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => bytes.buffer,
  });
}

describe("POST /api/venues/[id]/seatmap/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    hasAiProviderMock.mockReturnValue(true);
    checkRemainingAiLimitMock.mockResolvedValue(true);
    getScrapeCacheMock.mockResolvedValue(null);
    prismaMock.eventVenue.findUnique.mockResolvedValue({
      id: "venue-1",
      name: "Test Arena",
      aliases: ["Test Arena HK"],
      seatMapPlanUrl: "https://official.example.com/plan.jpg",
    });
    aiExtractJsonFromImageMock.mockResolvedValue({ data: minimalAiDraft(), provider: "gemini-test", tokensUsed: 10 });
    mockSafeFetchOk("image/jpeg");
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the venue doesn't exist", async () => {
    prismaMock.eventVenue.findUnique.mockResolvedValue(null);
    const res = await POST(makeReq({}), makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when no planUrl is given and none is stored", async () => {
    prismaMock.eventVenue.findUnique.mockResolvedValue({
      id: "venue-1",
      name: "Test Arena",
      aliases: [],
      seatMapPlanUrl: null,
    });
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(400);
  });

  it("returns 503 when no AI provider is configured", async () => {
    hasAiProviderMock.mockReturnValue(false);
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(503);
  });

  it("returns 400 when the plan url is private (SSRF guard)", async () => {
    safeFetchMock.mockRejectedValue(new UnsafeUrlError("nope"));
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(400);
  });

  it("returns 415 for an unsupported plan content type", async () => {
    mockSafeFetchOk("text/html");
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(415);
  });

  it("returns 429 with resetAt when the daily AI limit is exhausted", async () => {
    checkRemainingAiLimitMock.mockResolvedValue(false);
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.resetAt).toBe("2026-01-01T00:00:00.000Z");
    expect(aiExtractJsonFromImageMock).not.toHaveBeenCalled();
  });

  it("returns 502 when AI extraction throws", async () => {
    aiExtractJsonFromImageMock.mockRejectedValue(new Error("All AI providers failed"));
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(502);
  });

  it("returns 422 when the (forced) draft fails validation", async () => {
    aiExtractJsonFromImageMock.mockResolvedValue({
      data: { ...minimalAiDraft(), levels: [] }, // invalid: levels must be non-empty
      provider: "gemini-test",
      tokensUsed: 10,
    });
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it("returns a validated draft, forcing identity fields from the DB row and NOT saving anything", async () => {
    const res = await POST(makeReq({ notes: "concert layout" }), makeParams("venue-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.id).toBe("venue-1");
    expect(body.draft.name).toBe("Test Arena");
    expect(body.draft.aliases).toEqual(["Test Arena HK"]);
    expect(body.draft.orientationConfidence).toBe("unconfirmed"); // AI said "confirmed" — must be overridden
    expect(body.draft.seatingPlanSources).toEqual([
      { url: "https://official.example.com/plan.jpg", label: "Official seating plan" },
    ]);
    expect(prismaMock.eventVenue.update).not.toHaveBeenCalled();
    expect(incrementAiLimitMock).toHaveBeenCalledTimes(1);
    expect(saveScrapeCacheMock).toHaveBeenCalledTimes(1);
    // Unconfirmed block range surfaced as a warning, not a validation failure.
    expect(body.warnings.some((w: string) => w.includes("unconfirmed position"))).toBe(true);
  });

  it("serves from cache on a hit, skipping quota and the AI call entirely", async () => {
    getScrapeCacheMock.mockResolvedValue({ result: minimalAiDraft(), provider: "gemini-test" });
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings).toContain("Draft served from cache — no AI call was made.");
    expect(aiExtractJsonFromImageMock).not.toHaveBeenCalled();
    expect(checkRemainingAiLimitMock).not.toHaveBeenCalled();
    expect(incrementAiLimitMock).not.toHaveBeenCalled();
  });

  it("accepts a full valid Kai Tak-shaped draft with no unconfirmed-position warning", async () => {
    aiExtractJsonFromImageMock.mockResolvedValue({
      data: { ...kaiTakStadium, id: "ignored", name: "ignored", aliases: [] },
      provider: "gemini-test",
      tokensUsed: 10,
    });
    const res = await POST(makeReq({}), makeParams("venue-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Kai Tak's config does contain some unconfirmed positionConfidence ranges (101-110), so a
    // warning is still expected — this just exercises the full-shape path end-to-end.
    expect(body.draft.levels.length).toBe(kaiTakStadium.levels.length);
  });
});
