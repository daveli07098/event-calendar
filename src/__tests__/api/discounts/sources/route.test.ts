import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession } from "../../../helpers";

// vi.mock must live in this file (not helpers.ts) so Vitest hoists it above the
// route import below — see the comment in helpers.ts for why.
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { GET, PUT } from "@/app/api/discounts/sources/route";

function makePut(body: unknown) {
  return new NextRequest("http://localhost/api/discounts/sources", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("GET/PUT /api/discounts/sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
  });

  it("GET returns 401 when unauthenticated", async () => {
    setMockSession(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("PUT returns 401 when unauthenticated", async () => {
    setMockSession(null);
    const res = await PUT(makePut({ sources: ["https://example.com"] }));
    expect(res.status).toBe(401);
  });

  it("GET returns [] when discountSources is null", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ discountSources: null } as never);
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ sources: [] });
  });

  it("GET returns the stored list, filtering out any non-string entries in the JSON blob", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      discountSources: ["https://a.example.com/", 42, "https://b.example.com/"],
    } as never);
    const res = await GET();
    const json = await res.json();
    expect(json).toEqual({ sources: ["https://a.example.com/", "https://b.example.com/"] });
  });

  it("PUT rejects a non-array body with 400", async () => {
    const res = await PUT(makePut({ sources: "https://example.com" }));
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT rejects an invalid URL entry with 400 and persists nothing", async () => {
    const res = await PUT(makePut({ sources: ["https://good.example.com/", "not-a-url"] }));
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT rejects a non-http(s) entry with 400", async () => {
    const res = await PUT(makePut({ sources: ["ftp://example.com/x"] }));
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PUT normalises and dedupes entries, persisting the resulting list", async () => {
    prismaMock.user.update.mockResolvedValue({} as never);
    const res = await PUT(
      makePut({
        sources: [
          "https://example.com/sale",
          "https://example.com/sale", // exact duplicate
          "https://EXAMPLE.com:443/sale", // same URL, different casing/explicit default port -> normalises equal
          "https://other.example.com/deal?x=1",
        ],
      })
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.sources).toHaveLength(2);
    expect(json.sources).toContain("https://example.com/sale");
    expect(json.sources).toContain("https://other.example.com/deal?x=1");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: mockSession.user.id },
      data: { discountSources: json.sources },
    });
  });

  it("PUT caps the stored list at 50 entries", async () => {
    prismaMock.user.update.mockResolvedValue({} as never);
    const sources = Array.from({ length: 60 }, (_, i) => `https://example.com/deal-${i}`);
    const res = await PUT(makePut({ sources }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.sources).toHaveLength(50);
  });
});
