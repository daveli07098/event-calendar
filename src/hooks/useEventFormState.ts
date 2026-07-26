"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { EventType, EventFormData, EventCategory } from "@/types";

export interface EventFormRange {
  start: string;
  end: string;
  allDay: boolean;
}

interface UseEventFormStateArgs {
  open: boolean;
  event: EventType | null;
  initialData?: EventFormData;
  initialRange?: EventFormRange | null;
  defaultCalendarId: string;
}

interface FormSnapshot {
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  calendarId: string;
  category: EventCategory | null;
  artist: string;
  referenceUrl: string;
  seatingPlanUrl: string;
}

const toLocalDateInput = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA");
};

const toLocalDateTimeInput = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

/** Extracts "HH:MM" from a datetime-local value ("YYYY-MM-DDTHH:MM"); undefined for date-only values. */
const timeOfDay = (value: string): string | undefined =>
  value.length > 10 ? value.slice(11, 16) : undefined;

/**
 * Owns the EventModal form fields: their initialization (existing event ->
 * copied initial data -> selected range -> empty defaults), the previous
 * time-of-day memory used by the all-day toggle, and a dirty snapshot for
 * the unsaved-changes guard.
 *
 * Initialization only (re)runs on a genuine "open transition" — the modal
 * opening, or switching to a different event's id — never merely because the
 * `event` object identity changed while the same event stays open (e.g. after
 * Sync/Update Teams replaces the `event` prop). That would otherwise wipe out
 * whatever the user had typed mid-edit.
 */
export function useEventFormState({ open, event, initialData, initialRange, defaultCalendarId }: UseEventFormStateArgs) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTimeRaw] = useState("");
  const [endTime, setEndTimeRaw] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [calendarId, setCalendarId] = useState(defaultCalendarId);
  const [category, setCategory] = useState<EventCategory | null>(null);
  const [artist, setArtist] = useState("");
  // Additional info / reference URL — a later-announced page (e.g. per-station
  // ticketing) that Sync prefers over the description's Ticket URL when set
  const [referenceUrl, setReferenceUrl] = useState("");
  const [seatingPlanUrl, setSeatingPlanUrl] = useState("");

  // Dirty-check baseline — snapshotted whenever we genuinely (re)initialize,
  // and refreshed for individual fields after an in-place server sync so
  // already-saved data isn't flagged as "unsaved".
  const [baseline, setBaseline] = useState<FormSnapshot | null>(null);

  // Remembers the last known time-of-day (start/end "HH:MM") so toggling All
  // Day on then off restores the original times instead of the wall clock.
  const lastTimeOfDayRef = useRef<{ start?: string; end?: string }>({});

  // Tracks the previous open/event-id so the init effect can tell a genuine
  // open transition (or a switch to a different event) apart from the same
  // event's object reference merely changing underneath an open modal.
  const prevOpenRef = useRef(false);
  const prevEventIdRef = useRef<string | null>(null);
  const prevInitialDataRef = useRef<EventFormData | undefined>(undefined);
  const prevInitialRangeRef = useRef<EventFormRange | null | undefined>(null);

  // Bumped every time the block below actually re-initializes — lets the
  // caller re-sync unrelated ephemeral state (sync error/preview, related
  // events) on the same "real reinit" signal without duplicating the gating.
  const [initVersion, setInitVersion] = useState(0);

  // Initialize fields on a genuine open transition.
  // Priority: existing event edit -> copied initial data -> selected range -> empty defaults.
  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }

    const eventId = event?.id ?? null;
    const isNewOpen = !prevOpenRef.current;
    const isDifferentEvent = eventId !== prevEventIdRef.current;
    const isNewEventDataChanged =
      !event && (initialData !== prevInitialDataRef.current || initialRange !== prevInitialRangeRef.current);

    prevOpenRef.current = true;
    prevEventIdRef.current = eventId;
    prevInitialDataRef.current = initialData;
    prevInitialRangeRef.current = initialRange;

    if (!isNewOpen && !isDifferentEvent && !isNewEventDataChanged) return;

    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const nowLocal = toLocalDateTimeInput(now.toISOString());
    const oneHourLaterLocal = toLocalDateTimeInput(oneHourLater.toISOString());

    let next: FormSnapshot;

    if (event) {
      const eventDescription = event.description ?? "";
      const seating = eventDescription.match(/^Seating Plan: (https?:\/\/\S+)/m)?.[1] ?? "";
      const start = event.allDay ? toLocalDateInput(event.startTime) : toLocalDateTimeInput(event.startTime);
      const end = event.allDay ? toLocalDateInput(event.endTime) : toLocalDateTimeInput(event.endTime);
      next = {
        title: event.title ?? "",
        description: eventDescription,
        location: event.location ?? "",
        startTime: start,
        endTime: end,
        allDay: event.allDay,
        calendarId: event.calendarId || defaultCalendarId,
        category: event.category ?? null,
        artist: event.artist ?? "",
        referenceUrl: event.referenceUrl ?? "",
        seatingPlanUrl: seating,
      };
    } else if (initialData) {
      const copiedDescription = initialData.description ?? "";
      const seating = copiedDescription.match(/^Seating Plan: (https?:\/\/\S+)/m)?.[1] ?? "";
      const start = initialData.allDay ? toLocalDateInput(initialData.startTime) : toLocalDateTimeInput(initialData.startTime);
      const end = initialData.allDay ? toLocalDateInput(initialData.endTime) : toLocalDateTimeInput(initialData.endTime);
      next = {
        title: initialData.title ?? "",
        description: copiedDescription,
        location: initialData.location ?? "",
        startTime: start,
        endTime: end,
        allDay: Boolean(initialData.allDay),
        calendarId: initialData.calendarId || defaultCalendarId,
        category: initialData.category ?? null,
        artist: initialData.artist ?? "",
        referenceUrl: initialData.referenceUrl ?? "",
        seatingPlanUrl: seating,
      };
    } else if (initialRange) {
      const start = initialRange.allDay ? initialRange.start.slice(0, 10) : toLocalDateTimeInput(initialRange.start);
      const end = initialRange.allDay ? initialRange.end.slice(0, 10) : toLocalDateTimeInput(initialRange.end);
      next = {
        title: "",
        description: "",
        location: "",
        startTime: start,
        endTime: end,
        allDay: initialRange.allDay,
        calendarId: defaultCalendarId,
        category: null,
        artist: "",
        referenceUrl: "",
        seatingPlanUrl: "",
      };
    } else {
      next = {
        title: "",
        description: "",
        location: "",
        startTime: nowLocal,
        endTime: oneHourLaterLocal,
        allDay: false,
        calendarId: defaultCalendarId,
        category: null,
        artist: "",
        referenceUrl: "",
        seatingPlanUrl: "",
      };
    }

    setTitle(next.title);
    setDescription(next.description);
    setLocation(next.location);
    setStartTimeRaw(next.startTime);
    setEndTimeRaw(next.endTime);
    setAllDay(next.allDay);
    setCalendarId(next.calendarId);
    setCategory(next.category);
    setArtist(next.artist);
    setReferenceUrl(next.referenceUrl);
    setSeatingPlanUrl(next.seatingPlanUrl);
    setBaseline(next);
    setInitVersion((v) => v + 1);

    lastTimeOfDayRef.current = !next.allDay
      ? { start: timeOfDay(next.startTime), end: timeOfDay(next.endTime) }
      : {};
  }, [open, event, initialData, initialRange, defaultCalendarId]);

  // Plain setters for direct user edits — also keep the time-of-day memory
  // fresh so a later all-day round trip restores the most recent times.
  const setStartTime = useCallback((value: string) => {
    setStartTimeRaw(value);
    const hhmm = timeOfDay(value);
    if (hhmm) lastTimeOfDayRef.current = { ...lastTimeOfDayRef.current, start: hhmm };
  }, []);

  const setEndTime = useCallback((value: string) => {
    setEndTimeRaw(value);
    const hhmm = timeOfDay(value);
    if (hhmm) lastTimeOfDayRef.current = { ...lastTimeOfDayRef.current, end: hhmm };
  }, []);

  /** Swap start/end (used when the user fixes an inverted date range). */
  const swapStartEnd = useCallback(() => {
    setStartTime(endTime);
    setEndTime(startTime);
  }, [startTime, endTime, setStartTime, setEndTime]);

  // All-day toggle — restores the previously-known time-of-day when switching
  // back to a timed event, instead of clobbering it with the current wall
  // clock. Only brand-new events with no prior time fall back to "now".
  const toggleAllDay = useCallback((checked: boolean) => {
    setAllDay(checked);
    if (!checked) {
      // Switching to timed — restore the last known time-of-day if we have
      // one; otherwise (a brand-new event that was never timed) default to now.
      const dateBase = startTime.slice(0, 10);
      const endBase = endTime.slice(0, 10);
      const remembered = lastTimeOfDayRef.current;
      let newStart: string;
      let newEnd: string;
      if (remembered.start && remembered.end) {
        newStart = `${dateBase}T${remembered.start}`;
        newEnd = `${endBase}T${remembered.end}`;
      } else {
        const now = new Date();
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const eh = String(oneHourLater.getHours()).padStart(2, "0");
        const em = String(oneHourLater.getMinutes()).padStart(2, "0");
        newStart = `${dateBase}T${hh}:${mm}`;
        newEnd = `${endBase}T${eh}:${em}`;
      }
      setStartTimeRaw(newStart);
      setEndTimeRaw(newEnd);
      lastTimeOfDayRef.current = { start: timeOfDay(newStart), end: timeOfDay(newEnd) };
    } else {
      // Switching to all-day — remember the current time-of-day before
      // stripping it, so it can be restored if the user untoggles.
      lastTimeOfDayRef.current = {
        start: timeOfDay(startTime) ?? lastTimeOfDayRef.current.start,
        end: timeOfDay(endTime) ?? lastTimeOfDayRef.current.end,
      };
      setStartTimeRaw(startTime.slice(0, 10));
      setEndTimeRaw(endTime.slice(0, 10));
    }
  }, [startTime, endTime]);

  // After an in-place server sync (Sync / Update Teams) applies specific
  // fields, fold them into the dirty baseline too — they're now what's
  // persisted, so they shouldn't read as "unsaved" in the guard.
  const applyServerFields = useCallback((fields: Partial<Pick<FormSnapshot, "title" | "description" | "location">>) => {
    if (fields.title !== undefined) setTitle(fields.title);
    if (fields.description !== undefined) setDescription(fields.description);
    if (fields.location !== undefined) setLocation(fields.location);
    setBaseline((prev) => (prev ? { ...prev, ...fields } : prev));
  }, []);

  const isDirty = Boolean(
    baseline &&
      (title !== baseline.title ||
        description !== baseline.description ||
        location !== baseline.location ||
        startTime !== baseline.startTime ||
        endTime !== baseline.endTime ||
        allDay !== baseline.allDay ||
        calendarId !== baseline.calendarId ||
        category !== baseline.category ||
        artist !== baseline.artist ||
        referenceUrl !== baseline.referenceUrl ||
        seatingPlanUrl !== baseline.seatingPlanUrl),
  );

  return {
    title, setTitle,
    description, setDescription,
    location, setLocation,
    startTime, setStartTime,
    endTime, setEndTime,
    allDay, toggleAllDay,
    calendarId, setCalendarId,
    category, setCategory,
    artist, setArtist,
    referenceUrl, setReferenceUrl,
    seatingPlanUrl, setSeatingPlanUrl,
    swapStartEnd,
    applyServerFields,
    isDirty,
    initVersion,
  };
}
