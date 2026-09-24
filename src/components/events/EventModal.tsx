"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, ExternalLink, Copy, ArrowRight, RefreshCw, Image as ImageIcon, Bookmark } from "lucide-react";
import type { CalendarType, EventType, EventFormData, EventCategory } from "@/types";
import { EVENT_CATEGORIES, CATEGORY_LABELS } from "@/types";
import { useEventFormState } from "@/hooks/useEventFormState";
import { describeVenueTime } from "@/lib/event-timezone";
import { parseSeat } from "@/lib/seat-parse";
import { SeatBreakdown } from "@/components/events/SeatBreakdown";
import { useVenueSeatMaps } from "@/lib/venue-seatmap/use-venue-seatmaps";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";
import dynamic from "next/dynamic";

// Lazy-loaded: the SVG bowl and the per-venue geometry tables are only needed
// once someone actually enters a seat, and that table grows with every venue
// added. ssr: false is valid here because EventModal is a Client Component
// (see node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md).
const SeatMap = dynamic(
  () => import("@/components/venue/SeatMap").then((m) => m.SeatMap),
  { ssr: false },
);

// Same lazy-loading rationale as SeatMap above, plus `three` itself (see SeatMap3D.tsx's own
// header) — none of this belongs in the main chunk until someone actually opens the 3D view.
const SeatMap3D = dynamic(
  () => import("@/components/venue/SeatMap3D").then((m) => m.SeatMap3D),
  { ssr: false },
);

interface RelatedEvent {
  id: string;
  title: string;
  calendarName: string;
  calendarColor: string;
  startTime: string;
}

interface EventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventType | null;
  calendars: CalendarType[];
  defaultCalendarId: string;
  initialRange?: {
    start: string;
    end: string;
    allDay: boolean;
  } | null;
  initialData?: EventFormData;
  onSave: (data: EventFormData) => Promise<void>;
  onDelete: () => Promise<void>;
  onCopy?: (data: EventFormData) => void;
  /** Called after a successful Sync so CalendarView can refresh the updated event */
  onSynced?: (updatedEvent: EventType) => void;
  onEventSelect?: (eventId: string, startTime: string) => void;
  readOnly?: boolean;
  /** Whether the current user has bookmarked this event */
  bookmarked?: boolean;
  /** Toggle the bookmark; should reject on failure so the UI can revert */
  onBookmarkToggle?: (eventId: string, bookmarked: boolean) => Promise<void>;
}

export function EventModal({
  open,
  onOpenChange,
  event,
  calendars,
  defaultCalendarId,
  initialRange,
  initialData,
  onSave,
  onDelete,
  onCopy,
  onSynced,
  onEventSelect,
  readOnly = false,
  bookmarked = false,
  onBookmarkToggle,
}: EventModalProps) {
  // Form fields, initialization, all-day time-of-day memory, and the
  // unsaved-changes dirty baseline all live in useEventFormState — see that
  // hook for why initialization only runs on a genuine open/event transition.
  const {
    title, setTitle,
    description, setDescription,
    location, setLocation,
    startTime, setStartTime,
    endTime, setEndTime,
    allDay, toggleAllDay,
    calendarId, setCalendarId,
    category, setCategory,
    artist, setArtist,
    referenceUrl, setReferenceUrl,
    seatingPlanUrl, setSeatingPlanUrl,
    seat, setSeat,
    swapStartEnd,
    applyServerFields,
    isDirty,
    initVersion,
  } = useEventFormState({ open, event, initialData, initialRange, defaultCalendarId });

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Optimistic bookmark state — flips immediately on click, reverts if the API fails
  const [isBookmarked, setIsBookmarked] = useState(bookmarked);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync when a different event opens
    setIsBookmarked(bookmarked);
  }, [bookmarked, event?.id, open]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncingTeams, setSyncingTeams] = useState(false);
  const [syncTeamsError, setSyncTeamsError] = useState<string | null>(null);
  const [relatedEvents, setRelatedEvents] = useState<RelatedEvent[]>([]);
  const [seatingDragOver, setSeatingDragOver] = useState(false);
  const seatingInputRef = useRef<HTMLInputElement>(null);
  /** Holds scrape + diff result to show a preview before applying */
  const [syncPreview, setSyncPreview] = useState<{
    changes: Array<{ field: string; label: string; oldValue: string | null; newValue: string | null }>;
    ticket: Record<string, unknown>;
    diffResult: { eventId: string | null; saleEventIds: Record<string, string>; saleEventId: string | null; presaleEventId: string | null };
  } | null>(null);
  // Gates Delete and the unsaved-changes ("discard?") confirmation dialogs —
  // null when neither is pending.
  const [confirmKind, setConfirmKind] = useState<"delete" | "discard" | null>(null);

  // Transient sync UI (error/preview banners) is only meaningful for the
  // currently-open event — clear it on a genuine open/event transition
  // (see useEventFormState's initVersion) so stale banners don't bleed into
  // the next event opened in the same modal instance.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient sync UI on a genuine open/event transition
    setSyncError(null);
    setSyncPreview(null);
    setSyncTeamsError(null);
  }, [initVersion]);

  // The device's zone, NOT Theme.timeZone. The datetime-local inputs below hold
  // device wall-clock values and submit is computed from them, so labelling them
  // with any other zone would be a lie: someone in London with the shipped
  // default (Asia/Hong_Kong) would see London times under a "Hong Kong" label.
  // Theme.timeZone deliberately still governs read-only surfaces like
  // WorldCupSection; unifying the two means making these inputs zone-aware,
  // which is a bigger change than a display tweak.
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const hasInvalidDateRange = Boolean(startTime && endTime) && new Date(endTime).getTime() < new Date(startTime).getTime();

  // Venue-timezone secondary line for the start time — only meaningful for
  // timed events, and only rendered when describeVenueTime finds it adds real
  // information (venue zone resolves, differs from the viewer zone, AND the
  // wall-clock time actually differs).
  const startDate = startTime ? new Date(startTime) : null;
  const venueTimeInfo = !allDay && startDate && !Number.isNaN(startDate.getTime())
    ? describeVenueTime(startDate.toISOString(), { title, location }, userTimezone)
    : null;

  // Helper: update description to include/replace seating plan URL line
  const applySeatingPlan = (desc: string, url: string): string => {
    const line = url.trim() ? `Seating Plan: ${url.trim()}` : null;
    const replaced = desc.replace(/^Seating Plan: https?:\/\/[^\n]*/m, line ?? "").replace(/\n{3,}/g, "\n\n");
    // Anchored test, not includes(): a description containing prose like
    // "the Seating Plan: will be emailed" would otherwise suppress the append.
    if (line && !/^Seating Plan: /m.test(replaced)) {
      return replaced.trimEnd() + (replaced ? "\n\n" : "") + line;
    }
    return replaced;
  };

  // Helper: update description to include/replace the manually-entered Seat
  // line — mirrors applySeatingPlan above, same "Seat: <raw>" convention.
  // Manual entry only: scraped sale pages never contain a buyer's seat, so
  // this never touches the scrape pipeline.
  const applySeat = (desc: string, seatValue: string): string => {
    const line = seatValue.trim() ? `Seat: ${seatValue.trim()}` : null;
    const replaced = desc.replace(/^Seat: [^\n]*/m, line ?? "").replace(/\n{3,}/g, "\n\n");
    // Anchored, per the note in applySeatingPlan — prose such as
    // "your Seat: assigned at the gate" must not suppress the append.
    if (line && !/^Seat: /m.test(replaced)) {
      return replaced.trimEnd() + (replaced ? "\n\n" : "") + line;
    }
    return replaced;
  };

  // Live structured breakdown of the Seat field, re-parsed on every keystroke
  // (the parser is synchronous and dependency-free — see seat-parse.ts).
  // Deliberately no `inferLevelFromBlock` option: level inference is
  // venue-specific and the per-venue config lives in the seat-map worker's
  // files, not here — see seat-parse.ts header point 1.
  const seatParseResult = useMemo(() => (seat.trim() ? parseSeat(seat) : null), [seat]);

  // Whether `location` matches a venue with a seat-map config — gates the 2D/3D toggle below.
  // Loaded via a dynamic import (not a static `matchVenueConfig` import) so the per-venue
  // geometry registry stays out of this modal's main chunk, same reasoning as the dynamic()
  // wrappers above; only fires when there's a seat to map in the first place.
  // Community configs approved in the venue directory (GET /api/venues/seatmaps) are matched as
  // `extra` — the static registry (Kai Tak) still wins inside matchVenueConfig. The list is
  // fetched once per page load (module-scope cache) and only once a seat has been entered.
  const { approvedConfigs } = useVenueSeatMaps(!!seatParseResult);
  const [matchedSeatMapConfig, setMatchedSeatMapConfig] = useState<VenueSeatMapConfig | null>(null);
  const hasSeatMapConfig = matchedSeatMapConfig !== null;
  const [seatMapView, setSeatMapView] = useState<"2d" | "3d">("2d");
  useEffect(() => {
    if (!seatParseResult) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the toggle when there's no seat to map
      setMatchedSeatMapConfig(null);
      return;
    }
    let cancelled = false;
    import("@/lib/venue-seatmap/registry").then(({ matchVenueConfig }) => {
      if (!cancelled) setMatchedSeatMapConfig(matchVenueConfig(location, approvedConfigs));
    });
    return () => {
      cancelled = true;
    };
  }, [location, seatParseResult, approvedConfigs]);

  // Related events — events sharing this one's Ticket URL, shown above the
  // description so the user can jump between them. Re-derived whenever the
  // open event changes; cleared when there's nothing to look up.
  useEffect(() => {
    if (!event?.description) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear related events when the open event has no description to read a Ticket URL from
      setRelatedEvents([]);
      return;
    }
    const ticketUrl = event.description.match(/Ticket URL: (https?:\/\/[^\s]+)/)?.[1];
    if (!ticketUrl) {
      setRelatedEvents([]);
      return;
    }
    fetch(`/api/events/related?url=${encodeURIComponent(ticketUrl)}&excludeId=${event.id}`)
      .then((response) => response.json())
      .then((data) => setRelatedEvents(data))
      .catch(() => setRelatedEvents([]));
  }, [event]);

  // Bookmark toggle — allowed even on read-only calendars (per-user, doesn't edit the event)
  const handleBookmarkToggle = async () => {
    if (!event || !onBookmarkToggle || bookmarkBusy) return;
    const next = !isBookmarked;
    setIsBookmarked(next);
    setBookmarkBusy(true);
    try {
      await onBookmarkToggle(event.id, next);
    } catch {
      setIsBookmarked(!next); // revert on failure
    } finally {
      setBookmarkBusy(false);
    }
  };

  // Update Teams: fetch current team names from Wikipedia via AI and update the event
  const handleSyncTeams = async () => {
    if (!event) return;
    setSyncingTeams(true);
    setSyncTeamsError(null);
    try {
      const res = await fetch("/api/events/worldcup-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      if (!data.success) {
        setSyncTeamsError(data.message ?? "Teams not yet determined.");
        return;
      }
      // Update local form fields (and fold them into the dirty baseline, since
      // they're now what's persisted) and notify parent
      applyServerFields({ title: data.updatedTitle, description: data.updatedEvent?.description });
      onSynced?.(data.updatedEvent);
      setSyncTeamsError(`✓ Updated: ${data.team1} vs ${data.team2}`);
    } catch (e) {
      setSyncTeamsError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSyncingTeams(false);
    }
  };

  // Sync: re-scrape the ticket URL, diff against stored event, show changes before applying.
  // When a reference URL is set (a later-announced / station-specific page), scrape THAT
  // instead — but keep the description's Ticket URL as the event's identity so diff lookup,
  // sale events, and related-event grouping stay anchored on the original URL.
  const handleSync = async () => {
    if (!event) return;
    const descUrl = event.description?.match(/Ticket URL: (https?:\/\/[^\s]+)/)?.[1];
    const scrapeUrl = referenceUrl.trim() || event.referenceUrl || descUrl;
    if (!scrapeUrl) return;
    const canonicalUrl = descUrl ?? scrapeUrl;
    setSyncing(true);
    setSyncError(null);
    setSyncPreview(null);
    try {
      // 1. Re-scrape
      const scrapeRes = await fetch("/api/tickets/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scrapeUrl }),
      });
      if (!scrapeRes.ok) throw new Error(await scrapeRes.text());
      const ticket = await scrapeRes.json();
      // Re-anchor scraped data on the canonical Ticket URL (see note above)
      if (ticket.sourceUrl !== canonicalUrl) ticket.sourceUrl = canonicalUrl;

      // 2. Diff against existing event
      const diffRes = await fetch("/api/tickets/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: canonicalUrl, ticket, eventId: event.id, tzOffsetMinutes: new Date().getTimezoneOffset() }),
      });
      if (!diffRes.ok) throw new Error("Diff check failed");
      const diff = await diffRes.json();

      if (!diff.hasChanges) {
        setSyncError("✓ Already up to date — no changes found.");
        setSyncing(false);
        return;
      }

      // 3. Show preview for user to confirm
      setSyncPreview({
        changes: diff.changes,
        ticket,
        diffResult: {
          eventId: diff.eventId,
          saleEventIds: diff.saleEventIds ?? {},
          saleEventId: diff.saleEventId ?? null,
          presaleEventId: diff.presaleEventId ?? null,
        },
      });
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // Apply the previewed sync changes
  const handleApplySync = async () => {
    if (!syncPreview || !event) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const applyRes = await fetch("/api/tickets/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: syncPreview.diffResult.eventId ?? event.id,
          saleEventIds: syncPreview.diffResult.saleEventIds,
          saleEventId: syncPreview.diffResult.saleEventId,
          presaleEventId: syncPreview.diffResult.presaleEventId,
          appliedFields: syncPreview.changes.map((c) => c.field),
          ticket: syncPreview.ticket,
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      if (!applyRes.ok) throw new Error(await applyRes.text());
      const applyData = await applyRes.json();
      const { updatedEvent, createdSaleCount } = applyData;
      setSyncPreview(null);
      if (updatedEvent) {
        applyServerFields({
          title: updatedEvent.title ?? title,
          description: updatedEvent.description ?? description,
          location: updatedEvent.location ?? location,
        });
        onSynced?.(updatedEvent);
      }
      // Re-fetch related events — new sale windows may have been created
      const syncedUrl = syncPreview.ticket.sourceUrl as string | undefined;
      if (event && syncedUrl) {
        fetch(`/api/events/related?url=${encodeURIComponent(syncedUrl)}&excludeId=${event.id}`)
          .then((r) => r.json())
          .then((data) => setRelatedEvents(Array.isArray(data) ? data : []))
          .catch(() => null);
      }
      if (createdSaleCount > 0) {
        setSyncError(`✓ Synced — ${createdSaleCount} new sale reminder${createdSaleCount > 1 ? "s" : ""} created.`);
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (hasInvalidDateRange) return;
    setSaving(true);
    try {
      // Merge seatingPlanUrl and seat back into description before saving.
      // Each helper also runs when the field is EMPTY but its line still exists,
      // so clearing the field actually removes the line — otherwise a cleared
      // seat silently reappears on reopen. Still skipped entirely when there's
      // neither a value nor an existing line, because the helpers collapse
      // blank-line runs and shouldn't rewrite descriptions they don't own.
      const descriptionWithSeatingPlan = seatingPlanUrl.trim() || /^Seating Plan: /m.test(description)
        ? applySeatingPlan(description, seatingPlanUrl)
        : description;
      const finalDescription = seat.trim() || /^Seat: /m.test(descriptionWithSeatingPlan)
        ? applySeat(descriptionWithSeatingPlan, seat)
        : descriptionWithSeatingPlan;
      await onSave({
        title: title.trim(),
        description: finalDescription || undefined,
        location: location || undefined,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        allDay,
        calendarId,
        category: category ?? null,
        artist: artist.trim() || null,
        referenceUrl: referenceUrl.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await onDelete();
    } finally {
      setSaving(false);
    }
  };

  // Escape, backdrop click, the dialog's ✕, and Cancel all funnel through
  // here — prompt for confirmation only when there's something to lose.
  const requestClose = () => {
    if (isDirty) {
      setConfirmKind("discard");
    } else {
      onOpenChange(false);
    }
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(next);
        } else {
          requestClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[480px] flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {readOnly ? "View Event" : event ? "Edit Event" : "New Event"}
            {/* Bookmark — existing events only; per-user so read-only viewers can use it too */}
            {event && onBookmarkToggle && (
              <button
                type="button"
                onClick={handleBookmarkToggle}
                disabled={bookmarkBusy}
                aria-pressed={isBookmarked}
                aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this event"}
                title={isBookmarked ? "Remove bookmark" : "Bookmark this event"}
                className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                <Bookmark
                  className={`size-4 ${isBookmarked ? "text-primary" : ""}`}
                  fill={isBookmarked ? "currentColor" : "none"}
                />
              </button>
            )}
          </DialogTitle>
        </DialogHeader>
        {readOnly && (
          <p className="text-xs text-amber-500/90 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-1.5 -mt-1">
            This calendar is view-only — you cannot edit events.
          </p>
        )}
        <form id="event-modal-form" onSubmit={readOnly ? (e) => e.preventDefault() : handleSubmit} className="flex flex-col gap-4 overflow-y-auto min-h-0 pr-1 pb-1">
          {/* Dimming overlay for read-only — wraps all fields */}
          <div className={readOnly ? "opacity-60 pointer-events-none select-none flex flex-col gap-4" : "contents"}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Add title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              readOnly={readOnly}
              className={readOnly ? "cursor-default select-text" : ""}
            />
          </div>

          {/* Artist — hidden entirely when empty in read-only mode */}
          {(!readOnly || artist) && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="artist">Artist 演出者</Label>
              <Input
                id="artist"
                placeholder="e.g. Bruno Mars (optional)"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                readOnly={readOnly}
                className={readOnly ? "cursor-default select-text" : ""}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id="allDay"
              checked={allDay}
              disabled={readOnly}
              onCheckedChange={toggleAllDay}
            />
            <Label htmlFor="allDay">All day</Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="start">Start</Label>
              <Input
                id="start"
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? startTime.slice(0, 10) : startTime}
                onChange={(e) => setStartTime(e.target.value)}
                readOnly={readOnly}
                className={readOnly ? "cursor-default" : ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="end">End</Label>
              <Input
                id="end"
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? endTime.slice(0, 10) : endTime}
                onChange={(e) => setEndTime(e.target.value)}
                readOnly={readOnly}
                className={readOnly ? "cursor-default" : ""}
              />
            </div>
          </div>

          {hasInvalidDateRange && (
            <div className="-mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-destructive">
                End must be the same as or after the start.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 shrink-0 px-2 text-xs"
                onClick={swapStartEnd}
              >
                Swap
              </Button>
            </div>
          )}

          {!allDay && userTimezone && (
            <p className="text-xs text-muted-foreground -mt-2">
              Times in your local timezone ({userTimezone.replace(/_/g, " ")})
            </p>
          )}
          {venueTimeInfo?.secondaryTime && (
            <p className="text-xs text-muted-foreground -mt-2">
              {venueTimeInfo.secondaryTime} local time at venue
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="calendar">Calendar</Label>
            <Select value={calendarId} onValueChange={(v) => { if (v) setCalendarId(v); }}>
              <SelectTrigger>
                {(() => {
                  const selected = calendars.find((c) => c.id === calendarId);
                  return selected ? (
                    <div className="flex items-center gap-2">
                      <div
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: selected.color }}
                      />
                      <span>{selected.name}</span>
                    </div>
                  ) : (
                    <SelectValue placeholder="Select calendar" />
                  );
                })()}
              </SelectTrigger>
              <SelectContent>
                {calendars.map((cal) => (
                  <SelectItem key={cal.id} value={cal.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="size-2 rounded-full"
                        style={{ backgroundColor: cal.color }}
                      />
                      {cal.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={category ?? ""}
              onValueChange={(v) => setCategory((v || null) as EventCategory | null)}
              disabled={readOnly}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="Select category…">
                  {category ? CATEGORY_LABELS[category] : "Select category…"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None —</SelectItem>
                {EVENT_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="location">Location</Label>
              {(() => {
                if (!location) return null;
                // Show country badge if the location starts with a known country tag
                // (added by Tag Location) or contains common HK identifiers
                const knownCountries = [
                  "Hong Kong", "Japan", "South Korea", "Taiwan", "Singapore",
                  "Thailand", "Macau", "China", "United Kingdom", "United States",
                  "Australia", "Canada", "Malaysia", "Philippines", "Indonesia",
                  "France", "Germany",
                ];
                const matched = knownCountries.find((c) => location.startsWith(c + ",") || location.startsWith(c + " "));
                // Fallback: detect HK/Japan from raw text for untagged events
                const rawHk = !matched && (location.includes("香港") || location.toLowerCase().includes("hong kong"));
                const rawJp = !matched && !rawHk && /東京|大阪|Japan/i.test(location);
                const rawKr = !matched && !rawHk && !rawJp && /首爾|Seoul|Korea/i.test(location);
                const label = matched ?? (rawHk ? "Hong Kong" : rawJp ? "Japan" : rawKr ? "South Korea" : null);
                if (!label) return null;
                return <span className="text-[10px] bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 leading-none">{label}</span>;
              })()}
            </div>
            <Input
              id="location"
              placeholder="Add location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              readOnly={readOnly}
              className={readOnly ? "cursor-default select-text" : ""}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            {/* Related events — shown above description when a Ticket URL links multiple events */}
            {relatedEvents.length > 0 && (
              <div className="flex flex-col gap-1 bg-muted/40 rounded-md px-2.5 py-2 -mt-0.5 border border-border/50">
                <p className="text-xs text-muted-foreground font-medium">Related Events 相關活動</p>
                {relatedEvents.map((re) => (
                  <button
                    key={re.id}
                    type="button"
                    onClick={() => { onOpenChange(false); onEventSelect?.(re.id, re.startTime); }}
                    className="flex items-center gap-2 text-sm text-left hover:bg-muted/60 rounded px-1.5 py-1 transition-colors -mx-1 group"
                  >
                    <div className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: re.calendarColor }} />
                    <span className="truncate flex-1">{re.title}</span>
                    <span className="text-muted-foreground text-xs shrink-0 tabular-nums">
                      {new Date(re.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <ArrowRight className="size-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}
            <Textarea
              id="description"
              placeholder="Add description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              readOnly={readOnly}
              className={`resize-none${readOnly ? " cursor-default select-text" : ""}`}
            />
          </div>

          {/* Ticket URLs — all "Ticket URL: <url>" lines shown as clickable links */}
          {(() => {
            const ticketUrls = [...description.matchAll(/^Ticket URL: (https?:\/\/\S+)/gm)].map((m) => m[1]);
            if (!ticketUrls.length) return null;
            return (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Ticket Link 購票連結</Label>
                {ticketUrls.map((ticketUrl, i) => (
                  <a
                    key={i}
                    href={ticketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={ticketUrl}
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline min-w-0"
                  >
                    <ExternalLink className="size-3.5 shrink-0" />
                    <span className="truncate">{ticketUrl}</span>
                  </a>
                ))}
              </div>
            );
          })()}

          {/* Additional info / reference URL — later-announced page (e.g. per-station
              ticketing); Sync scrapes this instead of the Ticket URL when filled in */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reference-url" className="text-xs text-muted-foreground">
              Additional Info / Reference 補充連結
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="reference-url"
                type="url"
                placeholder="Paste URL for ticket-sale updates (used by Sync)…"
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                readOnly={readOnly}
                className={`h-8 text-sm${readOnly ? " cursor-default select-text" : ""}`}
              />
              {referenceUrl.trim().startsWith("http") && (
                <a
                  href={referenceUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open reference URL"
                  className="text-primary hover:text-primary/80 shrink-0"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </div>
          </div>

          {/* Seating plan — URL input + clickable image preview + drag-drop */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <ImageIcon className="size-3" />
              Seating Plan 座位圖
            </Label>
            {seatingPlanUrl ? (
              <div
                className={`relative rounded-md overflow-hidden border border-border cursor-pointer group transition-colors${seatingDragOver ? " ring-2 ring-primary border-primary" : ""}`}
                onDragOver={(ev) => { ev.preventDefault(); setSeatingDragOver(true); }}
                onDragLeave={() => setSeatingDragOver(false)}
                onDrop={(ev) => {
                  ev.preventDefault();
                  setSeatingDragOver(false);
                  const dropped = ev.dataTransfer.getData("text/uri-list") || ev.dataTransfer.getData("text/plain");
                  if (dropped?.startsWith("http")) setSeatingPlanUrl(dropped.trim());
                }}
              >
                <a href={seatingPlanUrl} target="_blank" rel="noopener noreferrer" title="Open seating plan">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={seatingPlanUrl}
                    alt="Seating plan"
                    className="w-full max-h-48 object-contain bg-muted/30"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <ExternalLink className="size-5 text-white opacity-0 group-hover:opacity-100 drop-shadow transition-opacity" />
                  </div>
                </a>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setSeatingPlanUrl("")}
                    className="absolute top-1.5 right-1.5 size-5 rounded bg-black/50 hover:bg-black/70 flex items-center justify-center text-white text-xs transition-colors"
                    title="Remove seating plan"
                  >✕</button>
                )}
              </div>
            ) : null}
            {!readOnly && (
              <div
                className={`flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-1.5 transition-colors${seatingDragOver ? " ring-2 ring-primary border-primary" : ""}`}
                onDragOver={(ev) => { ev.preventDefault(); setSeatingDragOver(true); }}
                onDragLeave={() => setSeatingDragOver(false)}
                onDrop={(ev) => {
                  ev.preventDefault();
                  setSeatingDragOver(false);
                  const dropped = ev.dataTransfer.getData("text/uri-list") || ev.dataTransfer.getData("text/plain");
                  if (dropped?.startsWith("http")) setSeatingPlanUrl(dropped.trim());
                }}
              >
                <input
                  ref={seatingInputRef}
                  type="url"
                  placeholder="Paste image URL or drag from browser…"
                  value={seatingPlanUrl}
                  onChange={(e) => setSeatingPlanUrl(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 min-w-0"
                />
              </div>
            )}
            {readOnly && !seatingPlanUrl && (
              <p className="text-xs text-muted-foreground/60">No seating plan attached</p>
            )}
          </div>

          {/* Seat — manual entry off the buyer's printed/e-ticket, e.g. "Gate F
              Level 2 Block 225 Row BB Seat 101". Deliberately manual: scraped
              sale pages never contain a buyer's specific seat, so this never
              touches the scrape pipeline. Stored as a "Seat: <raw>" line inside
              description via applySeat (mirrors Seating Plan above); parsed
              client-side on every keystroke for the live breakdown below. */}
          {(!readOnly || seat) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="seat" className="text-xs text-muted-foreground">
                Seat 座位
              </Label>
              <Input
                id="seat"
                placeholder="Paste seat line from e-ticket, e.g. Gate F Level 2 Block 225 Row BB Seat 101"
                value={seat}
                onChange={(e) => setSeat(e.target.value)}
                readOnly={readOnly}
                className={`h-8 text-sm${readOnly ? " cursor-default select-text" : ""}`}
              />
              {seatParseResult && <SeatBreakdown result={seatParseResult} />}
              {seatParseResult && seatParseResult.status !== "unparseable" && seatParseResult.additionalSeatsDetected > 0 && (
                <p className="text-xs text-muted-foreground">
                  {seatParseResult.additionalSeatsDetected} more ticket{seatParseResult.additionalSeatsDetected === 1 ? "" : "s"} found in this line — showing the first
                </p>
              )}
              {/* 2D/3D toggle only once we know the venue has a seat-map config at all —
                  hidden for unmatched venues so there's nothing to switch between. Defaults
                  to 2D; falls back to 2D automatically if the 3D view reports itself
                  unavailable (e.g. no WebGL on this device). */}
              {seatParseResult && hasSeatMapConfig && (
                <div className="flex gap-1 mb-1">
                  <Button
                    type="button"
                    size="xs"
                    variant={seatMapView === "2d" ? "secondary" : "ghost"}
                    onClick={() => setSeatMapView("2d")}
                  >
                    2D
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={seatMapView === "3d" ? "secondary" : "ghost"}
                    onClick={() => setSeatMapView("3d")}
                  >
                    3D
                  </Button>
                </div>
              )}
              {/* Renders nothing unless the venue has a seat-map config AND the
                  block resolves — an unknown venue deliberately shows no map
                  rather than a generic bowl with a guessed marker. */}
              {seatParseResult && (seatMapView === "2d" || !hasSeatMapConfig) && (
                <SeatMap venue={location} seat={seatParseResult} config={matchedSeatMapConfig} />
              )}
              {seatParseResult && hasSeatMapConfig && seatMapView === "3d" && (
                <SeatMap3D
                  venue={location}
                  seat={seatParseResult}
                  config={matchedSeatMapConfig}
                  onUnavailable={() => setSeatMapView("2d")}
                />
              )}
            </div>
          )}
          </div>{/* end dimmed wrapper */}
        </form>

        {/* Sticky footer — always visible regardless of scroll position */}
        <div className="flex flex-col gap-2 pt-3 border-t shrink-0">
          {syncTeamsError && (
            <p className={`text-xs rounded px-2 py-1 ${syncTeamsError.startsWith("✓") ? "text-green-600 bg-green-500/10" : "text-destructive bg-destructive/10"}`}>{syncTeamsError}</p>
          )}
          {syncError && (
            <p className={`text-xs rounded px-2 py-1 ${syncError.startsWith("✓") ? "text-green-600 bg-green-500/10" : "text-destructive bg-destructive/10"}`}>{syncError}</p>
          )}
          {/* Sync diff preview */}
          {syncPreview && (
            <div className="rounded-md border border-border text-xs overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 font-medium flex items-center justify-between">
                <span>{syncPreview.changes.length} change{syncPreview.changes.length > 1 ? "s" : ""} detected</span>
                <button onClick={() => setSyncPreview(null)} className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <div className="divide-y divide-border">
                {syncPreview.changes.map((c) => (
                  <div key={c.field} className="px-3 py-2 grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-0.5">{c.label}</p>
                      <p className="line-through text-muted-foreground">{c.oldValue ?? "—"}</p>
                    </div>
                    <ArrowRight className="size-3 text-muted-foreground mt-4 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-0.5">&nbsp;</p>
                      <p className="text-foreground font-medium">{c.newValue ?? "—"}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-3 py-2 border-t bg-muted/30 flex gap-2">
                <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleApplySync} disabled={syncing}>
                  {syncing ? "Applying…" : "Apply All Changes"}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSyncPreview(null)}>Dismiss</Button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {event && !readOnly && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmKind("delete")}
                disabled={saving || syncing}
              >
                <Trash2 className="size-4 mr-1" />
                Delete
              </Button>
            )}
            {event && !readOnly && onCopy && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onCopy({
                    title,
                    description: description || undefined,
                    location: location || undefined,
                    startTime: new Date(startTime).toISOString(),
                    endTime: new Date(endTime).toISOString(),
                    allDay,
                    calendarId,
                    category: category ?? null,
                    artist: artist.trim() || null,
                    referenceUrl: referenceUrl.trim() || null,
                  })
                }
                disabled={saving || syncing}
              >
                <Copy className="size-4 mr-1" />
                Copy
              </Button>
            )}
            {/* Update Teams button — only shown for World Cup knockout events */}
            {event && !readOnly && event.description?.includes("World Cup Match ID:") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSyncTeams}
                disabled={saving || syncing || syncingTeams}
                title="Fetch current team names from Wikipedia and update event"
              >
                <RefreshCw className={`size-4 mr-1 ${syncingTeams ? "animate-spin" : ""}`} />
                {syncingTeams ? "更新中…" : "更新球隊"}
              </Button>
            )}
            {/* Sync button — shown when event has a Ticket URL or a reference URL and user can edit */}
            {event && !readOnly && (event.description?.includes("Ticket URL:") || Boolean(referenceUrl.trim() || event.referenceUrl)) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={saving || syncing || syncingTeams}
                title="Re-scrape ticket URL and update event data"
              >
                <RefreshCw className={`size-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync"}
              </Button>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={requestClose}
            >
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button
                type="submit"
                form="event-modal-form"
                disabled={saving || syncing || !title.trim() || hasInvalidDateRange}
              >
                {saving ? "Saving..." : event ? "Update" : "Create"}
              </Button>
            )}
          </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Delete confirmation — Delete no longer fires the DELETE request directly */}
    <AlertDialog
      open={confirmKind === "delete"}
      onOpenChange={(next) => { if (!next) setConfirmKind(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this event?</AlertDialogTitle>
          <AlertDialogDescription>
            {title ? `“${title}” will be deleted.` : "This event will be deleted."} You can undo this right after.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Unsaved-changes guard — Escape, backdrop click, and Cancel all route here via requestClose */}
    <AlertDialog
      open={confirmKind === "discard"}
      onOpenChange={(next) => { if (!next) setConfirmKind(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes to this event. Closing now will discard them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => onOpenChange(false)}>
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
