"use client";

/**
 * Cross-tab, reload-durable "already fired" tracking for event reminders.
 *
 * Fired keys live in localStorage (shared by every tab of this origin,
 * unlike the sessionStorage this replaced) so that:
 *  - dismissing/seeing a reminder in one tab prevents it firing again in
 *    another tab, and
 *  - the fired-set survives a reload instead of resetting every session.
 *
 * Cross-tab coordination: a BroadcastChannel announces a key the instant a
 * tab marks it fired, so if another tab's poll races the same event within
 * the same tick (both read "not fired yet" before either writes) that other
 * tab can immediately dismiss its duplicate toast instead of leaving two
 * shown. We picked BroadcastChannel over listening to the `storage` event
 * because: (1) `storage` only fires in *other* tabs with the full
 * before/after stringified payload, which is a clumsy way to carry a single
 * "this key just fired" signal; (2) a dedicated channel keeps this pub/sub
 * concern decoupled from the storage persistence format, so either can change
 * independently; (3) the same channel can be reused later (e.g. a settings
 * page pushing a live lead-time change to already-open tabs) without
 * overloading localStorage semantics further. Environments without
 * BroadcastChannel (very old browsers) simply fall back to the localStorage
 * check alone — still correct, just not instant.
 */

const FIRED_KEY = "ec-reminder-fired"; // localStorage key: JSON array of FiredEntry
const CHANNEL_NAME = "ec-reminders";
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // prune entries for events that started >24h ago

interface FiredEntry {
  key: string; // `${eventId}:soon` | `${eventId}:now`
  start: number; // event.startTime as epoch ms — used only to prune stale entries
}

interface FiredMessage {
  type: "fired";
  key: string;
}

function readEntries(): FiredEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is FiredEntry =>
        !!e && typeof e.key === "string" && typeof e.start === "number"
    );
  } catch {
    return [];
  }
}

/** Prunes stale entries (events long past) and persists. Called on every
 *  write so the set can't grow forever across months of daily use. */
function writeEntries(entries: FiredEntry[]): void {
  const now = Date.now();
  const pruned = entries.filter((e) => now - e.start < STALE_AFTER_MS);
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(pruned));
  } catch {}
}

/** Has this reminder key already fired (in this tab or another)? */
export function hasFired(key: string): boolean {
  return readEntries().some((e) => e.key === key);
}

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (channel === undefined) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

/** Records a reminder key as fired and prunes stale entries. `eventStart`
 *  (epoch ms) is stored alongside the key purely so it can later be pruned
 *  once well in the past. Announces the key to other tabs. */
export function markFired(key: string, eventStart: number): void {
  if (typeof window === "undefined") return;
  const entries = readEntries();
  if (entries.some((e) => e.key === key)) return;
  entries.push({ key, start: eventStart });
  writeEntries(entries);
  try {
    getChannel()?.postMessage({ type: "fired", key } satisfies FiredMessage);
  } catch {}
}

/** Subscribes to "fired" announcements from other tabs. Returns an
 *  unsubscribe function; no-ops in environments without BroadcastChannel
 *  (the localStorage check alone still prevents re-firing, just not
 *  instantly on the next poll rather than immediately). */
export function onFiredElsewhere(handler: (key: string) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (event: MessageEvent<FiredMessage>) => {
    if (event.data?.type === "fired") handler(event.data.key);
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}
