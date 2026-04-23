"use client";

import { useState } from "react";
import { CalendarView } from "@/components/calendar/CalendarView";
import { CalendarSidebar } from "@/components/calendar/CalendarSidebar";
import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";
import type { CalendarType, EventType } from "@/types";

interface CalendarPageClientProps {
  initialCalendars: CalendarType[];
  initialEvents: EventType[];
}

export function CalendarPageClient({
  initialCalendars,
  initialEvents,
}: CalendarPageClientProps) {
  const [calendars, setCalendars] = useState<CalendarType[]>(initialCalendars);
  const [addCalendarOpen, setAddCalendarOpen] = useState(false);

  const handleCalendarToggle = async (id: string, visible: boolean) => {
    // Optimistic update
    setCalendars((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isVisible: visible } : c))
    );

    await fetch(`/api/calendars/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible: visible }),
    });
  };

  const handleAddCalendar = async (name: string, color: string) => {
    const res = await fetch("/api/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (res.ok) {
      const newCal = await res.json();
      setCalendars((prev) => [...prev, newCal]);
    }
  };

  return (
    <div className="flex h-screen">
      <CalendarSidebar
        calendars={calendars}
        onCalendarToggle={handleCalendarToggle}
        onAddCalendar={() => setAddCalendarOpen(true)}
      />
      <CalendarView calendars={calendars} initialEvents={initialEvents} />
      <AddCalendarDialog
        open={addCalendarOpen}
        onOpenChange={setAddCalendarOpen}
        onAdd={handleAddCalendar}
      />
    </div>
  );
}
