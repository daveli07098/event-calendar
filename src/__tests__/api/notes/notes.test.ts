import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession } from "../../helpers";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...prismaMock,
    note: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/notes/route";
import { PATCH, DELETE } from "@/app/api/notes/[id]/route";

const note = prisma.note as unknown as Record<string, ReturnType<typeof vi.fn>>;
const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/notes", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  setMockSession(mockSession);
});

describe("notes API", () => {
  it("401 when signed out", async () => {
    setMockSession(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(req("POST", { text: "x" }))).status).toBe(401);
    expect((await PATCH(req("PATCH", { done: true }), ctx("n1"))).status).toBe(401);
    expect((await DELETE(req("DELETE"), ctx("n1"))).status).toBe(401);
  });

  it("GET lists only the user's open notes", async () => {
    note.findMany.mockResolvedValue([{ id: "n1" }]);
    const res = await GET();
    expect(await res.json()).toEqual([{ id: "n1" }]);
    expect(note.findMany.mock.calls[0][0].where).toEqual({ userId: "user-1", done: false });
  });

  it("POST validates text", async () => {
    expect((await POST(req("POST", { text: "   " }))).status).toBe(400);
    expect((await POST(req("POST", {}))).status).toBe(400);
  });

  it("POST refuses past the per-user cap", async () => {
    note.count.mockResolvedValueOnce(500);
    const res = await POST(req("POST", { text: "hi" }));
    expect(res.status).toBe(400);
    expect(note.create).not.toHaveBeenCalled();
  });

  it("POST stores url when the text is a URL", async () => {
    note.create.mockResolvedValue({ id: "n1" });
    const res = await POST(req("POST", { text: " https://example.com/a " }));
    expect(res.status).toBe(201);
    expect(note.create.mock.calls[0][0].data).toEqual({
      userId: "user-1", text: "https://example.com/a", url: "https://example.com/a",
    });
  });

  it("POST leaves url null for plain text", async () => {
    note.create.mockResolvedValue({ id: "n1" });
    await POST(req("POST", { text: "buy milk" }));
    expect(note.create.mock.calls[0][0].data.url).toBeNull();
  });

  it("PATCH rejects bad input and unknown notes", async () => {
    expect((await PATCH(req("PATCH", { done: "yes" }), ctx("n1"))).status).toBe(400);
    expect((await PATCH(req("PATCH", {}), ctx("n1"))).status).toBe(400);
    expect((await PATCH(req("PATCH", "str"), ctx("n1"))).status).toBe(400);
    expect((await PATCH(req("PATCH", null), ctx("n1"))).status).toBe(400);
    note.findFirst.mockResolvedValue(null);
    expect((await PATCH(req("PATCH", { done: true }), ctx("n1"))).status).toBe(404);
    expect(note.findFirst.mock.calls[0][0].where).toEqual({ id: "n1", userId: "user-1" });
  });

  it("PATCH marks done", async () => {
    note.findFirst.mockResolvedValue({ id: "n1" });
    note.update.mockResolvedValue({ id: "n1", done: true });
    const res = await PATCH(req("PATCH", { done: true }), ctx("n1"));
    expect(res.status).toBe(200);
    expect(note.update.mock.calls[0][0]).toEqual({ where: { id: "n1" }, data: { done: true } });
  });

  it("DELETE is scoped to the user", async () => {
    note.deleteMany.mockResolvedValue({ count: 0 });
    expect((await DELETE(req("DELETE"), ctx("n1"))).status).toBe(404);
    expect(note.deleteMany.mock.calls[0][0].where).toEqual({ id: "n1", userId: "user-1" });
    note.deleteMany.mockResolvedValue({ count: 1 });
    expect((await DELETE(req("DELETE"), ctx("n1"))).status).toBe(200);
  });
});
