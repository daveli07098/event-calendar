import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  userFind: vi.fn(),
  eventFind: vi.fn(),
  logCreate: vi.fn(),
  logDelete: vi.fn(),
  sendPush: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: m.userFind },
    event: { findMany: m.eventFind },
    pushReminderLog: { createMany: m.logCreate, deleteMany: m.logDelete },
  },
}));
vi.mock("@/lib/push", () => ({ pushConfigured: () => true, sendPush: m.sendPush }));

import { POST } from "@/app/api/push/dispatch/route";

const call = (headers: Record<string, string> = {}, qs = "") =>
  POST(new NextRequest(`http://localhost/api/push/dispatch${qs}`, { method: "POST", headers }));
const good = { authorization: "Bearer s3cret" };

function seed(event: Record<string, unknown>) {
  m.userFind.mockResolvedValue([
    {
      id: "u1",
      pushSubscriptions: [{ endpoint: "https://fcm.googleapis.com/a", p256dh: "p", auth: "a" }],
      calendars: [{ id: "c1" }],
      calendarMemberships: [],
    },
  ]);
  m.eventFind.mockResolvedValue([
    { id: "e1", calendarId: "c1", title: "Fest", location: null, calendar: { name: "Main" }, ...event },
  ]);
}

describe("push dispatch", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "s3cret";
    m.logCreate.mockResolvedValue({ count: 1 });
    m.logDelete.mockResolvedValue({ count: 1 });
    m.sendPush.mockResolvedValue("sent");
  });

  it("returns 500 when CRON_SECRET is missing or empty, even with a matching empty bearer", async () => {
    delete process.env.CRON_SECRET;
    expect((await call({ authorization: "Bearer " })).status).toBe(500);
    process.env.CRON_SECRET = "";
    expect((await call({ authorization: "Bearer " })).status).toBe(500);
  });

  it("rejects wrong bearer, wrong length bearer and ?key= secrets", async () => {
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret-extra" })).status).toBe(401);
    expect((await call({}, "?key=s3cret")).status).toBe(401);
    expect(m.userFind).not.toHaveBeenCalled();
  });

  it("sends event-day for an all-day event stored at UTC midnight (Google import)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T01:05:00Z")); // 09:05 HKT
    seed({ allDay: true, startTime: new Date("2026-11-10T00:00:00Z"), endTime: new Date("2026-11-11T00:00:00Z") });
    const res = await call(good);
    expect(await res.json()).toMatchObject({ reminders: 1, sent: 1, failed: 0 });
    const where = m.eventFind.mock.calls[0][0].where;
    expect(where.startTime.lt).toEqual(new Date("2026-11-11T02:05:00Z"));
    expect(where.endTime.gt).toEqual(new Date("2026-11-08T13:05:00Z"));
  });

  it("sends event-day for an all-day event stored at HKT midnight (EventModal)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T01:05:00Z"));
    seed({ allDay: true, startTime: new Date("2026-11-09T16:00:00Z"), endTime: new Date("2026-11-10T16:00:00Z") });
    expect(await (await call(good)).json()).toMatchObject({ reminders: 1, sent: 1 });
  });

  it("releases the log claim when every send fails so the next run retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T01:05:00Z"));
    seed({ allDay: true, startTime: new Date("2026-11-10T00:00:00Z"), endTime: new Date("2026-11-11T00:00:00Z") });
    m.sendPush.mockResolvedValue("failed");
    expect(await (await call(good)).json()).toMatchObject({ reminders: 1, sent: 0, failed: 1 });
    expect(m.logDelete).toHaveBeenCalledWith({ where: { userId: "u1", eventId: "e1", kind: "event-day" } });
  });

  it("keeps the claim when the subscription is gone or the send succeeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T01:05:00Z"));
    seed({ allDay: true, startTime: new Date("2026-11-10T00:00:00Z"), endTime: new Date("2026-11-11T00:00:00Z") });
    m.sendPush.mockResolvedValue("gone");
    await call(good);
    expect(m.logDelete).not.toHaveBeenCalled();
  });

  it("does not send when another run already claimed the reminder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T01:05:00Z"));
    seed({ allDay: true, startTime: new Date("2026-11-10T00:00:00Z"), endTime: new Date("2026-11-11T00:00:00Z") });
    m.logCreate.mockResolvedValue({ count: 0 });
    await call(good);
    expect(m.sendPush).not.toHaveBeenCalled();
  });
});
