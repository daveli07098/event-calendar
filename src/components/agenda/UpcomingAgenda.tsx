"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupAgenda, type AgendaEvent } from "@/lib/agenda";
import { CATEGORY_EMOJI, type EventCategory } from "@/types";

interface UpcomingAgendaProps {
  events: AgendaEvent[];
  timeZone: string;
  days?: number;
  onEventClick?: (id: string) => void;
  /** Smaller variant for the home widget (fewer upcoming days). */
  compact?: boolean;
  /** Server render time (ISO) so the first client render matches the server HTML. */
  initialNow?: string;
}

const MIN = 60_000;
const COMPACT_DAYS = 5;

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

function dayHeader(date: string, timeZone: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  void timeZone;
  return `${g("weekday")} ${g("day")} ${g("month")}`;
}

/** "35 min", "2 h", "6 d" */
function span(ms: number): string {
  const m = Math.max(Math.round(ms / MIN), 1);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

function emojiFor(category?: string | null): string {
  return category && category in CATEGORY_EMOJI ? CATEGORY_EMOJI[category as EventCategory] : "";
}

function timeLabel(e: AgendaEvent, timeZone: string): string {
  return e.allDay ? "All day" : clock(e.start, timeZone);
}

function countdownChip(e: AgendaEvent, now: number, timeZone: string): string | null {
  if (e.allDay) return null;
  const s = new Date(e.start).getTime();
  const en = new Date(e.end).getTime();
  if (s > now) return `in ${span(s - now)}`;
  if (en > now) return en - s > 0 ? `now · ends ${clock(e.end, timeZone)}` : "now";
  return null;
}

function Accent({ color }: { color: string }) {
  return <span aria-hidden className="absolute inset-y-0 left-0 w-1 rounded-l-lg" style={{ backgroundColor: color }} />;
}

function SaleCard({ e, now, onClick }: { e: AgendaEvent; now: number; onClick?: (id: string) => void }) {
  const diff = new Date(e.start).getTime() - now;
  const urgent = diff < 60 * MIN;
  const label = diff <= 0 ? "open now" : `opens in ${span(diff)}`;
  return (
    <button
      type="button"
      data-testid="sale-card"
      data-urgent={urgent}
      onClick={() => onClick?.(e.id)}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border bg-card py-2.5 pl-4 pr-3 text-left text-sm transition-colors hover:bg-accent",
        urgent ? "border-red-500/60 bg-red-500/10" : "border-purple-500/40 bg-purple-500/5",
      )}
    >
      <Accent color={urgent ? "#ef4444" : "#a855f7"} />
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">🎟 {e.title}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
            urgent ? "bg-red-500 text-white" : "bg-purple-500/15 text-purple-700 dark:text-purple-300",
          )}
        >
          {label}
        </span>
      </div>
    </button>
  );
}

function EventCard({
  e, now, timeZone, size, onClick,
}: {
  e: AgendaEvent; now: number; timeZone: string; size: "large" | "medium"; onClick?: (id: string) => void;
}) {
  const chip = countdownChip(e, now, timeZone);
  const emoji = emojiFor(e.category);
  const large = size === "large";
  return (
    <button
      type="button"
      onClick={() => onClick?.(e.id)}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border bg-card pl-4 pr-3 text-left transition-colors hover:bg-accent",
        large ? "py-3" : "py-2",
      )}
    >
      <Accent color={e.color} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{timeLabel(e, timeZone)}</div>
          <div className={cn("truncate font-medium", large ? "text-base" : "text-sm")}>
            {emoji && <span className="mr-1">{emoji}</span>}
            {e.title}
          </div>
          {e.location && <div className="truncate text-xs text-muted-foreground">📍 {e.location}</div>}
        </div>
        {chip && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {chip}
          </span>
        )}
      </div>
    </button>
  );
}

function CompactRow({
  e, timeZone, onClick,
}: { e: AgendaEvent; timeZone: string; onClick?: (id: string) => void }) {
  const emoji = emojiFor(e.category);
  return (
    <button
      type="button"
      onClick={() => onClick?.(e.id)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
    >
      <span aria-hidden className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{e.allDay ? "All day" : clock(e.start, timeZone)}</span>
      <span className="min-w-0 truncate">{emoji && `${emoji} `}{e.title}</span>
    </button>
  );
}

function Ongoing({
  events, now, onClick,
}: { events: AgendaEvent[]; now: number; onClick?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!events.length) return null;
  const first = events[0];
  const endsIn = span(new Date(first.end).getTime() - now);
  return (
    <div data-testid="ongoing" className="rounded-md px-2 py-1 text-xs text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left hover:text-foreground"
      >
        <span className="min-w-0 truncate">
          🖼 {events.length} ongoing · {first.title} ends in {endsIn}
          {events.length > 1 ? " …" : ""}
        </span>
        {open ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {events.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onClick?.(e.id)}
              className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-foreground hover:bg-accent"
            >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
              <span className="truncate">{e.title}</span>
              <span className="shrink-0 text-muted-foreground">· {span(new Date(e.end).getTime() - now)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

export function UpcomingAgenda({ events, timeZone, days, onEventClick, compact = false, initialNow }: UpcomingAgendaProps) {
  const [now, setNow] = useState(() => (initialNow ? Date.parse(initialNow) : Date.now()));
  useEffect(() => {
    // Catch up from the server render time straight away, then tick every minute.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the external clock after hydration
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), MIN);
    return () => clearInterval(t);
  }, []);

  const windowDays = days ?? (compact ? COMPACT_DAYS : 14);
  const groups = useMemo(
    () => groupAgenda(events, new Date(now), timeZone, windowDays),
    [events, now, timeZone, windowDays],
  );

  return (
    <div data-testid="upcoming-agenda" className={cn("space-y-4", compact && "space-y-3")}>
      {groups.sales.length > 0 && (
        <section aria-label="Sales opening">
          <Heading>Sales opening</Heading>
          <div className="space-y-1.5">
            {groups.sales.map((e) => (
              <SaleCard key={e.id} e={e} now={now} onClick={onEventClick} />
            ))}
          </div>
        </section>
      )}

      <section aria-label="Today">
        <Heading>Today</Heading>
        {groups.today.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            Nothing today
          </p>
        ) : (
          <div className="space-y-2">
            {groups.today.map((e) => (
              <EventCard key={e.id} e={e} now={now} timeZone={timeZone} size="large" onClick={onEventClick} />
            ))}
          </div>
        )}
        <Ongoing events={groups.ongoing} now={now} onClick={onEventClick} />
      </section>

      {groups.tomorrow.length > 0 && (
        <section aria-label="Tomorrow">
          <Heading>Tomorrow</Heading>
          <div className="space-y-1.5">
            {groups.tomorrow.map((e) => (
              <EventCard key={e.id} e={e} now={now} timeZone={timeZone} size="medium" onClick={onEventClick} />
            ))}
          </div>
        </section>
      )}

      {groups.upcoming.map((d) => (
        <section key={d.date} aria-label={dayHeader(d.date, timeZone)}>
          <Heading>{dayHeader(d.date, timeZone)}</Heading>
          <div>
            {d.events.map((e) => (
              <CompactRow key={e.id} e={e} timeZone={timeZone} onClick={onEventClick} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
