"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { mutate } from "@/lib/mutate";
import { REMINDERS_CALENDAR_NAME, remindersCalendarVisible } from "@/lib/calendar-names";
import { CalendarView } from "@/components/calendar/CalendarView";
import { CalendarSidebar } from "@/components/calendar/CalendarSidebar";
import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";
import { SearchDialog } from "@/components/calendar/SearchDialog";
import { SiteBanner } from "@/components/banner/SiteBanner";
import { FootballMascot } from "@/components/theme/FootballMascot";
import { TeamPicker } from "@/components/theme/TeamPicker";
import { FlagBunting, WorldCupTabFlair } from "@/components/theme/WorldCupFlair";
import type { CalendarType, EventType, EventCategory, BookmarkedEvent } from "@/types";

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
  // Filters start unset (show everything) and are remembered across visits: a
  // first-time user sees all events, while a returning user gets back whatever
  // they last had (e.g. Hong Kong + Concert). Persisted in localStorage below.
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | null>(null);
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [locationCounts, setLocationCounts] = useState<Record<string, number>>({});
  const [bookmarks, setBookmarks] = useState<BookmarkedEvent[]>([]);
  // Ref to CalendarView's gotoDate function (set by CalendarView via callback)
  const gotoDateRef = useRef<((date: Date) => void) | null>(null);

  // On mount: open event + navigate to date if URL has ?event=id
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("event");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of URL on mount
    if (eventId) setOpenEventId(eventId);
  }, []);

  // Restore the user's last filter selection (none for first-time visitors).
  // Skipped entirely while the reminders calendar is hidden: those filters only
  // narrow ticket-derived events, so restoring them there would silently hide
  // everything with no visible cause. Covers the cross-device case where this
  // browser still has filters saved but the calendar was hidden elsewhere.
  useEffect(() => {
    if (remindersCalendarVisible(initialCalendars)) {
      try {
        const raw = localStorage.getItem("calendar.filters");
        if (raw) {
          const f = JSON.parse(raw) as { category?: unknown; location?: unknown };
          // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore on mount
          if (typeof f.category === "string") setCategoryFilter(f.category as EventCategory);
          if (typeof f.location === "string") setLocationFilter(f.location);
        }
      } catch { /* corrupt/blocked storage → stay unfiltered */ }
    }
    setFiltersLoaded(true);
  }, [initialCalendars]);

  // Persist filter changes so the next visit restores them. Gated on
  // filtersLoaded so the initial restore doesn't immediately clobber storage.
  useEffect(() => {
    if (!filtersLoaded) return;
    try {
      localStorage.setItem(
        "calendar.filters",
        JSON.stringify({ category: categoryFilter, location: locationFilter }),
      );
    } catch { /* storage unavailable — non-fatal */ }
  }, [filtersLoaded, categoryFilter, locationFilter]);

  // Fetch location counts on mount (for sidebar chips)
  useEffect(() => {
    fetch("/api/events/tag-location")
      .then((r) => r.json())
      .then((d) => { if (d.counts) setLocationCounts(d.counts); })
      .catch(() => null);
  }, []);

  // Bookmarked events (across all calendars) for the sidebar section
  const refreshBookmarks = useCallback(() => {
    fetch("/api/events/bookmarks")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setBookmarks(d); })
      .catch(() => null);
  }, []);
  useEffect(() => { refreshBookmarks(); }, [refreshBookmarks]);

  // Toggle a bookmark from the event modal; refresh the sidebar list after.
  const handleBookmarkToggle = useCallback(async (eventId: string, bookmarked: boolean) => {
    const res = await fetch(`/api/events/${eventId}/bookmark`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarked }),
    });
    if (!res.ok) throw new Error("Bookmark update failed");
    refreshBookmarks();
  }, [refreshBookmarks]);

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
    // Snapshot so a failed PUT can restore exactly what was on screen before
    // the optimistic flip, instead of silently reverting on the next reload.
    const previousCalendars = calendars;
    // Hiding the reminders calendar also drops the category/location filters:
    // they only narrow ticket-derived events, so leaving them applied would
    // show an empty calendar with no visible explanation. Snapshotted too, so
    // a failed PUT restores the filters along with the visibility.
    const clearsFilters =
      !visible &&
      calendars.some((c) => c.id === id && c.name === REMINDERS_CALENDAR_NAME && !c.memberRole);
    const previousFilters = { category: categoryFilter, location: locationFilter };
    await mutate(`/api/calendars/${id}`, {
      method: "PUT",
      body: { isVisible: visible },
      optimisticUpdate: () => {
        setCalendars((prev) =>
          prev.map((c) => (c.id === id ? { ...c, isVisible: visible } : c))
        );
        if (clearsFilters) {
          setCategoryFilter(null);
          setLocationFilter(null);
        }
      },
      rollback: () => {
        setCalendars(previousCalendars);
        if (clearsFilters) {
          setCategoryFilter(previousFilters.category);
          setLocationFilter(previousFilters.location);
        }
      },
      fallbackError: "Failed to update calendar visibility.",
    });
  };

  const handleAddCalendar = async (name: string, color: string) => {
    const result = await mutate<CalendarType>("/api/calendars", {
      method: "POST",
      body: { name, color },
      fallbackError: "Failed to add calendar.",
    });
    if (!result.ok || !result.data) {
      // Throwing (rather than silently returning) keeps AddCalendarDialog's
      // form open on failure instead of closing as if the calendar was
      // created — mirrors the handleBookmarkToggle pattern above.
      throw new Error(result.error ?? "Failed to add calendar.");
    }
    setCalendars((prev) => [...prev, result.data as CalendarType]);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Site-wide announcement banner (e.g. World Cup) — full width, above all */}
      <SiteBanner />
      {/* Decorative pennant bunting under the banner (World Cup theme only) */}
      <FlagBunting />
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
          bookmarks={bookmarks}
          onBookmarkSelect={(id) => setOpenEventId(id)}
          onBookmarkToggle={handleBookmarkToggle}
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
      {/* Turns the browser tab into ⚽ + live match while the World Cup theme is on */}
      <WorldCupTabFlair />
    </div>
  );
}
