"use client";

import { useState } from "react";
import FullCalendar from "@fullcalendar/react";
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
} from "@fullcalendar/core";
import type {
  DateClickArg,
  EventResizeDoneArg,
} from "@fullcalendar/interaction";
import { Plus } from "lucide-react";
import type { CalendarType, EventType, EventFormData } from "@/types";
import { EventModal } from "@/components/events/EventModal";
import { DayDetailPanel } from "@/components/calendar/DayDetailPanel";

interface CalendarViewProps {
  initialEvents: EventType[];
  calendars: CalendarType[];
}

export function CalendarView({ initialEvents, calendars }: CalendarViewProps) {
  const [events, setEvents] = useState<EventType[]>(initialEvents);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [selectedRange, setSelectedRange] = useState<{
    start: string;
    end: string;
    allDay: boolean;
  } | null>(null);
  const [dayPanelDate, setDayPanelDate] = useState<string | null>(null);

  const visibleCalendarIds = calendars
    .filter((c) => c.isVisible)
    .map((c) => c.id);

  const filteredEvents = events.filter((e) =>
    visibleCalendarIds.includes(e.calendarId)
  );

  const fcEvents = filteredEvents.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.startTime,
    end: event.endTime,
    allDay: event.allDay,
    backgroundColor: event.calendar?.color || "#4285f4",
    borderColor: event.calendar?.color || "#4285f4",
    extendedProps: { event },
  }));

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

  const handleEventClick = (clickInfo: EventClickArg) => {
    setSelectedRange(null);
    setSelectedEvent(clickInfo.event.extendedProps.event as EventType);
    setModalOpen(true);
  };

  const handleEventDrop = async (dropInfo: EventDropArg) => {
    const event = dropInfo.event.extendedProps.event as EventType;
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
    try {
      const res = await fetch(
        `/api/events?start=${dateInfo.startStr}&end=${dateInfo.endStr}`
      );
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch {
      // Keep existing events on error
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
      }
    }
    setModalOpen(false);
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

  // Custom event content — title-first with smaller muted time for timed events
  const renderEventContent = (arg: EventContentArg) => {
    const { event, timeText } = arg;
    const viewType = arg.view.type;
    const color = event.backgroundColor || "#4285f4";

    // List view — render title only; FC handles dot + time columns
    if (viewType.startsWith("list")) {
      return <span className="text-sm">{event.title}</span>;
    }

    if (event.allDay) {
      // All-day: solid fill pill (background set by FC), title only
      return (
        <div className="ec-allday-event">
          <span className="ec-event-title">{event.title}</span>
        </div>
      );
    }

    if (viewType.startsWith("dayGrid")) {
      // Timed in month grid: dot + title + smaller time
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
        </div>
      );
    }

    // timeGrid (week / day): title on top, time below
    return (
      <div className="ec-timegrid-event">
        <span className="ec-event-title">{event.title}</span>
        {timeText && <span className="ec-event-time">{timeText}</span>}
      </div>
    );
  };

  return (
    <>
      {/* Calendar + optional day-detail panel side by side */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 min-w-0 p-4">
          <FullCalendar
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              interactionPlugin,
              listPlugin,
            ]}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
            }}
            initialView="dayGridMonth"
            editable={true}
            selectable={true}
            selectMirror={true}
            dayMaxEvents={true}
            events={fcEvents}
            eventContent={renderEventContent}
            eventClassNames={(arg) => {
              // Timed events in month grid: transparent background, dot style
              if (!arg.event.allDay && arg.view.type.startsWith("dayGrid")) {
                return ["fc-event-timed-dot"];
              }
              return [];
            }}
            select={handleDateSelect}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            datesSet={handleDatesSet}
            height="calc(100vh - 4rem)"
            nowIndicator={true}
            eventDisplay="block"
          />
        </div>

        {dayPanelDate && (
          <DayDetailPanel
            date={dayPanelDate}
            events={filteredEvents}
            calendars={calendars}
            onClose={() => setDayPanelDate(null)}
            onCreateEvent={(date) => {
              setSelectedEvent(null);
              setSelectedRange({
                start: `${date}T09:00:00`,
                end: `${date}T10:00:00`,
                allDay: false,
              });
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
          const now = new Date();
          const start = now.toISOString();
          now.setHours(now.getHours() + 1);
          setSelectedEvent(null);
          setSelectedRange({ start, end: now.toISOString(), allDay: false });
          setModalOpen(true);
        }}
        className="fixed bottom-6 right-6 size-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 flex items-center justify-center z-20 transition-all"
        aria-label="Create new event"
      >
        <Plus className="size-6" />
      </button>

      <EventModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        event={selectedEvent}
        calendars={calendars}
        defaultCalendarId={defaultCalendar?.id || ""}
        initialRange={selectedRange}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
      />
    </>
  );
}
