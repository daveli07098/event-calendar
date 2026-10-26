"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import type { CalendarApi } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  DatesSetArg,
  EventContentArg,
  MoreLinkArg,
} from "@fullcalendar/core";
import type {
  DateClickArg,
  EventResizeDoneArg,
} from "@fullcalendar/interaction";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import type { CalendarType, EventType, EventFormData, EventCategory, BookmarkedEvent } from "@/types";
import { CATEGORY_EMOJI } from "@/types";
import { EventModal } from "@/components/events/EventModal";
import { detectLocationTag } from "@/lib/location-tags";
import { DayDetailPanel } from "@/components/calendar/DayDetailPanel";
import { BookmarkPopover } from "@/components/calendar/BookmarkPopover";
import { EventReminder } from "@/components/calendar/EventReminder";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { useTheme } from "@/context/ThemeContext";
import { parseGroupMatch, parseKnockoutMatch } from "@/lib/worldcup";
import { getTeamFlag } from "@/lib/team-flags";
import { cn } from "@/lib/utils";
import { UpcomingAgenda } from "@/components/agenda/UpcomingAgenda";
import { isLongEvent, type AgendaEvent } from "@/lib/agenda";
import { SALE_TICKET_CALENDAR_NAME } from "@/lib/calendar-names";

/** "upcoming" is our own agenda (outside FullCalendar); the rest are FC view names. */
export type CalendarViewName = "upcoming" | "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek";
const VIEW_STORAGE_KEY = "calendar.view";
const VIEW_TABS: { view: CalendarViewName; label: string }[] = [
  { view: "upcoming", label: "Upcoming" },
  { view: "dayGridMonth", label: "Month" },
  { view: "timeGridWeek", label: "Week" },
  { view: "timeGridDay", label: "Day" },
  { view: "listWeek", label: "List" },
];
const isViewName = (v: unknown): v is CalendarViewName =>
  VIEW_TABS.some((t) => t.view === v);

const AGENDA_PAST_DAYS = 1;
const AGENDA_FUTURE_DAYS = 14;

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Client-side EventType -> AgendaEvent (agenda-data's toAgendaEvent is server-only). */
function eventToAgenda(e: EventType, calendars: CalendarType[]): AgendaEvent {
  const cal = e.calendar ?? calendars.find((c) => c.id === e.calendarId);
  return {
    id: e.id,
    title: e.title,
    start: e.startTime,
    end: e.endTime,
    allDay: e.allDay,
    calendarId: e.calendarId,
    calendarName: cal?.name ?? "",
    color: cal?.color ?? "#4285f4",
    category: e.category,
    location: e.location,
    isSale: cal?.name === SALE_TICKET_CALENDAR_NAME,
  };
}

/**
 * For a World Cup match event, return its two team names with flags prepended
 * (e.g. "🇲🇽 墨西哥" / "🇿🇦 南非"). Returns null for non-match events so the
 * caller falls back to the plain title. Knockout placeholders (e.g. "M73勝者")
 * simply get no flag.
 */
function worldCupMatchTeams(
  ev: EventType | undefined,
): { home: string; away: string; kickoff: string } | null {
  if (!ev) return null;
  const g = parseGroupMatch(ev);
  const m = g ?? parseKnockoutMatch(ev);
  if (!m) return null;
  const flag = (t: string) => {
    const f = getTeamFlag(t);
    return f ? `${f} ${t}` : t;
  };
  return { home: flag(m.home), away: flag(m.away), kickoff: m.kickoff };
}

/** True when the ISO timestamp falls on the local calendar's "today". */
function isTodayLocal(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

interface CalendarViewProps {
  initialEvents: EventType[];
  /** Events for the Upcoming agenda (now-1d .. now+14d), loaded server-side */
  initialAgendaEvents?: AgendaEvent[];
  initialNow?: string;
  calendars: CalendarType[];
  /** Called externally (e.g. search) to open a specific event by id in the modal */
  openEventId?: string | null;
  onOpenEventHandled?: () => void;
  /** Callback to open the search dialog — used by the FC toolbar custom button */
  onSearchOpen?: () => void;
  /** Mobile: opens the sidebar drawer */
  onMobileMenuOpen?: () => void;
  /** Called when an event modal opens — used to update the URL (id + ISO start date) */
  onEventOpen?: (id: string, startTime: string) => void;
  /** Called when the event modal closes — used to clear the URL params */
  onEventClose?: () => void;
  /** Active category filter — null = show all */
  categoryFilter?: EventCategory | null;
  /** Active location (country) filter — null = show all */
  locationFilter?: string | null;
  /** Called on mount with a gotoDate function so parent can navigate the calendar */
  onGotoDateReady?: (fn: (date: Date) => void) => void;
  /** Bookmarked events (all calendars) — shown in the header 🔖 popover */
  bookmarks?: BookmarkedEvent[];
  /** Open a bookmarked event from the popover */
  onBookmarkSelect?: (eventId: string) => void;
  /** Toggle a bookmark; rejects on API failure so the modal can revert */
  onBookmarkToggle?: (eventId: string, bookmarked: boolean) => Promise<void>;
}

export function CalendarView({ initialEvents, initialAgendaEvents, initialNow, calendars, openEventId, onOpenEventHandled, onSearchOpen, onMobileMenuOpen, onEventOpen, onEventClose, categoryFilter, locationFilter, onGotoDateReady, bookmarks, onBookmarkSelect, onBookmarkToggle }: CalendarViewProps) {
  const [events, setEvents] = useState<EventType[]>(initialEvents);
  const [agendaEvents, setAgendaEvents] = useState<AgendaEvent[]>(initialAgendaEvents ?? []);
  // Always starts as "upcoming" (SSR-safe); the stored / deep-link view is
  // resolved after mount, and the body renders nothing until then.
  const [view, setView] = useState<CalendarViewName>("upcoming");
  const [viewReady, setViewReady] = useState(false);
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined);
  const deepLinkRef = useRef(false);
  const timeZone = useMemo(() => browserTimeZone(), []);
  const calendarRef = useRef<FullCalendar>(null);
  const [isMobile, setIsMobile] = useState(false);
  const { theme } = useTheme();
  const worldCupActive = theme.eventTheme === "worldcup";

  // Expose gotoDate to parent on mount. When the Upcoming agenda is showing
  // (no FullCalendar mounted) jump to the month view on that date instead.
  useEffect(() => {
    if (!onGotoDateReady) return;
    onGotoDateReady((date: Date) => {
      const api: CalendarApi | undefined = calendarRef.current?.getApi();
      if (api) {
        api.gotoDate(date);
      } else {
        setInitialDate(date.toLocaleDateString("en-CA"));
        setView("dayGridMonth");
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- matchMedia only exists after mount
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Resolve the starting view after mount: a deep link (?date= / ?event=) wins
  // so the target is visible; otherwise the last chosen view; otherwise the
  // Upcoming agenda (desktop and mobile alike).
  useEffect(() => {
    let stored: CalendarViewName = "upcoming";
    try {
      const raw = localStorage.getItem(VIEW_STORAGE_KEY);
      if (isViewName(raw)) stored = raw;
    } catch { /* blocked storage → default */ }
    const params = new URLSearchParams(window.location.search);
    const date = params.get("date");
    const hasDeepLink = !!(date || params.get("event"));
    let next = stored;
    if (hasDeepLink) {
      deepLinkRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore on mount
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setInitialDate(date);
      if (stored === "upcoming") next = "dayGridMonth";
    }
    setView(next);
    setViewReady(true);
  }, []);

  const changeViewTo = useCallback((next: CalendarViewName) => {
    setView(next);
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* non-fatal */ }
  }, []);

  // Refetch the agenda window after any mutation so the Upcoming view stays current.
  const calendarsRef = useRef(calendars);
  useEffect(() => { calendarsRef.current = calendars; }, [calendars]);
  const refreshAgenda = useCallback(async () => {
    try {
      const now = Date.now();
      const params = new URLSearchParams({
        start: new Date(now - AGENDA_PAST_DAYS * 86400000).toISOString(),
        end: new Date(now + AGENDA_FUTURE_DAYS * 86400000).toISOString(),
      });
      const res = await fetch(`/api/events?${params}`);
      if (!res.ok) return;
      const data: EventType[] = await res.json();
      if (Array.isArray(data)) setAgendaEvents(data.map((e) => eventToAgenda(e, calendarsRef.current)));
    } catch { /* keep the existing agenda */ }
  }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [newEventId, setNewEventId] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<{
    start: string;
    end: string;
    allDay: boolean;
  } | null>(null);
  const [dayPanelDate, setDayPanelDate] = useState<string | null>(null);
  const [copyData, setCopyData] = useState<EventFormData | null>(null);
  // Abort controller ref — cancels stale event fetches when the user navigates quickly
  const fetchAbortRef = useRef<AbortController | null>(null);
  // Ref so FullCalendar customButton click handler can call the search opener
  const searchOpenRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { searchOpenRef.current = onSearchOpen; }, [onSearchOpen]);
  const mobileMenuRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { mobileMenuRef.current = onMobileMenuOpen; }, [onMobileMenuOpen]);

  // Helper to navigate the calendar to a date and open the event modal
  const openEventById = useCallback((e: EventType) => {
    // Jump FC to the event's month so it's visible
    const api: CalendarApi | undefined = calendarRef.current?.getApi();
    if (api) api.gotoDate(e.startTime);
    // Deep link: if FullCalendar isn't mounted yet, make it start on the event's date
    if (deepLinkRef.current) {
      deepLinkRef.current = false;
      setInitialDate((prev) => prev ?? new Date(e.startTime).toLocaleDateString("en-CA"));
    }
    setSelectedRange(null);
    setSelectedEvent(e);
    setModalOpen(true);
    onEventOpen?.(e.id, e.startTime);
  }, [onEventOpen]);

  // Open event modal when triggered from external source (e.g. search dialog)
  // Falls back to a direct API fetch when the event is outside the current view.
  const openById = (id: string, done?: () => void) => {
    const local = events.find((ev) => ev.id === id);
    if (local) {
      openEventById(local);
      done?.();
    } else {
      fetch(`/api/events/${id}`)
        .then((r) => r.ok ? r.json() : null)
        .then((e) => { if (e) openEventById(e); })
        .catch(() => null)
        .finally(() => done?.());
    }
  };

  useEffect(() => {
    if (!openEventId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external trigger opens the modal
    openById(openEventId, onOpenEventHandled);
  }, [openEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returns true if the user can write to the given calendar
  const calendarIsWritable = (calId: string) => {
    const cal = calendars.find((c) => c.id === calId);
    if (!cal) return false;
    // Owner (no memberRole) or collaborative editor
    return !cal.memberRole || cal.memberRole === "editor";
  };

  const selectedEventReadOnly =
    selectedEvent ? !calendarIsWritable(selectedEvent.calendarId) : false;

  const visibleCalendarIds = calendars
    .filter((c) => c.isVisible)
    .map((c) => c.id);

  // One predicate for FullCalendar events and the Upcoming agenda
  const passesFilters = (e: {
    calendarId: string;
    title: string;
    category?: string | null;
    location?: string | null;
  }) => {
    if (!visibleCalendarIds.includes(e.calendarId)) return false;
    if (categoryFilter && e.category !== categoryFilter) return false;
    if (locationFilter) {
      // Match the same way the sidebar chip counts do (title + location against
      // the shared LOCATION_RULES) — a substring check on location alone hides
      // events tagged only in Chinese (e.g. "MOM Livehouse, 香港北角…" under the
      // "Hong Kong" chip). Substring fallback keeps non-canonical filters working.
      const loc = e.location ?? "";
      const matchesTag = detectLocationTag(e.title, e.location ?? null) === locationFilter;
      if (!matchesTag && !loc.toLowerCase().includes(locationFilter.toLowerCase())) return false;
    }
    return true;
  };

  const filteredEvents = events.filter(passesFilters);
  const filteredAgendaEvents = agendaEvents.filter(passesFilters);

  const fcEvents = filteredEvents.map((event) => {
    // Multi-day timed events (e.g. popup stores, multi-week runs) are displayed as
    // all-day spanning banners so they visually cover the full date range.
    // Use local (browser) dates so events crossing UTC midnight on the same local
    // day (e.g. a 2-hour sports match at 22:00 UTC = 06:00 HKT) are NOT misdetected
    // as multi-day.
    const startDateLocal = new Date(event.startTime).toLocaleDateString("en-CA");
    const endDateLocal = event.endTime
      ? new Date(event.endTime).toLocaleDateString("en-CA")
      : startDateLocal;
    const isMultiDayTimed = !event.allDay && endDateLocal > startDateLocal;
    // FullCalendar all-day end is exclusive → add 1 calendar day to local endDate
    const fcEnd = isMultiDayTimed
      ? new Date(new Date(endDateLocal + "T00:00:00").getTime() + 86400000)
          .toLocaleDateString("en-CA")
      : event.endTime;

    // Ordering rank: sales and short events first, long (>=3 day) runs last
    const isSale = event.calendar?.name === SALE_TICKET_CALENDAR_NAME;
    const isLong = !isSale && isLongEvent(eventToAgenda(event, calendars), timeZone);

    return {
      id: event.id,
      title: event.title,
      start: isMultiDayTimed ? startDateLocal : event.startTime,
      end: fcEnd,
      allDay: event.allDay || isMultiDayTimed,
      backgroundColor: event.calendar?.color || "#4285f4",
      borderColor: event.calendar?.color || "#4285f4",
      extendedProps: { event, isLong, rank: isSale ? 0 : isLong ? 2 : 1 },
    };
  });

  const handleDateSelect = (selectInfo: DateSelectArg) => {
    // Single all-day click in month view — let dateClick / day panel handle it
    const duration = selectInfo.end.getTime() - selectInfo.start.getTime();
    if (selectInfo.allDay && duration <= 24 * 60 * 60 * 1000) {
      selectInfo.view.calendar.unselect();
      return;
    }
    setSelectedEvent(null);
    setSelectedRange({
      start: selectInfo.startStr,
      end: selectInfo.endStr,
      allDay: selectInfo.allDay,
    });
    setModalOpen(true);
    selectInfo.view.calendar.unselect();
  };

  // Show the day detail panel when user clicks a date in month view
  const handleDateClick = (clickInfo: DateClickArg) => {
    if (clickInfo.view.type === "dayGridMonth") {
      setDayPanelDate(clickInfo.dateStr.slice(0, 10));
    }
  };

  // "+N more" link → open the day detail panel instead of FC's default popover
  const handleMoreLinkClick = (arg: MoreLinkArg) => {
    const dateStr = arg.date.toLocaleDateString("en-CA"); // "YYYY-MM-DD" in local timezone
    setDayPanelDate(dateStr);
    return "stop" as const;
  };

  const handleEventClick = (clickInfo: EventClickArg) => {
    // Clicking an event in the calendar grid shows the day panel first
    // so the user sees all events for that day before choosing to edit.
    const ev = clickInfo.event.extendedProps.event as EventType;
    // Use local date (browser timezone) so the panel opens on the correct local day.
    const date = new Date(ev.startTime).toLocaleDateString("en-CA"); // YYYY-MM-DD local
    setDayPanelDate(date);
    onEventOpen?.(ev.id, ev.startTime);
  };

  const handleEventDrop = async (dropInfo: EventDropArg) => {
    const event = dropInfo.event.extendedProps.event as EventType;
    if (!calendarIsWritable(event.calendarId)) {
      dropInfo.revert();
      toast.info("This calendar is read-only");
      return;
    }
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: dropInfo.event.startStr,
          endTime: dropInfo.event.endStr || dropInfo.event.startStr,
          allDay: dropInfo.event.allDay,
        }),
      });
      if (!res.ok) {
        dropInfo.revert();
        toast.error("Couldn't move event — change reverted");
        return;
      }
      const updated = await res.json();
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      void refreshAgenda();
    } catch {
      dropInfo.revert();
      toast.error("Couldn't move event — change reverted");
    }
  };

  const handleEventResize = async (resizeInfo: EventResizeDoneArg) => {
    const event = resizeInfo.event.extendedProps.event as EventType;
    if (!calendarIsWritable(event.calendarId)) {
      resizeInfo.revert();
      toast.info("This calendar is read-only");
      return;
    }
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: resizeInfo.event.startStr,
          endTime: resizeInfo.event.endStr,
        }),
      });
      if (!res.ok) {
        resizeInfo.revert();
        toast.error("Couldn't resize event — change reverted");
        return;
      }
      const updated = await res.json();
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      void refreshAgenda();
    } catch {
      resizeInfo.revert();
      toast.error("Couldn't resize event — change reverted");
    }
  };

  const handleDatesSet = async (dateInfo: DatesSetArg) => {
    // Remember the view the user navigated to via FullCalendar's own buttons
    if (isViewName(dateInfo.view.type)) {
      setView(dateInfo.view.type);
      try { localStorage.setItem(VIEW_STORAGE_KEY, dateInfo.view.type); } catch { /* non-fatal */ }
    }
    // Cancel any in-flight fetch from a previous navigation
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    try {
      // Convert FullCalendar's local-timezone strings to UTC ISO before sending.
      // This avoids URL-encoding issues with +08:00 offsets in query params.
      const start = new Date(dateInfo.startStr).toISOString();
      const end = new Date(dateInfo.endStr).toISOString();
      const params = new URLSearchParams({ start, end });
      const res = await fetch(`/api/events?${params}`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        // Keep existing events, but tell the user the view may be stale.
        // Fixed id so rapid navigation doesn't stack duplicate toasts.
        toast.error("Couldn't load events for this period", { id: "events-load" });
      }
    }
  };

  const handleSaveEvent = async (data: EventFormData) => {
    // On failure the modal stays open so the user's input isn't lost.
    try {
      if (selectedEvent) {
        // Update
        const res = await fetch(`/api/events/${selectedEvent.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          toast.error("Couldn't save changes — please try again");
          return;
        }
        const updated = await res.json();
        setEvents((prev) =>
          prev.map((e) => (e.id === updated.id ? updated : e))
        );
        toast.success("Event updated");
        void refreshAgenda();
      } else {
        // Create
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          toast.error("Couldn't create event — please try again");
          return;
        }
        const created = await res.json();
        setEvents((prev) => [...prev, created]);
        setNewEventId(created.id);
        setTimeout(() => setNewEventId(null), 2000);
        toast.success("Event created");
        void refreshAgenda();
      }
      setModalOpen(false);
    } catch {
      toast.error("Couldn't save event — please try again");
    }
  };

  const handleCopyEvent = async (data: EventFormData) => {
    // Immediately create a duplicate — no need to open the form again
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const created = await res.json();
        setEvents((prev) => [...prev, created]);
        setNewEventId(created.id);
        setTimeout(() => setNewEventId(null), 2000);
        toast.success("Event duplicated");
        void refreshAgenda();
      } else {
        toast.error("Couldn't duplicate event");
      }
    } catch {
      toast.error("Couldn't duplicate event");
    }
    setModalOpen(false);
    setCopyData(null);
  };

  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;
    // Snapshot before the delete request — selectedEvent may change by the
    // time Undo is clicked (e.g. the modal reopens for a different event).
    const deleted = selectedEvent;
    try {
      const res = await fetch(`/api/events/${deleted.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Couldn't delete event — please try again");
        return;
      }
      setEvents((prev) => prev.filter((e) => e.id !== deleted.id));
      setAgendaEvents((prev) => prev.filter((e) => e.id !== deleted.id));
      setModalOpen(false);
      toast.success("Event deleted", {
        action: {
          label: "Undo",
          // Re-creates the event via POST /api/events. That endpoint doesn't
          // accept a client-supplied id, so the restored event gets a brand-new
          // id — anything keyed on the old id (bookmarks, related-event/sale
          // links) is not restored.
          onClick: async () => {
            try {
              const res = await fetch("/api/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: deleted.title,
                  description: deleted.description ?? undefined,
                  location: deleted.location ?? undefined,
                  startTime: deleted.startTime,
                  endTime: deleted.endTime,
                  allDay: deleted.allDay,
                  calendarId: deleted.calendarId,
                  category: deleted.category ?? null,
                  artist: deleted.artist ?? null,
                  referenceUrl: deleted.referenceUrl ?? null,
                }),
              });
              if (!res.ok) {
                toast.error("Couldn't restore event");
                return;
              }
              const restored = await res.json();
              setEvents((prev) => [...prev, restored]);
              toast.success("Event restored");
              void refreshAgenda();
            } catch {
              toast.error("Couldn't restore event");
            }
          },
        },
      });
    } catch {
      toast.error("Couldn't delete event — please try again");
    }
  };

  const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0];

  /** Derive a short region label from a location string for badge display. */
  const regionLabel = (location: string | null | undefined): string | null => {
    if (!location) return null;
    if (location.includes("香港") || location.toLowerCase().includes("hong kong")) return "HK";
    return null;
  };

  // Custom event content — title-first with smaller muted time for timed events
  const renderEventContent = (arg: EventContentArg) => {
    const { event, timeText } = arg;
    const viewType = arg.view.type;
    const color = event.backgroundColor || "#4285f4";
    const ev = event.extendedProps.event as EventType;
    const region = regionLabel(ev?.location);

    // World Cup match (only decorated while the World Cup theme is active).
    const wcMatch = worldCupActive ? worldCupMatchTeams(ev) : null;
    const wcToday = wcMatch ? isTodayLocal(wcMatch.kickoff) : false;
    const wcTitle = wcMatch ? `${wcMatch.home} vs ${wcMatch.away}` : null;

    // Category indicator — the category's emoji prepended to the title so the
    // event type is readable at a glance (all events on the ticket calendar
    // share one color, so color alone can't tell a concert from an exhibition).
    // World Cup matches keep their own ⚽/🔴 marker instead of doubling up.
    const catEmoji = !wcMatch && ev?.category ? CATEGORY_EMOJI[ev.category] : null;
    const titleText = wcTitle ?? (catEmoji ? `${catEmoji} ${event.title}` : event.title);

    // Short location — first comma-segment (the venue), so same-titled tour
    // stops (e.g. six "Bruno Mars" venue runs) are tellable apart on the grid.
    const locShort = ev?.location?.split(",")[0]?.trim() || null;

    // List view — title + optional region badge; FC handles dot + time columns
    if (viewType.startsWith("list")) {
      return (
        <span className="text-sm flex items-center gap-1.5 flex-wrap">
          {wcToday && <span title="Match today" aria-label="Match today">🔴</span>}
          <span>{titleText}</span>
          {locShort && (
            <span className="text-xs text-muted-foreground truncate max-w-[180px]">📍 {locShort}</span>
          )}
          {region && (
            <span className="inline-flex items-center rounded px-1 py-0 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 leading-tight shrink-0">
              {region}
            </span>
          )}
        </span>
      );
    }

    if (event.allDay) {
      // All-day: solid fill pill (background set by FC), title only
      return (
        <div className="ec-allday-event">
          <span className="ec-event-title">{titleText}</span>
          {locShort && <span className="ec-event-loc">📍{locShort}</span>}
          {region && (
            <span className="inline-flex items-center rounded px-1 text-[9px] font-medium bg-white/20 leading-tight shrink-0 ml-1">
              {region}
            </span>
          )}
        </div>
      );
    }

    if (viewType.startsWith("dayGrid")) {
      // Timed in month grid: dot + title + smaller time + region badge.
      // World Cup matches get a ⚽ marker, flagged team names, and a 🔴 when live today.
      return (
        <div className={cn("ec-timed-event", wcMatch && "ec-wc-event")}>
          {wcMatch ? (
            <span className="ec-wc-marker" aria-hidden="true">{wcToday ? "🔴" : "⚽"}</span>
          ) : (
            <span className="ec-event-dot" style={{ backgroundColor: color }} />
          )}
          <span className="ec-event-title">{titleText}</span>
          {timeText && (
            <span className="ec-event-time">{timeText}</span>
          )}
          {region && (
            <span className="inline-flex items-center rounded px-1 py-0 text-[9px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 leading-tight shrink-0 ml-auto">
              {region}
            </span>
          )}
        </div>
      );
    }

    // timeGrid (week / day): title on top, optional region badge, time below
    return (
      <div className="ec-timegrid-event">
        <span className="ec-event-title">
          {wcMatch && <span aria-hidden="true">{wcToday ? "🔴 " : "⚽ "}</span>}
          {titleText}
        </span>
        {region && (
          <span className="inline-flex items-center rounded px-1 py-0 text-[9px] font-medium bg-white/20 leading-tight mt-0.5 self-start">
            {region}
          </span>
        )}
        {locShort && <span className="ec-event-time">📍 {locShort}</span>}
        {timeText && <span className="ec-event-time">{timeText}</span>}
      </div>
    );
  };

  return (
    <>
      {/* Event reminder toasts */}
      <EventReminder
        events={events.filter((e) => !e.allDay)}
        calendars={calendars}
      />
      {/* Calendar + optional day-detail panel side by side */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 min-w-0 p-1 md:p-4 flex flex-col">
          {/* Top row: search bar (desktop) + theme switcher pinned top-right.
              On mobile the search lives in the FC toolbar, so this row carries
              just the theme switcher, kept right-aligned. */}
          <div className="mb-2 flex items-center gap-2">
            {!isMobile ? (
              <button
                className="flex flex-1 items-center gap-2.5 h-9 px-3 rounded-md border border-input bg-muted/30 text-sm text-muted-foreground hover:bg-muted/60 transition-colors cursor-pointer text-left"
                onClick={() => searchOpenRef.current?.()}
                aria-label="Search events"
              >
                <Search className="size-4 shrink-0" />
                <span className="flex-1">Search events…</span>
                <kbd className="hidden sm:inline text-xs border border-border rounded px-1 py-0.5 bg-background font-mono">⌘K</kbd>
              </button>
            ) : (
              <div className="flex-1" />
            )}
            {/* Bookmarked events — always one click away, on mobile too */}
            {onBookmarkSelect && (
              <BookmarkPopover bookmarks={bookmarks ?? []} onSelect={onBookmarkSelect} />
            )}
            <ThemeSwitcher />
          </div>
          {/* Empty-state hint — guides new users / explains filtered-out views */}
          {view === "upcoming" ? null : events.length === 0 ? (
            <div className="mb-2 flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              <span>
                No events this period — click any date to create one, or{" "}
                <a href="/tickets" className="text-primary underline-offset-2 hover:underline">
                  import from a ticket URL
                </a>
                .
              </span>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="mb-2 flex items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              No events match the current filters.
            </div>
          ) : null}
          <div className="flex-1 min-h-0">
          {!viewReady ? null : view === "upcoming" ? (
            <div className="flex h-full flex-col" data-testid="upcoming-view">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {isMobile && (
                  <button
                    type="button"
                    className="fc-button fc-button-primary"
                    aria-label="Open menu"
                    onClick={() => mobileMenuRef.current?.()}
                  >
                    ☰
                  </button>
                )}
                <div role="tablist" aria-label="Calendar view" className="flex flex-wrap gap-1">
                  {VIEW_TABS.map((t) => (
                    <button
                      key={t.view}
                      type="button"
                      role="tab"
                      aria-selected={t.view === "upcoming"}
                      onClick={() => changeViewTo(t.view)}
                      className={cn(
                        "rounded-md border px-3 py-1 text-sm transition-colors",
                        t.view === "upcoming"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-muted",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <UpcomingAgenda
                  events={filteredAgendaEvents}
                  timeZone={timeZone}
                  onEventClick={(id) => openById(id)}
                  initialNow={initialNow}
                />
              </div>
            </div>
          ) : (
          <FullCalendar
            ref={calendarRef}
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              interactionPlugin,
              listPlugin,
            ]}
            customButtons={{
              menu: {
                text: "☰",
                hint: "Open menu",
                click: () => mobileMenuRef.current?.(),
              },
              upcoming: {
                text: "Upcoming",
                hint: "Upcoming agenda",
                click: () => changeViewTo("upcoming"),
              },
              search: {
                text: "🔍",
                hint: "Search events (⌘K)",
                click: () => searchOpenRef.current?.(),
              },
            }}
            headerToolbar={isMobile ? {
              left: "menu prev,next",
              center: "title",
              right: "search today",
            } : {
              left: "prev,next today",
              center: "title",
              right: "upcoming,dayGridMonth,timeGridWeek,timeGridDay,listWeek",
            }}
            // The mobile header has no room for view buttons, which previously
            // left phones with no way out of whatever view they started in.
            // Give them their own row instead of cramming the header.
            footerToolbar={isMobile ? {
              center: "upcoming,listWeek,dayGridMonth,timeGridDay",
            } : false}
            buttonText={{
              today: "Today",
              month: "Month",
              week: "Week",
              day: "Day",
              list: "List",
            }}
            initialView={view}
            initialDate={initialDate}
            eventOrder="rank,start,-duration,allDay,title"
            editable={!isMobile}
            selectable={true}
            selectMirror={true}
            dayMaxEvents={isMobile ? 3 : true}
            events={fcEvents}
            eventContent={renderEventContent}
            eventClassNames={(arg) => {
              const classes: string[] = [];
              // Long runs (pop-ups, exhibitions, fairs): quiet style so they don't dominate
              if (arg.event.extendedProps.isLong) {
                classes.push("fc-event-long");
              }
              // Timed events in month grid: transparent background, dot style
              if (!arg.event.allDay && arg.view.type.startsWith("dayGrid")) {
                classes.push("fc-event-timed-dot");
              }
              // Birth animation for newly created events
              if (arg.event.id === newEventId) {
                classes.push("fc-event-new");
              }
              return classes;
            }}
            select={handleDateSelect}
            dateClick={handleDateClick}
            moreLinkClick={handleMoreLinkClick}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            datesSet={handleDatesSet}
            height="100%"
            nowIndicator={true}
            eventDisplay="block"
          />
          )}
          </div>
        </div>

        {dayPanelDate && (
          <DayDetailPanel
            date={dayPanelDate}
            events={filteredEvents}
            calendars={calendars}
            modal={isMobile}
            bookmarkedIds={new Set((bookmarks ?? []).map((b) => b.id))}
            onBookmarkToggle={
              onBookmarkToggle
                ? (id, next) => {
                    onBookmarkToggle(id, next).catch(() =>
                      toast.error("Couldn't update bookmark — please try again"),
                    );
                  }
                : undefined
            }
            onClose={() => setDayPanelDate(null)}
            onCreateEvent={(date) => {
              setSelectedEvent(null);
              // Default to 10:00 AM on the focused date in the local timezone.
              const localDate = new Date(`${date}T10:00:00`);
              const start = localDate.toISOString();
              localDate.setHours(localDate.getHours() + 1);
              const end = localDate.toISOString();
              setSelectedRange({ start, end, allDay: false });
              setModalOpen(true);
            }}
            onEditEvent={(event) => {
              setSelectedRange(null);
              setSelectedEvent(event);
              setModalOpen(true);
            }}
          />
        )}
      </div>

      {/* Floating action button — always-visible shortcut to create an event */}
      <button
        onClick={() => {
          setSelectedEvent(null);
          if (dayPanelDate) {
            // Default to 10:00 AM on the focused date in the local timezone.
            // Using a local ISO-like string and converting it to UTC so EventModal can parse it.
            const localDate = new Date(`${dayPanelDate}T10:00:00`);
            const start = localDate.toISOString();
            localDate.setHours(localDate.getHours() + 1);
            const end = localDate.toISOString();
            setSelectedRange({ start, end, allDay: false });
          } else {
            const now = new Date();
            const start = now.toISOString();
            now.setHours(now.getHours() + 1);
            setSelectedRange({ start, end: now.toISOString(), allDay: false });
          }
          setModalOpen(true);
        }}
        className="fixed bottom-6 right-6 size-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 flex items-center justify-center z-20 transition-all"
        aria-label="Create new event"
      >
        <Plus className="size-6" />
      </button>

      <EventModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setCopyData(null);
            onEventClose?.();
          }
        }}
        event={selectedEvent}
        calendars={calendars}
        defaultCalendarId={defaultCalendar?.id || ""}
        initialRange={selectedRange}
        initialData={copyData ?? undefined}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
        onCopy={handleCopyEvent}
        onSynced={(updated) => {
          setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
          setSelectedEvent(updated);
          void refreshAgenda();
        }}
        onEventSelect={async (id, startTime) => {
          // Clicking a related event from the modal: navigate to its date and open
          // the event detail modal directly (fetch it so we handle out-of-range months).
          setModalOpen(false);
          const date = startTime.slice(0, 10);
          calendarRef.current?.getApi().gotoDate(date);
          try {
            const res = await fetch(`/api/events/${id}`);
            if (res.ok) {
              const ev: EventType = await res.json();
              // Merge into events state so the modal can see a calendar object
              setEvents((prev) => prev.some((e) => e.id === ev.id) ? prev : [...prev, ev]);
              setSelectedRange(null);
              setSelectedEvent(ev);
              setDayPanelDate(null);
              setModalOpen(true);
            } else {
              // Fallback: just show the day panel if fetch fails
              setDayPanelDate(date);
            }
          } catch {
            setDayPanelDate(date);
          }
        }}
        readOnly={selectedEventReadOnly}
        bookmarked={selectedEvent ? (bookmarks ?? []).some((b) => b.id === selectedEvent.id) : false}
        onBookmarkToggle={onBookmarkToggle}
      />
    </>
  );
}
