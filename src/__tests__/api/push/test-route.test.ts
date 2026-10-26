import { describe, it, expect, beforeEach, vi } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn(), sendPush: vi.fn(), uid: { id: "u1" } }));
vi.mock("@/lib/prisma", () => ({ prisma: { pushSubscription: { findMany: m.findMany } } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve({ user: m.uid })) }));
vi.mock("@/lib/push", () => ({ pushConfigured: () => true, sendPush: m.sendPush }));

import * as route from "@/app/api/push/test/route";

describe("push test endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findMany.mockResolvedValue([{ endpoint: "https://fcm.googleapis.com/a", p256dh: "p", auth: "a" }]);
    m.sendPush.mockResolvedValue("sent");
  });

  it("is POST-only", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it("rate-limits a user to one test per 60s", async () => {
    m.uid.id = "u-cooldown";
    expect((await route.POST()).status).toBe(200);
    const second = await route.POST();
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
    expect(m.sendPush).toHaveBeenCalledTimes(1);
  });
});
