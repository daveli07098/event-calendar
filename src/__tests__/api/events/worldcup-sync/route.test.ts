import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession, mockEvent, mockCalendar } from "../../../helpers";
import { geminiPool } from "@/lib/ai/models";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { POST } from "@/app/api/events/worldcup-sync/route";

const EVENT_ID = "evt-1";
const WIKIPEDIA_HTML = "<html><body>Match 5: Team A vs Team B</body></html>";

function makeReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/events/worldcup-sync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function geminiOkResponse(team1: string, team2: string) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: `{"team1":"${team1}","team2":"${team2}"}` }] } }],
    }),
    { status: 200 },
  );
}

describe("POST /api/events/worldcup-sync — Gemini grounded model selection", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    // Built via an intermediate variable (not an inline literal) so the
    // Prisma mock's strict findUnique return type doesn't excess-property-check
    // the added `calendar` include.
    const eventWithCalendar = {
      ...mockEvent({
        id: EVENT_ID,
        title: "32強 | TBD vs TBD",
        description: "World Cup Match ID: 5\nTBD vs TBD",
      }),
      calendar: mockCalendar({ userId: "user-1" }),
    };
    prismaMock.event.findUnique.mockResolvedValue(eventWithCalendar);
    prismaMock.event.update.mockResolvedValue(mockEvent({ id: EVENT_ID }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the Gemini API key via the x-goog-api-key header, not the URL query string", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("wikipedia.org")) {
        return new Response(WIKIPEDIA_HTML, { status: 200 });
      }
      return geminiOkResponse("Team A", "Team B");
    });

    const res = await POST(makeReq({ eventId: EVENT_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.team1).toBe("Team A");
    expect(json.team2).toBe("Team B");

    const geminiCall = fetchMock.mock.calls.find(([url]) => String(url).includes("generativelanguage.googleapis.com"));
    expect(geminiCall).toBeDefined();
    const [calledUrl, calledInit] = geminiCall!;
    expect(String(calledUrl)).not.toContain("key=");
    expect(String(calledUrl)).not.toContain("test-key");
    expect((calledInit as RequestInit).headers).toMatchObject({ "x-goog-api-key": "test-key" });
    // Model id comes from the grounded pool (only Gemini 2.5 models keep free grounding).
    expect(geminiPool.grounded()).toContain(
      String(calledUrl).match(/models\/([^:]+):/)?.[1],
    );
  });

  it("falls through to the next grounded pool model on a 429", async () => {
    const calledModels: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("wikipedia.org")) {
        return new Response(WIKIPEDIA_HTML, { status: 200 });
      }
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
      return geminiOkResponse("Team C", "Team D");
    });

    const res = await POST(makeReq({ eventId: EVENT_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.team1).toBe("Team C");
    expect(json.team2).toBe("Team D");

    // Two Gemini attempts, in the pool's grounded-quota order.
    expect(calledModels).toEqual(geminiPool.grounded());
  });

  it("returns 502 when every grounded model is exhausted", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("wikipedia.org")) {
        return new Response(WIKIPEDIA_HTML, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          error: { message: "Quota exceeded for quota metric 'GenerateRequestsPerDayPerProjectPerModel'" },
        }),
        { status: 429 },
      );
    });

    const res = await POST(makeReq({ eventId: EVENT_ID }));
    expect(res.status).toBe(502);
  });
});
