import { SALE_TICKET_CALENDAR_NAME } from "@/lib/calendar-names";
import { isLongSpan, storedDateKey } from "@/lib/agenda";

// ── ICS helpers (RFC 5545) ────────────────────────────────────────────────────

/** Fold long lines at 75 octets (UTF-8) as required by RFC 5545 §3.1; never splits a code point. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const chunks: string[] = [];
  let cur = "";
  let curBytes = 0;
  let budget = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curBytes + n > budget) {
      chunks.push(cur);
      cur = " ";
      curBytes = 1;
      budget = 75;
    }
    cur += ch;
    curBytes += n;
  }
  chunks.push(cur);
  return chunks.join("\r\n");
}

/** Escape TEXT values: backslash, semicolon, comma, newlines */
export function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Only http(s) URLs without control characters are safe to emit as a URL property. */
export function safeUrl(u: string | null | undefined): string | null {
  if (!u || /[\x00-\x1f\x7f]/.test(u)) return null;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Format a Date as ICS UTC datetime: 20260426T090000Z */
export function fmtUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

/** Format a Date as ICS date-only: 20260426 */
export function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${dy}`;
}

export interface IcsEvent {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Build the VEVENT lines for one event. `extra` lines (URL, VALARMs) are
 * inserted before STATUS so the export route can omit them entirely.
 */
export function buildVevent(
  event: IcsEvent,
  dtstamp: string,
  extra: string[] = [],
): string[] {
  const lines: string[] = [
    "BEGIN:VEVENT",
    fold(`UID:${event.id}@event-calendar`),
    fold(`SUMMARY:${esc(event.title)}`),
    `DTSTAMP:${dtstamp}`,
    `CREATED:${fmtUtc(event.createdAt)}`,
    `LAST-MODIFIED:${fmtUtc(event.updatedAt)}`,
  ];

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${fmtDate(event.startTime)}`);
    // All-day dates are stored as UTC midnight with an EXCLUSIVE end (Google import,
    // FullCalendar selection; CalendarView feeds endTime straight to FullCalendar),
    // which is already the ICS DTEND convention. Zero/negative spans (e.g. events
    // imported from single-day .ics, where end == start) render as one day, so do the same.
    const endExclusive = new Date(event.endTime);
    if (endExclusive.getTime() <= event.startTime.getTime()) {
      endExclusive.setTime(event.startTime.getTime());
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    }
    lines.push(`DTEND;VALUE=DATE:${fmtDate(endExclusive)}`);
  } else {
    lines.push(`DTSTART:${fmtUtc(event.startTime)}`);
    lines.push(`DTEND:${fmtUtc(event.endTime)}`);
  }

  if (event.description) {
    lines.push(fold(`DESCRIPTION:${esc(event.description)}`));
  }
  if (event.location) {
    lines.push(fold(`LOCATION:${esc(event.location)}`));
  }

  lines.push(...extra);
  lines.push("STATUS:CONFIRMED");
  lines.push("END:VEVENT");
  return lines;
}

// ── Subscription feed ────────────────────────────────────────────────────────

export interface FeedEvent extends IcsEvent {
  /** Name of the owning calendar; "sale-ticket" events get sale-specific alarms. */
  calendarName: string;
  referenceUrl?: string | null;
}

const HOUR_MS = 3_600_000;
const TIME_ZONE = "Asia/Hong_Kong";
/** Hong Kong is UTC+8 with no DST: 09:00 HKT = 01:00Z, 20:00 HKT = 12:00Z. */
const MORNING_OF_UTC_HOUR = 1;
const EVENING_BEFORE_UTC_HOUR = 12;

function alarm(trigger: string, description: string): string[] {
  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    fold(`DESCRIPTION:${esc(description)}`),
    trigger,
    "END:VALARM",
  ];
}

/** `hour` UTC on the HKT start date (UTC date for UTC-midnight all-day) plus `dayOffset` days. */
function utcAt(event: FeedEvent, dayOffset: number, hour: number): Date {
  const [y, m, d] = storedDateKey(event.startTime, event.allDay, TIME_ZONE).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset, hour));
}

/**
 * Alarm rules (documented in docs/ if you change them):
 * - sale events:          -P1D and -PT15M before start.
 * - all-day or long (see isLongSpan): absolute alarms at 09:00 Asia/Hong_Kong on the start
 *                         day and 20:00 HKT the day before (sent as UTC "Z").
 * - other timed events:   -P1D and -PT1H before start.
 */
export function buildAlarms(event: FeedEvent): string[] {
  const title = event.title;
  if (event.calendarName === SALE_TICKET_CALENDAR_NAME) {
    return [
      ...alarm("TRIGGER:-P1D", `🎫 Sale opens tomorrow: ${title}`),
      ...alarm("TRIGGER:-PT15M", `🎫 Sale opens in 15 min: ${title}`),
    ];
  }
  const long = isLongSpan(
    { start: event.startTime, end: event.endTime, allDay: event.allDay },
    TIME_ZONE,
  );
  if (event.allDay || long) {
    return [
      ...alarm(
        `TRIGGER;VALUE=DATE-TIME:${fmtUtc(utcAt(event, -1, EVENING_BEFORE_UTC_HOUR))}`,
        `⏰ Tomorrow: ${title}`,
      ),
      ...alarm(
        `TRIGGER;VALUE=DATE-TIME:${fmtUtc(utcAt(event, 0, MORNING_OF_UTC_HOUR))}`,
        `⏰ Today: ${title}`,
      ),
    ];
  }
  return [
    ...alarm("TRIGGER:-P1D", `⏰ Tomorrow: ${title}`),
    ...alarm("TRIGGER:-PT1H", `⏰ In 1 hour: ${title}`),
  ];
}

export function buildCalendarFeed(opts: {
  name: string;
  events: FeedEvent[];
  now: Date;
}): string {
  const dtstamp = fmtUtc(opts.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Event Calendar//Event Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${esc(opts.name)}`),
    "X-WR-TIMEZONE:UTC",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of opts.events) {
    const url = safeUrl(event.referenceUrl);
    const extra = [
      ...(url ? [fold(`URL:${url}`)] : []),
      ...buildAlarms(event),
    ];
    lines.push(...buildVevent(event, dtstamp, extra));
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
