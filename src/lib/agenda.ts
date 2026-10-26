/**
 * Pure grouping logic for the "Upcoming" agenda (home dashboard + default
 * calendar view). No prisma/react imports so it is trivially testable.
 *
 * Product rules: ticket sales and short events (concerts, 1-2 days) are shown
 * prominently; pop-up stores / exhibitions that span many days are collapsed
 * into "ongoing" so they do not crowd the day lists.
 */

export interface AgendaEvent {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO (exclusive for allDay events)
  allDay: boolean;
  calendarId: string;
  calendarName: string;
  color: string;
  category?: string | null;
  location?: string | null;
  isSale: boolean;
}

export interface AgendaDay {
  date: string; // YYYY-MM-DD in timeZone
  events: AgendaEvent[];
}

export interface AgendaGroups {
  sales: AgendaEvent[];
  today: AgendaEvent[];
  tomorrow: AgendaEvent[];
  upcoming: AgendaDay[];
  ongoing: AgendaEvent[];
}

/** Events spanning at least this many calendar days count as "long". */
export const LONG_EVENT_DAYS = 3;

const HOUR_MS = 3_600_000;
const SALE_WINDOW_DAYS = 7;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of an instant as seen in `timeZone`. */
export function dayKey(date: Date, timeZone: string): string {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function keyToUtcDay(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function addDaysToKey(key: string, n: number): string {
  return new Date((keyToUtcDay(key) + n) * 86_400_000).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/**
 * Calendar date (YYYY-MM-DD) a stored instant belongs to. All-day events are
 * normally stored at UTC midnight (Google import, current form), so an exact
 * UTC-midnight all-day instant means that UTC date whatever `timeZone` is;
 * older rows stored at local (HKT) midnight, and timed events, resolve in `timeZone`.
 */
export function storedDateKey(date: Date, allDay: boolean, timeZone: string): string {
  if (allDay && date.getTime() % DAY_MS === 0) return date.toISOString().slice(0, 10);
  return dayKey(date, timeZone);
}

type Span = { start: string | Date; end: string | Date; allDay: boolean };

/** First and last calendar day (inclusive) an event touches in `timeZone`. */
function dayRange(e: Span, timeZone: string): { first: string; last: string } {
  const s = new Date(e.start);
  const en = new Date(e.end);
  const first = storedDateKey(s, e.allDay, timeZone);
  // End is exclusive (all-day convention; also a timed event ending exactly at
  // midnight does not touch the next day).
  let last = first;
  if (en.getTime() > s.getTime()) {
    last = e.allDay
      ? addDaysToKey(storedDateKey(en, true, timeZone), -1)
      : dayKey(new Date(en.getTime() - 1), timeZone);
  }
  return { first, last: last < first ? first : last };
}

/**
 * The single definition of a "long" event (collapsed as ongoing in the UI, one
 * morning-of reminder in ICS/push): touches at least LONG_EVENT_DAYS calendar
 * days AND lasts at least 48h, so a short overnight event is not long.
 */
export function isLongSpan(e: Span, timeZone: string): boolean {
  const { first, last } = dayRange(e, timeZone);
  const durationMs = new Date(e.end).getTime() - new Date(e.start).getTime();
  return (
    keyToUtcDay(last) - keyToUtcDay(first) + 1 >= LONG_EVENT_DAYS && durationMs >= 2 * DAY_MS
  );
}

export function isLongEvent(e: AgendaEvent, timeZone: string): boolean {
  return isLongSpan(e, timeZone);
}

export function groupAgenda(
  events: AgendaEvent[],
  now: Date,
  timeZone: string,
  days = 14,
): AgendaGroups {
  const todayKey = dayKey(now, timeZone);
  const lastWindowKey = addDaysToKey(todayKey, Math.max(days, 1) - 1);
  const nowMs = now.getTime();

  const sales = events
    .filter((e) => {
      if (!e.isSale) return false;
      const s = new Date(e.start).getTime();
      return s >= nowMs - HOUR_MS && s <= nowMs + SALE_WINDOW_DAYS * 24 * HOUR_MS;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  type Entry = { e: AgendaEvent; first: string; last: string; long: boolean };
  const entries: Entry[] = events
    .filter((e) => !e.isSale)
    .map((e) => {
      const r = dayRange(e, timeZone);
      return { e, ...r, long: isLongSpan(e, timeZone) };
    });

  const ongoing = entries
    .filter(
      (x) =>
        x.long &&
        x.first < todayKey &&
        x.last >= todayKey &&
        new Date(x.e.end).getTime() > nowMs,
    )
    .sort((a, b) => new Date(a.e.end).getTime() - new Date(b.e.end).getTime())
    .map((x) => x.e);

  const rank = (x: Entry) => (x.long ? 2 : x.e.allDay ? 1 : 0);
  const forDay = (key: string): AgendaEvent[] =>
    entries
      .filter((x) => {
        if (x.long) return x.first === key; // long events only on their start day
        if (!(x.first <= key && key <= x.last)) return false;
        // drop timed events that already ended
        if (key === todayKey && !x.e.allDay && new Date(x.e.end).getTime() <= nowMs) return false;
        return true;
      })
      .sort(
        (a, b) =>
          rank(a) - rank(b) || new Date(a.e.start).getTime() - new Date(b.e.start).getTime(),
      )
      .map((x) => x.e);

  const today = forDay(todayKey);
  const tomorrowKey = addDaysToKey(todayKey, 1);
  const tomorrow = days > 1 ? forDay(tomorrowKey) : [];

  const upcoming: AgendaDay[] = [];
  for (let k = addDaysToKey(todayKey, 2); k <= lastWindowKey; k = addDaysToKey(k, 1)) {
    const evs = forDay(k);
    if (evs.length) upcoming.push({ date: k, events: evs });
  }

  return { sales, today, tomorrow, upcoming, ongoing };
}
