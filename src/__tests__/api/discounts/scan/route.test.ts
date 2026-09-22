import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession } from "../../../helpers";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

// Page fetch is fully stubbed — the pasted-content tests assert these are
// NEVER called (that's the actual "skip the network" behaviour under test);
// the one fetch-path test below configures a response via mockFetchResult.
const mockFetchResult = vi.fn<() => { ok: boolean; status: number; finalUrl: string; html: string }>(() => ({
  ok: true,
  status: 200,
  finalUrl: "https://example.com/",
  html: "",
}));
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: vi.fn(async () => {
    const { ok, status, finalUrl, html } = mockFetchResult();
    return { ok, status, finalUrl, text: async () => html };
  }),
  assertPublicUrl: vi.fn(async () => {}),
  UnsafeUrlError: class UnsafeUrlError extends Error {},
}));

// AI extraction is fully stubbed — no provider cascade, no network.
const mockAiData = vi.fn<() => Record<string, unknown>>(() => ({}));
vi.mock("@/lib/ai/client", () => ({
  hasAiProvider: vi.fn(() => true),
  aiExtractJson: vi.fn(async () => ({
    data: mockAiData(),
    provider: "test-provider",
    tokensUsed: 42,
  })),
}));

vi.mock("@/lib/ai/quota", () => ({
  AI_DAILY_LIMIT: 250,
  checkRemainingAiLimit: vi.fn(async () => true),
  incrementAiLimit: vi.fn(async () => {}),
  remainingAiCalls: vi.fn(async () => 249),
  getResetAt: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

import { POST } from "@/app/api/discounts/scan/route";
import { safeFetch, assertPublicUrl } from "@/lib/safe-fetch";
import { checkRemainingAiLimit, incrementAiLimit } from "@/lib/ai/quota";

const URL = "https://example.com/";

function makeReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/discounts/scan", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// A minimal HTML page with a headline offer + one discount-keyword-matching
// link, padded so the extracted text clears the 100-char floor easily.
const PASTED_HTML = `
<html><body>
<h1>Storewide End of Season Sale</h1>
<p>Save 50% off everything this weekend only! Use code SAVE50 at checkout.
Extra padding text so the extracted content comfortably clears the minimum length floor for a real scan.</p>
<a href="/sale">Shop the sale</a>
</body></html>
`;

// The same promotion, but as plain text a user copied straight out of a
// rendered page (no markup at all).
const PASTED_TEXT = `Storewide End of Season Sale
Save 50% off everything this weekend only! Use code SAVE50 at checkout.
Extra padding text so the extracted content comfortably clears the minimum length floor for a real scan.`;

function aiOfferData(overrides: Record<string, unknown> = {}) {
  return {
    hasDiscount: true,
    confidence: "high",
    title: "Storewide End of Season Sale",
    discountSummary: "50% off everything",
    discountPercent: "50%",
    promoCode: "SAVE50",
    startDate: null,
    endDate: null,
    categories: [],
    url: 0,
    offers: [
      {
        label: "Storewide sale",
        detail: "50% off everything",
        discountPercent: "50%",
        promoCode: "SAVE50",
        minSpend: null,
        audience: "all",
        url: 0,
      },
    ],
    evidence: ["Save 50% off everything this weekend only!"],
    items: [],
    ...overrides,
  };
}

describe("POST /api/discounts/scan — pasted page content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    mockAiData.mockReturnValue(aiOfferData());
    mockFetchResult.mockReturnValue({ ok: true, status: 200, finalUrl: URL, html: "" });
  });

  it("returns 401 when unauthenticated", async () => {
    setMockSession(null);
    const res = await POST(makeReq({ url: URL, pageContent: PASTED_TEXT }));
    expect(res.status).toBe(401);
  });

  it("pasted HTML yields offers and resolves a relative deep link against url", async () => {
    const res = await POST(makeReq({ url: URL, pageContent: PASTED_HTML }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.result.fromPastedContent).toBe(true);
    expect(json.result.hasDiscount).toBe(true);
    expect(json.result.offers).toHaveLength(1);
    expect(json.result.offers[0].url).toBe("https://example.com/sale");
    expect(json.result.url).toBe("https://example.com/sale");

    // The whole point of pasted content: no network at all.
    expect(safeFetch).not.toHaveBeenCalled();
    expect(assertPublicUrl).not.toHaveBeenCalled();
  });

  it("pasted plain text yields offers with all url fields null", async () => {
    const res = await POST(makeReq({ url: URL, pageContent: PASTED_TEXT }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.result.fromPastedContent).toBe(true);
    expect(json.result.hasDiscount).toBe(true);
    expect(json.result.offers).toHaveLength(1);
    expect(json.result.offers[0].url).toBeNull();
    expect(json.result.url).toBeNull();

    expect(safeFetch).not.toHaveBeenCalled();
    expect(assertPublicUrl).not.toHaveBeenCalled();
  });

  it("blank/too-short paste → 422 with empty_content", async () => {
    // Non-blank but far too short to be a real scan — the "blank" case
    // (whitespace-only pageContent) is treated as absent and falls through
    // to the normal fetch path instead (not exercised here).
    const res = await POST(makeReq({ url: URL, pageContent: "Sale!" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("empty_content");

    expect(safeFetch).not.toHaveBeenCalled();
    expect(assertPublicUrl).not.toHaveBeenCalled();
  });

  it("oversized paste → 413 with content_too_large", async () => {
    const res = await POST(makeReq({ url: URL, pageContent: "a".repeat(400_001) }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.reason).toBe("content_too_large");

    // Rejected before any provider/quota check.
    expect(checkRemainingAiLimit).not.toHaveBeenCalled();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("a pasted scan still increments the AI quota", async () => {
    const res = await POST(makeReq({ url: URL, pageContent: PASTED_HTML }));
    expect(res.status).toBe(200);
    expect(checkRemainingAiLimit).toHaveBeenCalledWith(mockSession.user.id);
    expect(incrementAiLimit).toHaveBeenCalledWith(mockSession.user.id);
  });

  it("fromPastedContent is false for a normal fetched scan", async () => {
    mockFetchResult.mockReturnValue({ ok: true, status: 200, finalUrl: URL, html: PASTED_HTML });
    const res = await POST(makeReq({ url: URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.result.fromPastedContent).toBe(false);
    expect(safeFetch).toHaveBeenCalled();
    expect(assertPublicUrl).toHaveBeenCalled();
  });

  describe("startDate/endDate — strict YYYY-MM-DD only", () => {
    it("drops a non-ISO date like 'Ongoing' to null instead of persisting it", async () => {
      mockAiData.mockReturnValue(aiOfferData({ startDate: "Ongoing", endDate: "TBD" }));
      const res = await POST(makeReq({ url: URL, pageContent: PASTED_TEXT }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.startDate).toBeNull();
      expect(json.result.endDate).toBeNull();
    });

    it("drops a non-existent calendar date (2026-02-30) to null", async () => {
      mockAiData.mockReturnValue(aiOfferData({ startDate: "2026-02-30", endDate: null }));
      const res = await POST(makeReq({ url: URL, pageContent: PASTED_TEXT }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.startDate).toBeNull();
    });

    it("keeps a valid strict YYYY-MM-DD date unchanged", async () => {
      mockAiData.mockReturnValue(aiOfferData({ startDate: "2026-09-01", endDate: "2026-09-30" }));
      const res = await POST(makeReq({ url: URL, pageContent: PASTED_TEXT }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.startDate).toBe("2026-09-01");
      expect(json.result.endDate).toBe("2026-09-30");
    });
  });

  describe("dedup — exact-duplicate offers/items", () => {
    it("drops an offer that duplicates an earlier one once normalised (case/whitespace only)", async () => {
      mockAiData.mockReturnValue(
        aiOfferData({
          offers: [
            {
              label: "Storewide sale",
              detail: "50% off everything",
              discountPercent: "50%",
              promoCode: "SAVE50",
              minSpend: null,
              audience: "all",
              url: 0,
            },
            {
              label: "  STOREWIDE   sale ",
              detail: "50%   off everything",
              discountPercent: "50%",
              promoCode: "save50",
              minSpend: null,
              audience: "all",
              url: 0,
            },
          ],
        })
      );
      const res = await POST(makeReq({ url: URL, pageContent: PASTED_HTML }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.offers).toHaveLength(1);
    });

    it("drops an item that duplicates an earlier one once normalised (name + url)", async () => {
      mockAiData.mockReturnValue(
        aiOfferData({
          items: [
            { name: "Air Max 90", price: "$90", originalPrice: "$120" },
            { name: "  air  max   90 ", price: "$90", originalPrice: "$120" },
          ],
        })
      );
      const res = await POST(makeReq({ url: URL, pageContent: PASTED_TEXT }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.items).toHaveLength(1);
    });
  });
});
