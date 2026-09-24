import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession } from "../../../helpers";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

// Page fetch is fully stubbed — the pasted-content tests assert these are
// NEVER called (that's the actual "skip the network" behaviour under test);
// fetch-path tests configure a response via mockFetchResult, keyed by the
// requested URL so fallback tests can give the primary and fallback URLs
// different responses in the same test.
const mockFetchResult = vi.fn<(url?: string) => { ok: boolean; status: number; finalUrl: string; html: string }>(
  () => ({
    ok: true,
    status: 200,
    finalUrl: "https://example.com/",
    html: "",
  })
);
vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: vi.fn(async (url: string) => {
    const { ok, status, finalUrl, html } = mockFetchResult(url);
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
import { aiExtractJson } from "@/lib/ai/client";

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

// A page with enough visible text to clear the thin-content floor and one
// discount-keyword-matching anchor, for tests that need real offers/urls.
const SALE_HTML = `
<html><body>
<h1>Storewide End of Season Sale</h1>
<p>Save 40% off everything this weekend only! Extra padding text so the extracted content comfortably clears the minimum length floor for a real scan.</p>
<a href="/sale">Shop the sale</a>
</body></html>
`;

describe("POST /api/discounts/scan — fetch path: embedded page-data promo text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    mockAiData.mockReturnValue(aiOfferData());
  });

  // Real shape found on hk.puma.com: an 91app/NineYi inline-script JSON
  // bootstrap whose ONLY promo copy lives in topMessageData.text — the
  // visible (tag-stripped) page has no promotion text at all.
  const NINEYI_HTML =
    '<html><head><script>window.__NINEYI_STORE__ = {"topMessageData":{"text":"AUTUMN SPECIAL! 3件6折 | 滿1500減200 全場消費滿額即享折扣優惠碼AUTUMN20"}};</script></head><body><div id="app"></div></body></html>';

  it("is NOT reported as thin_content once the embedded promo text is folded in", async () => {
    mockFetchResult.mockImplementation(() => ({ ok: true, status: 200, finalUrl: URL, html: NINEYI_HTML }));
    const res = await POST(makeReq({ url: URL }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reason).not.toBe("thin_content");
  });

  it("passes the embedded promo text to the AI prompt", async () => {
    mockFetchResult.mockImplementation(() => ({ ok: true, status: 200, finalUrl: URL, html: NINEYI_HTML }));
    const res = await POST(makeReq({ url: URL }));
    expect(res.status).toBe(200);

    const promptArg = (aiExtractJson as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(promptArg).toContain("Promotional text embedded in the page data:");
    expect(promptArg).toContain("AUTUMN SPECIAL! 3件6折 | 滿1500減200");
  });

  it("a page with neither visible nor embedded promo text is still reported as thin_content", async () => {
    mockFetchResult.mockImplementation(() => ({ ok: true, status: 200, finalUrl: URL, html: "<html><body></body></html>" }));
    const res = await POST(makeReq({ url: URL }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("thin_content");
  });
});

describe("POST /api/discounts/scan — fallback sources", () => {
  const FANATICS_URL = "https://www.fanatics.com/";
  const FALLBACK_URL = "https://www.coupons.com/coupon-codes/fanatics";
  const PUMA_URL = "https://hk.puma.com/";
  const PUMA_FALLBACK_URL = "https://www.shopback.com.hk/puma";

  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    mockAiData.mockReturnValue(aiOfferData());
    (checkRemainingAiLimit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it("Akamai-blocked fanatics.com falls back to coupons.com and returns offers with `via`", async () => {
    mockFetchResult.mockImplementation((url?: string) => {
      if (url === FANATICS_URL) return { ok: false, status: 403, finalUrl: FANATICS_URL, html: "" };
      if (url === FALLBACK_URL) return { ok: true, status: 200, finalUrl: FALLBACK_URL, html: SALE_HTML };
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await POST(makeReq({ url: FANATICS_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.result.sourceUrl).toBe(FANATICS_URL);
    expect(json.result.via).toEqual({
      url: FALLBACK_URL,
      label: "Coupons.com — Fanatics",
      note: expect.stringContaining("aggregator"),
    });
    expect(json.result.offers.length).toBeGreaterThan(0);
    // Only the fallback ever reached the AI — the blocked primary never did.
    expect(aiExtractJson).toHaveBeenCalledTimes(1);
  });

  it("fallback also blocked → returns the original bot_protected result unchanged, with fallbackTried", async () => {
    mockFetchResult.mockImplementation((url?: string) => {
      if (url === FANATICS_URL) return { ok: false, status: 403, finalUrl: FANATICS_URL, html: "" };
      if (url === FALLBACK_URL) return { ok: false, status: 403, finalUrl: FALLBACK_URL, html: "" };
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await POST(makeReq({ url: FANATICS_URL }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("bot_protected");
    expect(json.fallbackTried).toBe(true);
    expect(aiExtractJson).not.toHaveBeenCalled();
  });

  it("quota exhausted → no fallback call at all, original blocked result returned", async () => {
    // First check (top of the route, before any fetch) succeeds; the
    // fallback-specific recheck inside attemptFallback() is the one that's
    // out of quota.
    (checkRemainingAiLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockFetchResult.mockImplementation((url?: string) => {
      if (url === FANATICS_URL) return { ok: false, status: 403, finalUrl: FANATICS_URL, html: "" };
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await POST(makeReq({ url: FANATICS_URL }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("bot_protected");
    expect(json.fallbackTried).toBeUndefined();
    expect(safeFetch).toHaveBeenCalledTimes(1); // only the primary — fallback was never fetched
    expect(aiExtractJson).not.toHaveBeenCalled();
  });

  it("hk.puma.com with zero offers falls back to the shopback aggregator and returns offers with `via`", async () => {
    mockFetchResult.mockImplementation((url?: string) => {
      if (url === PUMA_URL) return { ok: true, status: 200, finalUrl: PUMA_URL, html: SALE_HTML };
      if (url === PUMA_FALLBACK_URL) return { ok: true, status: 200, finalUrl: PUMA_FALLBACK_URL, html: SALE_HTML };
      throw new Error(`unexpected fetch: ${url}`);
    });
    mockAiData
      .mockReturnValueOnce(aiOfferData({ hasDiscount: false, discountPercent: null, promoCode: null, offers: [], evidence: [] }))
      .mockReturnValueOnce(aiOfferData());

    const res = await POST(makeReq({ url: PUMA_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.result.sourceUrl).toBe(PUMA_URL);
    expect(json.result.via?.url).toBe(PUMA_FALLBACK_URL);
    expect(json.result.offers.length).toBeGreaterThan(0);
    expect(aiExtractJson).toHaveBeenCalledTimes(2);
  });

  it("hk.puma.com with real offers on the primary scan never triggers a fallback call", async () => {
    mockFetchResult.mockImplementation((url?: string) => {
      if (url === PUMA_URL) return { ok: true, status: 200, finalUrl: PUMA_URL, html: SALE_HTML };
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await POST(makeReq({ url: PUMA_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.result.via).toBeUndefined();
    expect(json.result.offers.length).toBeGreaterThan(0);
    expect(aiExtractJson).toHaveBeenCalledTimes(1);
  });

  it("pasted content never triggers a fallback source lookup", async () => {
    // fanatics.com would normally have a fallback configured — pasted
    // content must skip that path entirely since nothing was fetched.
    const res = await POST(makeReq({ url: FANATICS_URL, pageContent: PASTED_HTML }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.via).toBeUndefined();
    expect(safeFetch).not.toHaveBeenCalled();
    expect(aiExtractJson).toHaveBeenCalledTimes(1);
  });

  it("www.puma.com's corporate_redirect auto-uses hk.puma.com as the fallback", async () => {
    const WWW_PUMA_URL = "https://www.puma.com/hk/en/";
    mockFetchResult.mockImplementation((url?: string) => {
      if (url === WWW_PUMA_URL) {
        return { ok: true, status: 200, finalUrl: "https://about.puma.com/en", html: "<html><body>Investor relations</body></html>" };
      }
      if (url === "https://hk.puma.com/") return { ok: true, status: 200, finalUrl: "https://hk.puma.com/", html: SALE_HTML };
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await POST(makeReq({ url: WWW_PUMA_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.sourceUrl).toBe(WWW_PUMA_URL);
    expect(json.result.via?.url).toBe("https://hk.puma.com/");
    expect(json.result.offers.length).toBeGreaterThan(0);
  });
});
