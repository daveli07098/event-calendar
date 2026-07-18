"use client";

import { useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BookmarkedEvent } from "@/types";

/** Rows per page in the popover list. */
const PAGE_SIZE = 8;

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
  const [page, setPage] = useState(0);

  const ended = (b: BookmarkedEvent) => now > 0 && new Date(b.endTime).getTime() < now;
  const upcoming = bookmarks.filter((b) => !ended(b));
  const past = bookmarks.filter(ended).reverse(); // API sorts by start asc → most recent first
  const sorted = [...upcoming, ...past];

  // Date-ordered pagination: upcoming pages first (soonest → latest), ended after
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = sorted.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setNow(Date.now());
          setPage(0); // always reopen on the first (soonest-upcoming) page
        }
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
            {pageItems.map((b) => {
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
        {/* Pagination footer — only when the list spans multiple pages */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border/60 mt-1.5 pt-1.5 px-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, clampedPage - 1))}
              disabled={clampedPage === 0}
              aria-label="Previous page"
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none rounded px-1.5 py-1 hover:bg-accent transition-colors"
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </button>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {clampedPage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages - 1, clampedPage + 1))}
              disabled={clampedPage >= totalPages - 1}
              aria-label="Next page"
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none rounded px-1.5 py-1 hover:bg-accent transition-colors"
            >
              Next
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
