import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession, mockCalendar, mockEvent } from "../../../helpers";
import { geminiPool } from "@/lib/ai/models";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

// Page fetch is fully stubbed — no network, no SSRF check against a real host.
const mockHtml = vi.fn<() => string>(() => "");
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: vi.fn(async () => ({ ok: true, status: 200, text: async () => mockHtml() })),
  assertPublicUrl: vi.fn(async () => {}),
  UnsafeUrlError: class UnsafeUrlError extends Error {},
}));

// AI is injected via the extraction cache: a cache hit short-circuits the whole
// provider cascade, so the "AI result" is whatever this returns and no AI call
// is ever attempted.
const mockAiResult = vi.fn<() => Record<string, unknown> | null>(() => null);
vi.mock("@/lib/ai/scrape-cache", () => ({
  scrapeCacheKey: vi.fn(() => "test-hash"),
  getScrapeCache: vi.fn(async () => {
    const result = mockAiResult();
    return result ? { result, provider: "test" } : null;
  }),
  saveScrapeCache: vi.fn(async () => {}),
  patchScrapeCache: vi.fn(async () => {}),
}));

vi.mock("@/lib/ai/quota", () => ({
  AI_DAILY_LIMIT: 250,
  checkRemainingAiLimit: vi.fn(async () => true),
  incrementAiLimit: vi.fn(async () => {}),
  remainingAiCalls: vi.fn(async () => 250),
  getResetAt: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

import { POST } from "@/app/api/tickets/scrape/route";

const TIMABLE_URL = "https://timable.com/en/event/2814567";

/** Timable-style page: Schema.org Event with the instant in UTC + a venue block. */
function timableHtml(startDate: string, opts: { endDate?: string } = {}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: "Test Live in Hong Kong",
    startDate,
    ...(opts.endDate ? { endDate: opts.endDate } : {}),
    location: {
      "@type": "Place",
      name: "Hong Kong Coliseum",
      address: {
        "@type": "PostalAddress",
        streetAddress: "9 Cheong Wan Road",
        addressLocality: "Hung Hom",
        addressCountry: "HK",
      },
    },
  };
  return `<!DOCTYPE html><html><head>
<title>Test Live in Hong Kong</title>
<meta property="og:title" content="Test Live in Hong Kong" />
<meta property="og:description" content="A live show." />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head><body><p>Tickets available now.</p></body></html>`;
}

function makeReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/tickets/scrape", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/tickets/scrape — venue-local schema times", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    mockAiResult.mockReturnValue(null);
    // Duplicate detection must find nothing — keeps the handler off any network path.
    prismaMock.calendar.findMany.mockResolvedValue([]);
    prismaMock.calendarMember.findMany.mockResolvedValue([]);
    prismaMock.event.findMany.mockResolvedValue([]);
    // One AI provider configured so the cache-injected extraction is used.
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GROQ_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pairs the AI's venue-local time with the venue timezone (JSON-LD in UTC)", async () => {
    // 12:00Z = 20:00 HKT — the AI reads the page's wall clock, so meta must agree.
    mockHtml.mockReturnValue(timableHtml("2027-05-07T12:00:00.000Z"));
    mockAiResult.mockReturnValue({
      title: "Test Live in Hong Kong",
      date: "2027-05-07",
      time: "20:00",
      endTime: "22:00",
      venue: "Hong Kong Coliseum",
    });

    const res = await POST(makeReq({ url: TIMABLE_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.date).toBe("2027-05-07");
    expect(json.time).toBe("20:00");
    // The bug: sourceTimezone used to be "Z" while time was the local 20:00, so
    // add/route.ts stamped 20:00 as UTC (an 8 h error).
    expect(json.sourceTimezone).toBe("+08:00");
  });

  it("derives a venue-local time from the schema instant when the AI returns none", async () => {
    mockHtml.mockReturnValue(timableHtml("2027-05-07T12:00:00.000Z"));
    mockAiResult.mockReturnValue({ title: "Test Live in Hong Kong" });

    const res = await POST(makeReq({ url: TIMABLE_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.time).toBe("20:00"); // not the raw UTC "12:00"
    expect(json.date).toBe("2027-05-07");
    expect(json.sourceTimezone).toBe("+08:00");
  });

  it("rolls the date forward when the schema instant crosses midnight in the venue zone", async () => {
    // 2027-05-07T17:30Z = 2027-05-08 01:30 HKT
    mockHtml.mockReturnValue(timableHtml("2027-05-07T17:30:00.000Z"));
    mockAiResult.mockReturnValue({ title: "Test Live in Hong Kong" });

    const res = await POST(makeReq({ url: TIMABLE_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.date).toBe("2027-05-08");
    expect(json.time).toBe("01:30");
    expect(json.sourceTimezone).toBe("+08:00");
  });

  it("leaves a date-only schema startDate untouched (it is already a venue-frame date)", async () => {
    mockHtml.mockReturnValue(timableHtml("2027-05-07"));
    mockAiResult.mockReturnValue({ title: "Test Live in Hong Kong" });

    const res = await POST(makeReq({ url: TIMABLE_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.date).toBe("2027-05-07");
    expect(json.time).toBeNull();
  });

  it("keeps the JSON-LD's own frame when the venue timezone can't be resolved", async () => {
    // Unmapped domain + no country hints → detectTimezoneFromUrl yields nothing, so
    // date/time/sourceTimezone all stay in the ISO string's frame (unchanged behaviour).
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Mystery Show",
      startDate: "2027-05-07T19:00:00+09:00",
      location: { "@type": "Place", name: "Some Hall" },
    };
    mockHtml.mockReturnValue(
      `<!DOCTYPE html><html><head><title>Mystery Show</title>` +
        `<meta property="og:title" content="Mystery Show" />` +
        `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` +
        `</head><body><p>Tickets available now.</p></body></html>`
    );
    mockAiResult.mockReturnValue({ title: "Mystery Show" });

    const res = await POST(makeReq({ url: "https://tickets.example.org/show/1" }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.date).toBe("2027-05-07");
    expect(json.time).toBe("19:00");
    expect(json.sourceTimezone).toBe("+09:00");
  });
});

describe("POST /api/tickets/scrape — duplicate-detection AI similarity model selection", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    mockHtml.mockReturnValue(timableHtml("2027-05-07T12:00:00.000Z"));
    // Served from cache — no AI call for the main extraction, so the only
    // Gemini traffic in these tests is the duplicate-detection similarity call.
    mockAiResult.mockReturnValue({
      title: "Test Live in Hong Kong",
      date: "2027-05-07",
      time: "20:00",
      venue: "Hong Kong Coliseum",
      // A populated category skips the classifySingleEvent() fallback call, so
      // the only Gemini fetch left is the duplicate-detection similarity call.
      category: "concert",
    });
    prismaMock.calendar.findMany.mockResolvedValue([mockCalendar({ id: "cal-1" })]);
    prismaMock.calendarMember.findMany.mockResolvedValue([]);
    // A same-day existing event triggers the AI similarity-scoring call.
    prismaMock.event.findMany.mockResolvedValue([
      mockEvent({ id: "evt-existing", title: "Existing Similar Event", startTime: new Date("2027-05-07T12:00:00.000Z"), location: null }),
    ]);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GROQ_API_KEY", "");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the Gemini API key via the x-goog-api-key header, not the URL query string", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"0":0.95}' }] } }] }), { status: 200 })
    );

    const res = await POST(makeReq({ url: TIMABLE_URL }));
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).not.toContain("key=");
    expect(String(calledUrl)).not.toContain("test-key");
    expect((calledInit as RequestInit).headers).toMatchObject({ "x-goog-api-key": "test-key" });
    // Model id comes from the pool's lite roster (not a hardcoded string).
    expect(geminiPool.lite()).toContain(String(calledUrl).match(/models\/([^:]+):/)?.[1]);

    const json = await res.json();
    expect(json.duplicateCandidates).toHaveLength(1);
    expect(json.duplicateCandidates[0].similarityScore).toBe(0.95);
  });

  it("falls through to the next pool model on a 429 and still resolves duplicate scores", async () => {
    const calledModels: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      const model = String(url).match(/models\/([^:]+):/)?.[1] ?? "unknown";
      calledModels.push(model);
      if (calledModels.length === 1) {
        return new Response(
          JSON.stringify({
            error: { message: "Quota exceeded for quota metric 'GenerateRequestsPerDayPerProjectPerModel'" },
          }),
          { status: 429 },
        );
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"0":0.9}' }] } }] }), { status: 200 });
    });

    const res = await POST(makeReq({ url: TIMABLE_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    // Two Gemini attempts, in the pool's lite-quota priority order.
    expect(calledModels).toEqual(geminiPool.lite());
    expect(json.duplicateCandidates).toHaveLength(1);
    expect(json.duplicateCandidates[0].similarityScore).toBe(0.9);
  });
});
