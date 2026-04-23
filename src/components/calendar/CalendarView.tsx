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
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import type { CalendarType, EventType, EventFormData } from "@/types";
import { EventModal } from "@/components/events/EventModal";

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
    setSelectedEvent(null);
    setSelectedRange({
      start: selectInfo.startStr,
      end: selectInfo.endStr,
      allDay: selectInfo.allDay,
    });
    setModalOpen(true);
    selectInfo.view.calendar.unselect();
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

  return (
    <>
      <div className="flex-1 p-4">
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
          select={handleDateSelect}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          datesSet={handleDatesSet}
          height="calc(100vh - 4rem)"
          nowIndicator={true}
          eventDisplay="block"
        />
      </div>

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
