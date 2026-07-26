"use client";

/**
 * Reminder lead-time preference — how many minutes before an event start the
 * "starting soon" toast/notification should fire. Persisted in localStorage
 * so it survives reloads and (like the fired-reminder set) is shared across
 * tabs. A later settings-page control will read/write it through this
 * module's getter/setter and render its options from `REMINDER_LEAD_OPTIONS`,
 * rather than any consumer reaching into storage directly.
 */

const LEAD_MINUTES_KEY = "ec-reminder-lead-minutes";

/** Default lead time — the original hardcoded `SOON_MINUTES` value, preserved
 *  so behavior is unchanged for anyone who hasn't set a preference. */
export const DEFAULT_REMINDER_LEAD_MINUTES = 10;

/** Selectable lead times (minutes) offered to users. A future settings UI can
 *  map over this list to render its options without duplicating them. */
export const REMINDER_LEAD_OPTIONS = [5, 10, 15, 30, 60] as const;

export type ReminderLeadMinutes = (typeof REMINDER_LEAD_OPTIONS)[number];

/** Reads the persisted lead time, falling back to the default if unset,
 *  invalid, or storage is unavailable (SSR / private browsing). */
export function getReminderLeadMinutes(): number {
  if (typeof window === "undefined") return DEFAULT_REMINDER_LEAD_MINUTES;
  try {
    const raw = localStorage.getItem(LEAD_MINUTES_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REMINDER_LEAD_MINUTES;
  } catch {
    return DEFAULT_REMINDER_LEAD_MINUTES;
  }
}

/** Persists a new lead time. Intended to be driven by `REMINDER_LEAD_OPTIONS`,
 *  but any positive number of minutes is accepted. */
export function setReminderLeadMinutes(minutes: number): void {
  if (typeof window === "undefined" || !Number.isFinite(minutes) || minutes <= 0) return;
  try {
    localStorage.setItem(LEAD_MINUTES_KEY, String(minutes));
  } catch {}
}
