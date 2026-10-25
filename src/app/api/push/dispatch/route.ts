import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushConfigured, sendPush } from "@/lib/push";
import { buildPayload, dueReminders, type ReminderEvent } from "@/lib/push-reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_USERS = 200;
const MAX_EVENTS_PER_USER = 500;
const HOUR = 3_600_000;

/**
 * Push reminder dispatcher, hit every 5 minutes by a GitHub Action
 * (.github/workflows/push-reminders.yml). Auth: `Authorization: Bearer <CRON_SECRET>`
 * (or `?key=` for manual runs), same as the World Cup cron.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const key = req.nextUrl.searchParams.get("key");
  if (req.headers.get("authorization") !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!pushConfigured()) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 });
  }

  const now = new Date();
  const from = new Date(now.getTime() - HOUR);
  const to = new Date(now.getTime() + 25 * HOUR);

  const users = await prisma.user.findMany({
    where: { pushSubscriptions: { some: {} } },
    select: { id: true, pushSubscriptions: { select: { endpoint: true, p256dh: true, auth: true } } },
    take: MAX_USERS,
  });

  let reminders = 0;
  let sent = 0;
  let failed = 0;
  let gone = 0;

  for (const user of users) {
    const rows = await prisma.event.findMany({
      where: {
        startTime: { gte: from, lte: to },
        calendar: {
          OR: [
            { userId: user.id, isVisible: true },
            { members: { some: { userId: user.id } } },
          ],
        },
      },
      select: {
        id: true,
        title: true,
        location: true,
        startTime: true,
        endTime: true,
        allDay: true,
        calendar: { select: { name: true } },
      },
      orderBy: { startTime: "asc" },
      take: MAX_EVENTS_PER_USER,
    });
    const events: ReminderEvent[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      location: r.location,
      startTime: r.startTime,
      endTime: r.endTime,
      allDay: r.allDay,
      calendarName: r.calendar.name,
    }));
    const due = dueReminders(events, now);
    if (due.length === 0) continue;

    // Claim first: the unique (userId, eventId, kind) makes concurrent runs race-safe.
    // createMany's count is 1 only for the run that inserted the row, so only it sends.
    for (const d of due) {
      const claimed = await prisma.pushReminderLog.createMany({
        data: [{ userId: user.id, eventId: d.eventId, kind: d.kind }],
        skipDuplicates: true,
      });
      if (claimed.count === 0) continue;
      const ev = events.find((e) => e.id === d.eventId)!;
      const payload = buildPayload(ev, d.kind);
      reminders++;
      const results = await Promise.all(user.pushSubscriptions.map((s) => sendPush(s, payload)));
      for (const r of results) {
        if (r === "sent") sent++;
        else if (r === "gone") gone++;
        else failed++;
      }
    }
  }

  return NextResponse.json({ users: users.length, reminders, sent, failed, gone });
}

export const GET = handle;
export const POST = handle;
