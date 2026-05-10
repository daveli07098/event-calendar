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
      const start = e.startTime.slice(0, 10);
      const end = e.endTime ? e.endTime.slice(0, 10) : start;
      return date >= start && date <= end;
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
