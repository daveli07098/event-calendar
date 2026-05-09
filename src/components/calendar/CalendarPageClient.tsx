"use client";

import { useState, useEffect, useCallback } from "react";
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // On mount: open event + navigate to date if URL has ?event=id
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event");
    if (eventId) setOpenEventId(eventId);
  }, []);

  // Write ?event=id&date=YYYY-MM-DD into the URL (no page reload)
  const handleEventOpen = useCallback((id: string, startTime: string) => {
    const date = startTime.slice(0, 10);
    const url = new URL(window.location.href);
    url.searchParams.set("event", id);
    url.searchParams.set("date", date);
    window.history.replaceState(null, "", url.toString());
  }, []);

  // Clear event params from URL when modal closes
  const handleEventClose = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("event");
    url.searchParams.delete("date");
    window.history.replaceState(null, "", url.toString());
  }, []);

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
    <div className="flex h-screen overflow-hidden">
      <CalendarSidebar
        calendars={calendars}
        onCalendarToggle={handleCalendarToggle}
        onAddCalendar={() => setAddCalendarOpen(true)}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />
      <CalendarView
        calendars={calendars}
        initialEvents={initialEvents}
        openEventId={openEventId}
        onOpenEventHandled={() => setOpenEventId(null)}
        onEventOpen={handleEventOpen}
        onEventClose={handleEventClose}
        onSearchOpen={() => setSearchOpen(true)}
        onMobileMenuOpen={() => setMobileSidebarOpen(true)}
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
