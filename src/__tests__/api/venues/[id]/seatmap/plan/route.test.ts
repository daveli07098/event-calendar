// Node environment (not the suite-wide jsdom default): jsdom's Request/FormData polyfill
// mangles a real multipart body's File payload (byte size comes back wrong on roundtrip
// through req.formData()), which breaks every size-cap assertion below. Node's native
// implementation — what actually runs in production — handles it correctly.
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setMockSession, mockSession, getMockSession } from "../../../../../helpers";

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

const blobMock = vi.hoisted(() => ({
  put: vi.fn(async (name: string) => ({ url: `https://blob.example.com/${name}` })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));
vi.mock("@vercel/blob", () => blobMock);

import { POST } from "@/app/api/venues/[id]/seatmap/plan/route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

function makeJsonReq(body: unknown) {
  return new NextRequest("http://localhost/api/venues/venue-1/seatmap/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeMultipartReq(file: File | null) {
  const formData = new FormData();
  if (file) formData.set("file", file);
  return new NextRequest("http://localhost/api/venues/venue-1/seatmap/plan", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/venues/[id]/seatmap/plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.eventVenue.findUnique.mockResolvedValue({ id: "venue-1" });
    prismaMock.eventVenue.update.mockResolvedValue({ seatMapPlanUrl: "https://blob.example.com/x" });
  });

  it("returns 401 when not authenticated", async () => {
    setMockSession(null);
    const res = await POST(makeJsonReq({ url: "https://example.com/plan.pdf" }), makeParams("venue-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the venue doesn't exist", async () => {
    prismaMock.eventVenue.findUnique.mockResolvedValue(null);
    const res = await POST(makeJsonReq({ url: "https://example.com/plan.pdf" }), makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("JSON path: rejects a non-https url", async () => {
    const res = await POST(makeJsonReq({ url: "http://example.com/plan.pdf" }), makeParams("venue-1"));
    expect(res.status).toBe(400);
  });

  it("JSON path: rejects a missing url", async () => {
    const res = await POST(makeJsonReq({}), makeParams("venue-1"));
    expect(res.status).toBe(400);
  });

  it("JSON path: links an https url and saves it", async () => {
    prismaMock.eventVenue.update.mockResolvedValue({ seatMapPlanUrl: "https://official.example.com/plan.pdf" });
    const res = await POST(makeJsonReq({ url: "https://official.example.com/plan.pdf" }), makeParams("venue-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.planUrl).toBe("https://official.example.com/plan.pdf");
    expect(prismaMock.eventVenue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "venue-1" },
        data: { seatMapPlanUrl: "https://official.example.com/plan.pdf" },
      })
    );
  });

  it("multipart path: rejects when no file is provided", async () => {
    const res = await POST(makeMultipartReq(null), makeParams("venue-1"));
    expect(res.status).toBe(400);
  });

  it("multipart path: rejects an unsupported file type", async () => {
    const file = new File(["data"], "plan.txt", { type: "text/plain" });
    const res = await POST(makeMultipartReq(file), makeParams("venue-1"));
    expect(res.status).toBe(415);
  });

  it("multipart path: rejects an oversized image (> 5MB)", async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([bytes], "plan.jpg", { type: "image/jpeg" });
    const res = await POST(makeMultipartReq(file), makeParams("venue-1"));
    expect(res.status).toBe(413);
  });

  it("multipart path: accepts a PDF up to 10MB (larger than the image cap)", async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024); // over the 5MB image cap, under the 10MB PDF cap
    const file = new File([bytes], "plan.pdf", { type: "application/pdf" });
    prismaMock.eventVenue.update.mockResolvedValue({ seatMapPlanUrl: "https://blob.example.com/venue-seat-plans/venue-1/plan.pdf" });
    const res = await POST(makeMultipartReq(file), makeParams("venue-1"));
    expect(res.status).toBe(200);
    expect(blobMock.put).toHaveBeenCalled();
    const [blobName] = blobMock.put.mock.calls[0];
    expect(blobName).toMatch(/^venue-seat-plans\/venue-1\//);
  });

  it("multipart path: rejects a PDF over 10MB", async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    const file = new File([bytes], "plan.pdf", { type: "application/pdf" });
    const res = await POST(makeMultipartReq(file), makeParams("venue-1"));
    expect(res.status).toBe(413);
  });

  it("multipart path: accepts a jpeg image and uploads to venue-seat-plans/", async () => {
    const file = new File([new Uint8Array(100)], "plan.jpg", { type: "image/jpeg" });
    const res = await POST(makeMultipartReq(file), makeParams("venue-1"));
    expect(res.status).toBe(200);
    expect(blobMock.put).toHaveBeenCalled();
  });
});
