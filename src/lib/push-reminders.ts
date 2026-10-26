import { SALE_TICKET_CALENDAR_NAME } from "@/lib/calendar-names";

export type ReminderKind =
  | "sale-1d"
  | "sale-1h"
  | "sale-15m"
  | "event-1d"
  | "event-1h"
  | "event-day";

export interface ReminderEvent {
  id: string;
  title: string;
  location: string | null;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  calendarName: string;
}

export interface DueReminder {
  eventId: string;
  kind: ReminderKind;
  fireAt: Date;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  eventId: string;
  kind: ReminderKind;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** The cron may run late; a reminder stays due this long after its fire time. */
export const LATE_GRACE_MS = 30 * MIN;
/** Events this long or longer get a single morning-of reminder instead. */
const LONG_EVENT_MS = 3 * DAY;
const TIME_ZONE = "Asia/Hong_Kong";
const HK_OFFSET_MS = 8 * HOUR; // Hong Kong has no DST
const EVENT_DAY_HOUR_HKT = 9;

/** YYYY-MM-DD of an instant in Asia/Hong_Kong. */
export function hkDateKey(d: Date): string {
  return new Date(d.getTime() + HK_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 09:00 HKT on the day the event starts. All-day events are stored as the
 * viewer's local midnight (EventModal) or UTC midnight (Google import), so an
 * exact UTC-midnight all-day start means that UTC date; anything else is
 * resolved on the HKT calendar.
 */
function eventDayFireTime(start: Date, allDay: boolean): Date {
  const utcMidnight = allDay && start.getTime() % DAY === 0;
  const dateKey = utcMidnight ? start.toISOString().slice(0, 10) : hkDateKey(start);
  const dayStartUtc = Date.parse(`${dateKey}T00:00:00Z`) - HK_OFFSET_MS;
  return new Date(dayStartUtc + EVENT_DAY_HOUR_HKT * HOUR);
}

const SALE_OFFSETS: [ReminderKind, number][] = [
  ["sale-1d", DAY],
  ["sale-1h", HOUR],
  ["sale-15m", 15 * MIN],
];
const EVENT_OFFSETS: [ReminderKind, number][] = [
  ["event-1d", DAY],
  ["event-1h", HOUR],
];

/** Which (event, kind) reminders should fire now. Pure — dedupe is the caller's job. */
export function dueReminders(events: ReminderEvent[], now: Date): DueReminder[] {
  const nowMs = now.getTime();
  const out: DueReminder[] = [];

  for (const e of events) {
    const startMs = e.startTime.getTime();
    const long = e.endTime.getTime() - startMs >= LONG_EVENT_MS;

    if (e.allDay || long) {
      const fireAt = eventDayFireTime(e.startTime, e.allDay);
      const f = fireAt.getTime();
      if (f <= nowMs && f > nowMs - LATE_GRACE_MS) {
        out.push({ eventId: e.id, kind: "event-day", fireAt });
      }
      continue;
    }

    // Never remind about something that has already started.
    if (startMs <= nowMs) continue;

    const offsets = e.calendarName === SALE_TICKET_CALENDAR_NAME ? SALE_OFFSETS : EVENT_OFFSETS;
    for (const [kind, offset] of offsets) {
      const f = startMs - offset;
      if (f <= nowMs && f > nowMs - LATE_GRACE_MS) {
        out.push({ eventId: e.id, kind, fireAt: new Date(f) });
      }
    }
  }
  return out;
}

const TITLES: Record<ReminderKind, string> = {
  "sale-1d": "🎫 Sale opens tomorrow",
  "sale-1h": "🎫 Sale opens in 1 hour",
  "sale-15m": "🎫 Sale opens in 15 min",
  "event-1d": "📅 Tomorrow",
  "event-1h": "📅 Starts in 1 hour",
  "event-day": "📅 Today",
};

/** Notification content for one due reminder. */
export function buildPayload(e: ReminderEvent, kind: ReminderKind): PushPayload {
  const parts = [e.title];
  if (!e.allDay) {
    parts.push(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(e.startTime) + " HKT",
    );
  }
  if (e.location) parts.push(e.location);
  return {
    title: TITLES[kind],
    body: parts.join(" · "),
    url: `/calendar?date=${hkDateKey(e.startTime)}&event=${encodeURIComponent(e.id)}`,
    tag: `${e.id}:${kind}`,
    eventId: e.id,
    kind,
  };
}
