"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
import type { CalendarType, EventType, EventFormData, EventCategory } from "@/types";
import { CATEGORY_LABELS } from "@/types";
import { EventModal } from "@/components/events/EventModal";
import { DayDetailPanel } from "@/components/calendar/DayDetailPanel";
import { EventReminder } from "@/components/calendar/EventReminder";

interface CalendarViewProps {
  initialEvents: EventType[];
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
}

export function CalendarView({ initialEvents, calendars, openEventId, onOpenEventHandled, onSearchOpen, onMobileMenuOpen, onEventOpen, onEventClose, categoryFilter, locationFilter, onGotoDateReady }: CalendarViewProps) {
  const [events, setEvents] = useState<EventType[]>(initialEvents);
  const calendarRef = useRef<FullCalendar>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Expose gotoDate to parent on mount
  useEffect(() => {
    if (!onGotoDateReady) return;
    onGotoDateReady((date: Date) => {
      const api: CalendarApi | undefined = calendarRef.current?.getApi();
      if (api) api.gotoDate(date);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
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
    setSelectedRange(null);
    setSelectedEvent(e);
    setModalOpen(true);
    onEventOpen?.(e.id, e.startTime);
  }, [onEventOpen]);

  // Open event modal when triggered from external source (e.g. search dialog)
  // Falls back to a direct API fetch when the event is outside the current view.
  useEffect(() => {
    if (!openEventId) return;
    const local = events.find((ev) => ev.id === openEventId);
    if (local) {
      openEventById(local);
      onOpenEventHandled?.();
    } else {
      fetch(`/api/events/${openEventId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((e) => { if (e) openEventById(e); })
        .catch(() => null)
        .finally(() => onOpenEventHandled?.());
    }
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

  const filteredEvents = events.filter((e) => {
    if (!visibleCalendarIds.includes(e.calendarId)) return false;
    if (categoryFilter && e.category !== categoryFilter) return false;
    if (locationFilter) {
      const loc = e.location ?? "";
      if (!loc.toLowerCase().includes(locationFilter.toLowerCase())) return false;
    }
    return true;
  });

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

    return {
      id: event.id,
      title: event.title,
      start: isMultiDayTimed ? startDateLocal : event.startTime,
      end: fcEnd,
      allDay: event.allDay || isMultiDayTimed,
      backgroundColor: event.calendar?.color || "#4285f4",
      borderColor: event.calendar?.color || "#4285f4",
      extendedProps: { event },
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
        return;
      }
      const updated = await res.json();
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch {
      dropInfo.revert();
    }
  };

  const handleEventResize = async (resizeInfo: EventResizeDoneArg) => {
    const event = resizeInfo.event.extendedProps.event as EventType;
    if (!calendarIsWritable(event.calendarId)) {
      resizeInfo.revert();
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
        return;
      }
      const updated = await res.json();
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch {
      resizeInfo.revert();
    }
  };

  const handleDatesSet = async (dateInfo: DatesSetArg) => {
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
        // Keep existing events on non-abort errors
      }
    }
  };

  const handleSaveEvent = async (data: EventFormData) => {
    if (selectedEvent) {
      // Update
      const res = await fetch(`/api/events/${selectedEvent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updated = await res.json();
        setEvents((prev) =>
          prev.map((e) => (e.id === updated.id ? updated : e))
        );
      }
    } else {
      // Create
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
      }
    }
    setModalOpen(false);
  };

  const handleCopyEvent = async (data: EventFormData) => {
    // Immediately create a duplicate — no need to open the form again
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
    }
    setModalOpen(false);
    setCopyData(null);
  };

  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;
    const res = await fetch(`/api/events/${selectedEvent.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setEvents((prev) => prev.filter((e) => e.id !== selectedEvent.id));
    }
    setModalOpen(false);
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

    // List view — title + optional region badge; FC handles dot + time columns
    if (viewType.startsWith("list")) {
      return (
        <span className="text-sm flex items-center gap-1.5 flex-wrap">
          <span>{event.title}</span>
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
          <span className="ec-event-title">{event.title}</span>
          {region && (
            <span className="inline-flex items-center rounded px-1 text-[9px] font-medium bg-white/20 leading-tight shrink-0 ml-1">
              {region}
            </span>
          )}
        </div>
      );
    }

    if (viewType.startsWith("dayGrid")) {
      // Timed in month grid: dot + title + smaller time + region badge
      return (
        <div className="ec-timed-event">
          <span
            className="ec-event-dot"
            style={{ backgroundColor: color }}
          />
          <span className="ec-event-title">{event.title}</span>
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
        <span className="ec-event-title">{event.title}</span>
        {region && (
          <span className="inline-flex items-center rounded px-1 py-0 text-[9px] font-medium bg-white/20 leading-tight mt-0.5 self-start">
            {region}
          </span>
        )}
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
          {/* Visible search bar — desktop only; mobile uses FC toolbar button */}
          {!isMobile && (
            <button
              className="mb-2 flex items-center gap-2.5 w-full h-9 px-3 rounded-md border border-input bg-muted/30 text-sm text-muted-foreground hover:bg-muted/60 transition-colors cursor-pointer text-left"
              onClick={() => searchOpenRef.current?.()}
              aria-label="Search events"
            >
              <Search className="size-4 shrink-0" />
              <span className="flex-1">Search events…</span>
              <kbd className="hidden sm:inline text-xs border border-border rounded px-1 py-0.5 bg-background font-mono">⌘K</kbd>
            </button>
          )}
          <div className="flex-1">
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
              right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
            }}
            initialView={isMobile ? "listWeek" : "dayGridMonth"}
            editable={!isMobile}
            selectable={true}
            selectMirror={true}
            dayMaxEvents={isMobile ? 3 : true}
            events={fcEvents}
            eventContent={renderEventContent}
            eventClassNames={(arg) => {
              const classes: string[] = [];
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
            height={isMobile ? "calc(100svh - 2rem)" : "calc(100svh - 4.5rem)"}
            nowIndicator={true}
            eventDisplay="block"
          />
          </div>
        </div>

        {dayPanelDate && (
          <DayDetailPanel
            date={dayPanelDate}
            events={filteredEvents}
            calendars={calendars}
            modal={isMobile}
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
      />
    </>
  );
}
