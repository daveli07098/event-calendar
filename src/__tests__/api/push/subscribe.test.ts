import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ count: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { pushSubscription: { count: m.count, upsert: m.upsert, findUnique: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve({ user: { id: "u1" } })) }));

import { POST } from "@/app/api/push/subscribe/route";

const post = (endpoint: string, keys: unknown = { p256dh: "B".repeat(87), auth: "a".repeat(22) }) =>
  POST(
    new NextRequest("http://localhost/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint, keys }),
    }),
  );

describe("push subscribe endpoint allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.count.mockResolvedValue(0);
    m.upsert.mockResolvedValue({});
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://web.push.apple.com/xyz",
    "https://api.push.apple.com/3/device/x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://wns2-par02p.notify.windows.com/?token=x",
  ])("accepts %s", async (url) => {
    expect((await post(url)).status).toBe(200);
  });

  it.each([
    "http://fcm.googleapis.com/x",
    "https://169.254.169.254/latest",
    "https://localhost/x",
    "https://evil.com/",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evilpush.apple.com.evil.com/x",
    "https://notifywindows.com/x",
    "https://user:pw@fcm.googleapis.com/x",
    "not a url",
  ])("rejects %s", async (url) => {
    expect((await post(url)).status).toBe(400);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["short p256dh", { p256dh: "p", auth: "a".repeat(22) }],
    ["non-base64url p256dh", { p256dh: "+".repeat(87), auth: "a".repeat(22) }],
    ["overlong auth", { p256dh: "B".repeat(87), auth: "a".repeat(40) }],
    ["non-base64url auth", { p256dh: "B".repeat(87), auth: "a b".repeat(6) }],
  ])("rejects %s", async (_name, keys) => {
    expect((await post("https://fcm.googleapis.com/x", keys)).status).toBe(400);
    expect(m.upsert).not.toHaveBeenCalled();
  });
});
