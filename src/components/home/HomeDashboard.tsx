"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CalendarDays, Check, Pin, PinOff, Ticket, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayKey, groupAgenda, type AgendaEvent } from "@/lib/agenda";
import { urlFromText } from "@/lib/notes";
import { buttonVariants } from "@/components/ui/button";
import { UpcomingAgenda } from "@/components/agenda/UpcomingAgenda";

export interface HomeBookmark {
  eventId: string;
  title: string;
  start: string; // ISO
  allDay: boolean;
  color: string;
  countdown: boolean;
}

export interface HomeNote {
  id: string;
  text: string;
  url?: string | null;
}

interface HomeDashboardProps {
  firstName: string;
  nowIso: string;
  timeZone: string;
  events: AgendaEvent[];
  countdowns: HomeBookmark[];
  bookmarks: HomeBookmark[];
  notes: HomeNote[];
}

const HOUR_MS = 3_600_000;
const MAX_COUNTDOWNS = 4;

function hourIn(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date),
  );
}

export function greetingFor(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Whole calendar days from `now` to the event's start day, in timeZone. */
export function daysUntil(startIso: string, now: Date, timeZone: string): number {
  const a = Date.parse(`${dayKey(now, timeZone)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(new Date(startIso), timeZone)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function countdownLabel(days: number): { big: string; small: string } {
  if (days <= 0) return { big: "Today!", small: "" };
  return { big: String(days), small: days === 1 ? "day" : "days" };
}

function summarize(events: AgendaEvent[], now: Date, timeZone: string): string {
  const g = groupAgenda(events, now, timeZone, 14);
  const parts: string[] = [];
  const n = g.today.length;
  parts.push(n === 0 ? "Nothing on today" : `${n} event${n === 1 ? "" : "s"} today`);
  const next = g.sales.find((s) => new Date(s.start).getTime() > now.getTime());
  if (next) {
    const h = Math.max(Math.round((new Date(next.start).getTime() - now.getTime()) / HOUR_MS), 1);
    const when = h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
    parts.push(`${g.sales.length === 1 ? "1 sale opens" : `${g.sales.length} sales, next opens`} in ${when}`);
  }
  return parts.join(" · ");
}

const card = "rounded-xl border bg-card p-4";
const heading = "mb-3 text-sm font-semibold";

export function HomeDashboard(props: HomeDashboardProps) {
  const { firstName, timeZone, events } = props;
  const router = useRouter();
  const now = useMemo(() => new Date(props.nowIso), [props.nowIso]);

  const [bookmarks, setBookmarks] = useState(props.bookmarks);
  const [pinned, setPinned] = useState(props.countdowns);
  const [notes, setNotes] = useState(props.notes);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "long", day: "numeric", month: "long",
  }).format(now);
  const summary = summarize(events, now, timeZone);

  const openEvent = (id: string) => {
    const e = events.find((x) => x.id === id);
    const date = e ? dayKey(new Date(e.start), timeZone) : dayKey(now, timeZone);
    router.push(`/calendar?event=${id}&date=${date}`);
  };

  async function setCountdown(b: HomeBookmark, countdown: boolean) {
    const prevPinned = pinned;
    const prevBookmarks = bookmarks;
    const next = { ...b, countdown };
    setBookmarks((list) => list.map((x) => (x.eventId === b.eventId ? next : x)));
    setPinned((list) =>
      countdown
        ? list.some((x) => x.eventId === b.eventId) ? list : [...list, next].sort((x, y) => x.start.localeCompare(y.start))
        : list.filter((x) => x.eventId !== b.eventId),
    );
    try {
      const res = await fetch(`/api/bookmarks/${b.eventId}/countdown`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countdown }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setPinned(prevPinned);
      setBookmarks(prevBookmarks);
      setError("Could not update the countdown");
    }
  }

  async function saveNote() {
    const text = draft.trim();
    if (!text) return;
    const tempId = `tmp-${Date.now()}`;
    setDraft("");
    setError(null);
    setNotes((l) => [{ id: tempId, text, url: urlFromText(text) }, ...l]);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      const saved: HomeNote = await res.json();
      setNotes((l) => l.map((n) => (n.id === tempId ? { id: saved.id, text: saved.text, url: saved.url } : n)));
    } catch {
      setNotes((l) => l.filter((n) => n.id !== tempId));
      setDraft(text);
      setError("Could not save the note");
    }
  }

  async function mutateNote(note: HomeNote, init: RequestInit) {
    const prev = notes;
    setNotes((l) => l.filter((n) => n.id !== note.id));
    try {
      const res = await fetch(`/api/notes/${note.id}`, init);
      if (!res.ok) throw new Error();
    } catch {
      setNotes(prev);
      setError("Could not update the note");
    }
  }

  const shownPins = pinned.slice(0, MAX_COUNTDOWNS);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greetingFor(hourIn(now, timeZone))}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
        <p className="mt-1 text-sm">{summary}</p>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Upcoming" className="min-w-0">
          <UpcomingAgenda events={events} timeZone={timeZone} days={14} onEventClick={openEvent} initialNow={props.nowIso} />
        </section>

        <aside className="min-w-0 space-y-4">
          <section aria-label="Countdowns" className={card}>
            <h2 className={heading}>Countdowns</h2>
            {shownPins.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pin an event from its bookmark to count down</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {shownPins.map((p) => {
                  const { big, small } = countdownLabel(daysUntil(p.start, now, timeZone));
                  return (
                    <li
                      key={p.eventId}
                      data-testid="countdown-tile"
                      className="group relative overflow-hidden rounded-lg border bg-background p-3"
                    >
                      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: p.color }} />
                      <div className="pl-1">
                        <div className="text-2xl font-bold leading-none text-primary">
                          {big} <span className="text-sm font-medium text-muted-foreground">{small}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">{p.title}</div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Unpin countdown for ${p.title}`}
                        onClick={() => setCountdown(p, false)}
                        className="absolute right-1 top-1 rounded p-1 text-muted-foreground hover:bg-accent"
                      >
                        <PinOff className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Bookmarked" className={card}>
            <h2 className={heading}>Bookmarked</h2>
            {bookmarks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing bookmarked in the next 60 days</p>
            ) : (
              <ul className="space-y-1">
                {bookmarks.map((b) => (
                  <li key={b.eventId} className="flex items-center gap-2 text-sm">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                    <button
                      type="button"
                      onClick={() => openEvent(b.eventId)}
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                    >
                      {b.title}
                    </button>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(new Date(b.start))}
                    </span>
                    <button
                      type="button"
                      aria-label={`${b.countdown ? "Unpin" : "Pin"} countdown for ${b.title}`}
                      aria-pressed={b.countdown}
                      onClick={() => setCountdown(b, !b.countdown)}
                      className={cn(
                        "shrink-0 rounded p-1 hover:bg-accent",
                        b.countdown ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      <Pin className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Quick capture" className={card}>
            <h2 className={heading}>Quick capture</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveNote();
              }}
              className="flex gap-2"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="A thought, a to-do, a ticket link…"
                aria-label="Quick note"
                maxLength={2000}
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
              />
              <button type="submit" disabled={!draft.trim()} className={buttonVariants({ size: "sm" })}>
                Save
              </button>
            </form>
            {notes.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 text-sm">
                    <button
                      type="button"
                      aria-label={`Mark done: ${n.text}`}
                      onClick={() => mutateNote(n, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ done: true }),
                      })}
                      className="mt-0.5 shrink-0 rounded border p-0.5 text-muted-foreground hover:bg-accent"
                    >
                      <Check className="size-3" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="break-words">{n.text}</div>
                      {n.url && (
                        <Link
                          href={`/tickets?url=${encodeURIComponent(n.url)}`}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Scan in Event Section →
                        </Link>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete note: ${n.text}`}
                      onClick={() => mutateNote(n, { method: "DELETE" })}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <nav aria-label="Quick links" className="flex flex-wrap gap-2">
            <Link href="/calendar" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <CalendarDays /> Calendar
            </Link>
            <Link href="/tickets" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Ticket /> Event Section
            </Link>
            <Link href="/settings" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Bell /> Reminders setup
            </Link>
          </nav>
        </aside>
      </div>
    </div>
  );
}
