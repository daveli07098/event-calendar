"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CalendarView } from "@/components/calendar/CalendarView";
import { CalendarSidebar } from "@/components/calendar/CalendarSidebar";
import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";
import { SearchDialog } from "@/components/calendar/SearchDialog";
import { SiteBanner } from "@/components/banner/SiteBanner";
import { FootballMascot } from "@/components/theme/FootballMascot";
import { TeamPicker } from "@/components/theme/TeamPicker";
import type { CalendarType, EventType, EventCategory } from "@/types";

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
  // Default the calendar to the most-used view: Hong Kong concerts. Both filters
  // are still freely toggleable (and clearable) from the sidebar.
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | null>("concert");
  const [locationFilter, setLocationFilter] = useState<string | null>("Hong Kong");
  const [locationCounts, setLocationCounts] = useState<Record<string, number>>({});
  // Ref to CalendarView's gotoDate function (set by CalendarView via callback)
  const gotoDateRef = useRef<((date: Date) => void) | null>(null);

  // On mount: open event + navigate to date if URL has ?event=id
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of URL on mount
    if (eventId) setOpenEventId(eventId);
  }, []);

  // Fetch location counts on mount (for sidebar chips)
  useEffect(() => {
    fetch("/api/events/tag-location")
      .then((r) => r.json())
      .then((d) => { if (d.counts) setLocationCounts(d.counts); })
      .catch(() => null);
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
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Site-wide announcement banner (e.g. World Cup) — full width, above all */}
      <SiteBanner />
      <div className="flex flex-1 overflow-hidden">
        <CalendarSidebar
          calendars={calendars}
          onCalendarToggle={handleCalendarToggle}
          onAddCalendar={() => setAddCalendarOpen(true)}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
          locationFilter={locationFilter}
          onLocationFilter={setLocationFilter}
          locationCounts={locationCounts}
          onMiniDateClick={(date) => gotoDateRef.current?.(date)}
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
          categoryFilter={categoryFilter}
          locationFilter={locationFilter}
          onGotoDateReady={(fn) => { gotoDateRef.current = fn; }}
        />
      </div>
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
      {/* Decorative mascot — only shows under the ⚽ Football event theme */}
      <FootballMascot />
      {/* First-run prompt: which team do you support? (mascot wears its kit) */}
      <TeamPicker />
    </div>
  );
}
