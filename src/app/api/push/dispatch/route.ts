import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushConfigured, sendPush } from "@/lib/push";
import { buildPayload, dueReminders, type ReminderEvent } from "@/lib/push-reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_USERS = 200;
const MAX_EVENTS = 5000;
const SEND_CONCURRENCY = 10;
const HOUR = 3_600_000;

function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.allSettled(lanes);
}

/**
 * Push reminder dispatcher, hit every 5 minutes by a GitHub Action
 * (.github/workflows/push-reminders.yml). Auth: `Authorization: Bearer <CRON_SECRET>`
 * only (no query-string secrets, which leak into logs).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (!authorized(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!pushConfigured()) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 });
  }

  const now = new Date();
  // All-day / long events fire "event-day" at 09:00 HKT of their start day, which can be
  // hours after startTime or while a multi-day event is already underway, so load anything
  // overlapping [now-36h, now+25h] and let dueReminders decide.
  const windowStart = new Date(now.getTime() - 36 * HOUR);
  const windowEnd = new Date(now.getTime() + 25 * HOUR);

  const users = await prisma.user.findMany({
    where: { pushSubscriptions: { some: {} } },
    select: {
      id: true,
      pushSubscriptions: { select: { endpoint: true, p256dh: true, auth: true } },
      calendars: { where: { isVisible: true }, select: { id: true } },
      calendarMemberships: { select: { calendarId: true } },
    },
    take: MAX_USERS,
  });

  const calendarIds = new Set<string>();
  const userCalendars = new Map<string, Set<string>>();
  for (const u of users) {
    const ids = new Set<string>([
      ...u.calendars.map((c) => c.id),
      ...u.calendarMemberships.map((m) => m.calendarId),
    ]);
    userCalendars.set(u.id, ids);
    ids.forEach((id) => calendarIds.add(id));
  }

  const rows = calendarIds.size === 0 ? [] : await prisma.event.findMany({
    where: {
      calendarId: { in: [...calendarIds] },
      startTime: { lt: windowEnd },
      endTime: { gt: windowStart },
    },
    select: {
      id: true,
      calendarId: true,
      title: true,
      location: true,
      startTime: true,
      endTime: true,
      allDay: true,
      calendar: { select: { name: true } },
    },
    orderBy: { startTime: "asc" },
    take: MAX_EVENTS,
  });

  const eventsByCalendar = new Map<string, ReminderEvent[]>();
  for (const r of rows) {
    const list = eventsByCalendar.get(r.calendarId) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      location: r.location,
      startTime: r.startTime,
      endTime: r.endTime,
      allDay: r.allDay,
      calendarName: r.calendar.name,
    });
    eventsByCalendar.set(r.calendarId, list);
  }

  type Job = {
    userId: string;
    subs: (typeof users)[number]["pushSubscriptions"];
    event: ReminderEvent;
    kind: ReturnType<typeof dueReminders>[number]["kind"];
  };
  const jobs: Job[] = [];
  for (const user of users) {
    // An event can sit in several of a user's calendars (owned + membership); dedupe by id.
    const byId = new Map<string, ReminderEvent>();
    for (const calId of userCalendars.get(user.id) ?? []) {
      for (const e of eventsByCalendar.get(calId) ?? []) byId.set(e.id, e);
    }
    for (const d of dueReminders([...byId.values()], now)) {
      jobs.push({ userId: user.id, subs: user.pushSubscriptions, event: byId.get(d.eventId)!, kind: d.kind });
    }
  }

  let reminders = 0;
  let sent = 0;
  let failed = 0;
  let gone = 0;

  await pool(jobs, SEND_CONCURRENCY, async (job) => {
    // Claim first: the unique (userId, eventId, kind) makes concurrent runs race-safe.
    // createMany's count is 1 only for the run that inserted the row, so only it sends.
    const claimed = await prisma.pushReminderLog.createMany({
      data: [{ userId: job.userId, eventId: job.event.id, kind: job.kind }],
      skipDuplicates: true,
    });
    if (claimed.count === 0) return;
    reminders++;
    const payload = buildPayload(job.event, job.kind);
    const results = await Promise.allSettled(job.subs.map((s) => sendPush(s, payload)));
    const outcomes = results.map((r) => (r.status === "fulfilled" ? r.value : "failed"));
    for (const o of outcomes) {
      if (o === "sent") sent++;
      else if (o === "gone") gone++;
      else failed++;
    }
    // Every attempt failed transiently: release the claim so the next run retries
    // (still inside the late-grace window).
    if (outcomes.length > 0 && outcomes.every((o) => o === "failed")) {
      await prisma.pushReminderLog.deleteMany({
        where: { userId: job.userId, eventId: job.event.id, kind: job.kind },
      });
    }
  });

  return NextResponse.json({ users: users.length, reminders, sent, failed, gone });
}

export const GET = handle;
export const POST = handle;
