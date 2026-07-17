"use client";

import { useState } from "react";
import { Bookmark } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BookmarkedEvent } from "@/types";

interface BookmarkPopoverProps {
  bookmarks: BookmarkedEvent[];
  /** Open the clicked event's detail modal (and navigate the calendar to it) */
  onSelect: (eventId: string) => void;
}

/**
 * Always-visible 🔖 button in the calendar header — opens a popup listing the
 * user's bookmarked events across ALL calendars. Upcoming events first with
 * their date; ended ones sink to the bottom, crossed out with an "Ended" badge.
 */
export function BookmarkPopover({ bookmarks, onSelect }: BookmarkPopoverProps) {
  const [open, setOpen] = useState(false);
  // Snapshotted when the popover opens (event handler, not render) so the
  // ended/upcoming split is computed against a stable "now".
  const [now, setNow] = useState(0);

  const ended = (b: BookmarkedEvent) => now > 0 && new Date(b.endTime).getTime() < now;
  const upcoming = bookmarks.filter((b) => !ended(b));
  const past = bookmarks.filter(ended).reverse(); // API sorts by start asc → most recent first
  const sorted = [...upcoming, ...past];

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setNow(Date.now());
      }}
    >
      <PopoverTrigger
        aria-label="Bookmarked events"
        title="Bookmarked events"
        className="relative flex h-9 items-center gap-1.5 rounded-md border border-input bg-muted/30 px-2.5 text-sm text-muted-foreground hover:bg-muted/60 transition-colors cursor-pointer"
      >
        <Bookmark className="size-4" />
        {upcoming.length > 0 && (
          <span className="text-xs font-medium tabular-nums">{upcoming.length}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-96 overflow-y-auto p-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 pt-1 pb-1.5">
          Bookmarked
        </p>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 pb-2">
            No bookmarks yet — open an event and tap the{" "}
            <Bookmark className="inline size-3 align-[-2px]" /> icon next to its title.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sorted.map((b) => {
              const isPast = ended(b);
              const date = new Date(b.startTime).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelect(b.id);
                  }}
                  title={`${b.title} — ${b.calendarName}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-left w-full"
                >
                  <Bookmark
                    className={`size-3 shrink-0 ${isPast ? "text-muted-foreground/50" : "text-primary"}`}
                    fill="currentColor"
                  />
                  <span
                    className={`text-sm flex-1 truncate ${
                      isPast ? "line-through text-muted-foreground" : ""
                    }`}
                  >
                    {b.title}
                  </span>
                  {isPast ? (
                    <span className="text-[10px] text-muted-foreground border border-border rounded px-1 py-0 leading-tight shrink-0">
                      Ended
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {date}
                    </span>
                  )}
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: b.calendarColor }}
                    title={b.calendarName}
                  />
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
