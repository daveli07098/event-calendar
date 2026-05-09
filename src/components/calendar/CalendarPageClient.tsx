"use client";

import { useState, useEffect } from "react";
import { CalendarView } from "@/components/calendar/CalendarView";
import { CalendarSidebar } from "@/components/calendar/CalendarSidebar";
import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";
import { SearchDialog } from "@/components/calendar/SearchDialog";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  // Cmd+K / Ctrl+K opens search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
      <CalendarView
        calendars={calendars}
        initialEvents={initialEvents}
        openEventId={openEventId}
        onOpenEventHandled={() => setOpenEventId(null)}
        onSearchOpen={() => setSearchOpen(true)}
      />
      <AddCalendarDialog
        open={addCalendarOpen}
        onOpenChange={setAddCalendarOpen}
        onAdd={handleAddCalendar}
      />
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelectEvent={(id) => {
          setOpenEventId(id);
          setSearchOpen(false);
        }}
      />
    </div>
  );
}
