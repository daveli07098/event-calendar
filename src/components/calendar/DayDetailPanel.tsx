"use client";

import { X, Plus, Clock, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CalendarType, EventType } from "@/types";

interface DayDetailPanelProps {
  date: string; // "YYYY-MM-DD"
  events: EventType[];
  calendars: CalendarType[];
  onClose: () => void;
  onCreateEvent: (date: string) => void;
  onEditEvent: (event: EventType) => void;
  /** When true the panel renders as a bottom-sheet modal (mobile) */
  modal?: boolean;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPanelDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Derive a short location region tag from a venue location string. */
function locationTag(location: string | null | undefined): string | null {
  if (!location) return null;
  if (location.includes("香港") || location.toLowerCase().includes("hong kong")) return "Hong Kong";
  return null;
}

export function DayDetailPanel({
  date,
  events,
  onClose,
  onCreateEvent,
  onEditEvent,
  modal = false,
}: DayDetailPanelProps) {
  const dayEvents = events
    .filter((e) => {
      // Use logical date boundaries rather than just string comparison to handle
      // midnight edges correctly.
      if (e.allDay) {
        // All-day logic: compare the date strings directly (ignoring time).
        // Standardize end date for comparison.
        const start = e.startTime.slice(0, 10);
        const end = e.endTime ? e.endTime.slice(0, 10) : start;
        // FullCalendar all-day ends are often exclusive (e.g. 2026-06-13 for an event on 06-12).
        // If end > start and it's allDay, the logical last day is usually end - 1.
        let displayEnd = end;
        if (e.endTime && end > start) {
          const endDateObj = new Date(e.endTime);
          // If it's exactly T00:00:00 on the next day, subtract 1ms to get the previous day's string.
          if (e.endTime.includes("T00:00:00")) {
            displayEnd = new Date(endDateObj.getTime() - 1).toLocaleDateString("en-CA");
          }
        }
        return date >= start && date <= displayEnd;
      }

      // Timed events: check if the event spans any part of the 24h local window.
      // Parse with spaces to force local timezone in most browsers.
      const dayStart = new Date(`${date.replace(/-/g, "/")} 00:00:00`).getTime();
      const dayEnd = new Date(`${date.replace(/-/g, "/")} 23:59:59`).getTime();
      const eventStart = new Date(e.startTime).getTime();
      const eventEnd = e.endTime ? new Date(e.endTime).getTime() : eventStart;

      // Overlap: Starts before day ends AND ends after day starts.
      return eventStart <= dayEnd && eventEnd >= dayStart;
    })
    .sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });

  const panel = (
    <div className={modal
      ? "w-full max-h-[70svh] flex flex-col overflow-hidden rounded-t-2xl bg-background"
      : "w-72 shrink-0 border-l bg-background flex flex-col overflow-hidden"
    }>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <p className="text-sm font-semibold">{formatPanelDate(date)}</p>
        <button
          onClick={onClose}
          className="rounded-md p-1 hover:bg-muted transition-colors"
        >
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>

      {/* New event button */}
      <div className="px-3 py-2.5 border-b">
        <Button
          size="sm"
          className="w-full gap-1.5"
          onClick={() => onCreateEvent(date)}
        >
          <Plus className="size-4" />
          New event
        </Button>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {dayEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No events
          </p>
        ) : (
          dayEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => onEditEvent(event)}
              className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted transition-colors flex items-start gap-2.5"
            >
              <span
                className="mt-1 size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: event.calendar?.color ?? "#4285f4" }}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate leading-tight">
                  {event.title}
                </p>
                {event.allDay ? (
                  <p className="text-xs text-muted-foreground">All day</p>
                ) : (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="size-3 shrink-0" />
                    {formatTime(event.startTime)}
                    {event.endTime && ` – ${formatTime(event.endTime)}`}
                  </p>
                )}
                {event.location && (
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <MapPin className="size-3 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                      {event.location.split(",")[0]}
                    </span>
                    {locationTag(event.location) && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 leading-none shrink-0">
                        {locationTag(event.location)}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );

  if (modal) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end">
        {/* Scrim */}
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        {/* Sheet */}
        <div className="relative z-10">
          {panel}
        </div>
      </div>
    );
  }

  return panel;
}
