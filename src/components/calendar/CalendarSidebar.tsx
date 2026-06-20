"use client";

import { useState, useEffect, type ReactNode } from "react";
import { Plus, ChevronLeft, ChevronRight, ChevronDown, Settings, Users, Megaphone, Ticket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import Link from "next/link";
import type { CalendarType, EventCategory } from "@/types";
import { EVENT_CATEGORIES, CATEGORY_LABELS } from "@/types";

interface CalendarSidebarProps {
  calendars: CalendarType[];
  onCalendarToggle: (id: string, visible: boolean) => void;
  onAddCalendar: () => void;
  /** Mobile: whether the drawer is open */
  mobileOpen?: boolean;
  /** Mobile: callback to close the drawer */
  onMobileClose?: () => void;
  /** Active category filter — null = show all */
  categoryFilter?: EventCategory | null;
  onCategoryFilter?: (cat: EventCategory | null) => void;
  /** Active location (country) filter — null = show all */
  locationFilter?: string | null;
  onLocationFilter?: (loc: string | null) => void;
  /** Location counts from events — for showing filter chips */
  locationCounts?: Record<string, number>;
  /** Called when user clicks a date on the mini calendar */
  onMiniDateClick?: (date: Date) => void;
}

/** Collapsible sidebar section with a chevron header, optional header action,
 *  and an optional summary row shown while collapsed (e.g. the active filter). */
function SidebarSection({
  id,
  label,
  open,
  onToggle,
  action,
  collapsedSummary,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  collapsedSummary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`sidebar-section-${id}`}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          {label}
        </button>
        {action}
      </div>
      <div id={`sidebar-section-${id}`}>
        {open ? children : collapsedSummary ?? null}
      </div>
    </div>
  );
}

/** Default number of chips shown before a section collapses behind "+N more". */
const COLLAPSED_TAG_LIMIT = 8;

const tagChipClass = (active: boolean) =>
  `text-xs md:text-[11px] px-2 py-1 md:px-1.5 md:py-0.5 rounded-full border transition-colors ${
    active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
  }`;

/**
 * A wrapping list of filter chips that stays compact as the set grows: it shows
 * the first `limit` chips and tucks the rest behind a "+N more" toggle (→ "Show
 * less"). The active chip is always kept visible even when collapsed, so the
 * current filter is never hidden.
 */
function TagFilter<T extends string>({
  items,
  active,
  onSelect,
  limit = COLLAPSED_TAG_LIMIT,
}: {
  items: { key: T; label: ReactNode }[];
  active: T | null;
  onSelect: (key: T | null) => void;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflowing = items.length > limit;
  const hiddenCount = items.length - limit;

  let visible = items;
  if (!expanded && overflowing) {
    visible = items.slice(0, limit);
    // Keep the active chip reachable: if it's hidden, swap it into the last slot.
    const activeIdx = items.findIndex((i) => i.key === active);
    if (activeIdx >= limit) visible = [...items.slice(0, limit - 1), items[activeIdx]];
  }

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((it) => (
        <button
          key={it.key}
          onClick={() => onSelect(active === it.key ? null : it.key)}
          className={tagChipClass(active === it.key)}
        >
          {it.label}
        </button>
      ))}
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-xs md:text-[11px] px-2 py-1 md:px-1.5 md:py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {expanded ? "Show less" : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

export function CalendarSidebar({
  calendars,
  onCalendarToggle,
  onAddCalendar,
  mobileOpen = false,
  onMobileClose,
  categoryFilter,
  onCategoryFilter,
  locationFilter,
  onLocationFilter,
  locationCounts,
  onMiniDateClick,
}: CalendarSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Per-section expand/collapse — persisted so the layout survives reloads.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    calendars: true,
    location: true,
    category: true,
  });
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar-sections");
      if (saved) setOpenSections((prev) => ({ ...prev, ...JSON.parse(saved) }));
    } catch {
      // Ignore corrupt localStorage — defaults stay in place
    }
  }, []);
  const toggleSection = (key: string) =>
    setOpenSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("sidebar-sections", JSON.stringify(next));
      } catch {
        // Storage may be unavailable (private mode) — collapse still works for the session
      }
      return next;
    });

  // Mini calendar state
  const [miniDate, setMiniDate] = useState(new Date());
  const year = miniDate.getFullYear();
  const month = miniDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Use client-side date only — avoids SSR/Vercel UTC mismatch where the server's
  // timezone differs from the user's local timezone, causing the wrong day to be highlighted.
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => { setToday(new Date()); }, []);

  // Explicit locale — keeps the mini calendar consistent with the main
  // calendar header ("June 2026") regardless of the OS/browser locale.
  const monthName = miniDate.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () => setMiniDate(new Date(year, month - 1, 1));
  const nextMonth = () => setMiniDate(new Date(year, month + 1, 1));

  if (collapsed) {
    return (
      // On mobile, collapsed sidebar is fully hidden (mobile uses drawer instead)
      <div className="hidden md:flex w-12 border-r border-border bg-card flex-col items-center pt-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(false)}
          className="size-8"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    );
  }

  const sidebarContent = (
    <div className="w-64 border-r border-border bg-card flex flex-col h-full">
      {/* Header row: title + collapse (desktop) or close (mobile) */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-sm font-semibold">Calendars</span>
        {/* Desktop collapse */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(true)}
          className="size-6 hidden md:flex"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <ChevronLeft className="size-4" />
        </Button>
        {/* Mobile close */}
        {onMobileClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMobileClose}
            className="size-6 md:hidden"
            aria-label="Close sidebar"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* Mini Calendar */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <Button variant="ghost" size="icon" onClick={prevMonth} className="size-6" aria-label="Previous month" title="Previous month">
            <ChevronLeft className="size-3" />
          </Button>
          <span className="text-xs font-medium" aria-live="polite">{monthName}</span>
          <Button variant="ghost" size="icon" onClick={nextMonth} className="size-6" aria-label="Next month" title="Next month">
            <ChevronRight className="size-3" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-0 text-center">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="text-[10px] text-muted-foreground py-1">
              {d}
            </div>
          ))}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const isToday =
              today !== null &&
              day === today.getDate() &&
              month === today.getMonth() &&
              year === today.getFullYear();
            const clickDate = new Date(year, month, day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => onMiniDateClick?.(clickDate)}
                aria-label={clickDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                aria-current={isToday ? "date" : undefined}
                className={`text-xs py-1 md:text-[11px] md:py-0.5 rounded-full cursor-pointer select-none ${
                  isToday
                    ? "bg-primary text-primary-foreground font-bold"
                    : "hover:bg-accent"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {/* All sections share one scroll container so long filter lists never
          squeeze the calendar list off-screen — everything scrolls together.
          Flex column so the filter group can anchor to the bottom (mt-auto). */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0 flex flex-col">
        <SidebarSection
          id="calendars"
          label="My Calendars"
          open={openSections.calendars}
          onToggle={() => toggleSection("calendars")}
          action={
            <Button
              variant="ghost"
              size="icon"
              onClick={onAddCalendar}
              className="size-6"
              aria-label="Add calendar"
              title="Add calendar"
            >
              <Plus className="size-3" />
            </Button>
          }
        >
        <div className="flex flex-col gap-1">
          {(() => {
            const TICKET_NAMES = ["event-reminders", "sale-ticket"];
            const myCalendars = calendars.filter((c) => !c.memberRole);
            // Names that also appear as shared-with-me → show "(yourself)" to distinguish
            const sharedNames = new Set(
              calendars.filter((c) => c.memberRole).map((c) => c.name)
            );
            // Sort: visible ticket calendars first (normal), then hidden ticket calendars last
            const sorted = [
              ...myCalendars.filter((c) => !TICKET_NAMES.includes(c.name) || c.isVisible),
              ...myCalendars.filter((c) => TICKET_NAMES.includes(c.name) && !c.isVisible),
            ];
            return sorted.map((cal) => (
              <div
                key={cal.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent group"
              >
                <div
                  className="size-3 rounded-sm shrink-0"
                  style={{ backgroundColor: cal.color }}
                />
                <span className="text-sm flex-1 truncate">
                  {cal.name}
                  {sharedNames.has(cal.name) && TICKET_NAMES.includes(cal.name) && (
                    <span className="ml-1 text-[10px] text-muted-foreground">(yourself)</span>
                  )}
                </span>
                {cal.googleCalendarId && (
                  <span className="text-[10px] text-muted-foreground">G</span>
                )}
                {cal.shareMode && (
                  cal.shareMode === "broadcast"
                    ? <Megaphone className="size-3 text-muted-foreground shrink-0" />
                    : <Users className="size-3 text-muted-foreground shrink-0" />
                )}
                <Switch
                  checked={cal.isVisible}
                  onCheckedChange={(checked) => onCalendarToggle(cal.id, checked)}
                  className="scale-75"
                />
              </div>
            ));
          })()}
        </div>

        {/* Shared with me */}
        {calendars.some((c) => c.memberRole) && (
          <>
            <div className="flex items-center gap-1 mt-3 mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Shared with me
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {calendars.filter((c) => c.memberRole).map((cal) => (
                <div
                  key={cal.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent group"
                >
                  <div
                    className="size-3 rounded-sm shrink-0"
                    style={{ backgroundColor: cal.color }}
                  />
                  <span className="text-sm flex-1 truncate">{cal.name}</span>
                  <span className="text-[10px] text-muted-foreground capitalize">
                    {cal.memberRole}
                  </span>
                  <Switch
                    checked={cal.isVisible}
                    onCheckedChange={(checked) => onCalendarToggle(cal.id, checked)}
                    className="scale-75"
                  />
                </div>
              ))}
            </div>
          </>
        )}
        </SidebarSection>

        {/* Filter group — anchored to the sidebar bottom when content is short,
            scrolls naturally with the rest when content overflows. */}
        <div className="mt-auto shrink-0 pt-3">
        {/* Location filter chips */}
        {onLocationFilter && locationCounts && Object.keys(locationCounts).length > 0 && (
          <SidebarSection
            id="location"
            label="Location"
            open={openSections.location}
            onToggle={() => toggleSection("location")}
            action={
              locationFilter ? (
                <button
                  onClick={() => onLocationFilter(null)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              ) : undefined
            }
            collapsedSummary={
              locationFilter ? (
                <button
                  onClick={() => onLocationFilter(null)}
                  title="Clear location filter"
                  className="text-xs md:text-[11px] px-2 py-1 md:px-1.5 md:py-0.5 rounded-full border bg-primary text-primary-foreground border-primary"
                >
                  {locationFilter} ×
                </button>
              ) : undefined
            }
          >
            <TagFilter
              active={locationFilter ?? null}
              onSelect={onLocationFilter}
              items={Object.entries(locationCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([loc, count]) => ({
                  key: loc,
                  label: (
                    <>
                      {loc} <span className="opacity-60">{count}</span>
                    </>
                  ),
                }))}
            />
          </SidebarSection>
        )}

        {/* Category filter chips */}
        {onCategoryFilter && (
          <SidebarSection
            id="category"
            label="Category"
            open={openSections.category}
            onToggle={() => toggleSection("category")}
            action={
              categoryFilter ? (
                <button
                  onClick={() => onCategoryFilter(null)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              ) : undefined
            }
            collapsedSummary={
              categoryFilter ? (
                <button
                  onClick={() => onCategoryFilter(null)}
                  title="Clear category filter"
                  className="text-xs md:text-[11px] px-2 py-1 md:px-1.5 md:py-0.5 rounded-full border bg-primary text-primary-foreground border-primary"
                >
                  {CATEGORY_LABELS[categoryFilter]} ×
                </button>
              ) : undefined
            }
          >
            <TagFilter
              active={categoryFilter ?? null}
              onSelect={onCategoryFilter}
              items={EVENT_CATEGORIES.map((cat) => ({
                key: cat,
                label: CATEGORY_LABELS[cat],
              }))}
            />
          </SidebarSection>
        )}
        </div>
      </div>

      {/* Bottom nav links */}
      <div className="p-3 border-t border-border space-y-1">
        <Link href="/tickets">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
            <Ticket className="size-4" />
            Event Section
          </Button>
        </Link>
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
            <Settings className="size-4" />
            Settings
          </Button>
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — always rendered, hidden on mobile */}
      <div className="hidden md:flex shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onMobileClose}
          />
          {/* Drawer panel */}
          <div className="relative z-10 flex h-full">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
