"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Trash2, ExternalLink, Copy, ArrowRight, RefreshCw, Image as ImageIcon } from "lucide-react";
import type { CalendarType, EventType, EventFormData } from "@/types";

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
  initialRange: { start: string; end: string; allDay: boolean } | null;
  initialData?: Partial<EventFormData>;
  onSave: (data: EventFormData) => Promise<void>;
  onDelete: () => Promise<void>;
  onCopy?: (data: EventFormData) => void;
  /** Called after a successful Sync so CalendarView can refresh the updated event */
  onSynced?: (updatedEvent: EventType) => void;
  onEventSelect?: (eventId: string, startTime: string) => void;
  readOnly?: boolean;
}

function toLocalDateTimeString(dateStr: string) {
  const d = new Date(dateStr);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function toLocalDateString(dateStr: string) {
  const d = new Date(dateStr);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
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
}: EventModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [calendarId, setCalendarId] = useState(defaultCalendarId);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [relatedEvents, setRelatedEvents] = useState<RelatedEvent[]>([]);
  const [seatingPlanUrl, setSeatingPlanUrl] = useState("");
  const [seatingDragOver, setSeatingDragOver] = useState(false);
  const seatingInputRef = useRef<HTMLInputElement>(null);
  /** Holds scrape + diff result to show a preview before applying */
  const [syncPreview, setSyncPreview] = useState<{
    changes: Array<{ field: string; label: string; oldValue: string | null; newValue: string | null }>;
    ticket: Record<string, unknown>;
    diffResult: { eventId: string | null; saleEventIds: Record<string, string>; saleEventId: string | null; presaleEventId: string | null };
  } | null>(null);

  // Helper: extract seating plan URL from description text
  const parseSeatingPlan = (desc: string) =>
    desc.match(/^Seating Plan: (https?:\/\/[^\s]+)/m)?.[1] ?? "";

  // Helper: update description to include/replace seating plan URL line
  const applySeatingPlan = (desc: string, url: string): string => {
    const line = url.trim() ? `Seating Plan: ${url.trim()}` : null;
    const replaced = desc.replace(/^Seating Plan: https?:\/\/[^\n]*/m, line ?? "").replace(/\n{3,}/g, "\n\n");
    if (line && !replaced.includes("Seating Plan:")) {
      return replaced.trimEnd() + (replaced ? "\n\n" : "") + line;
    }
    return replaced;
  };

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setDescription(event.description || "");
      setSeatingPlanUrl(parseSeatingPlan(event.description || ""));
      setLocation(event.location || "");
      setAllDay(event.allDay);
      setCalendarId(event.calendarId);
      if (event.allDay) {
        setStartTime(toLocalDateString(event.startTime));
        setEndTime(toLocalDateString(event.endTime));
      } else {
        setStartTime(toLocalDateTimeString(event.startTime));
        setEndTime(toLocalDateTimeString(event.endTime));
      }
    } else if (initialData) {
      setTitle(initialData.title ?? "");
      setDescription(initialData.description ?? "");
      setSeatingPlanUrl(parseSeatingPlan(initialData.description ?? ""));
      setLocation(initialData.location ?? "");
      setAllDay(initialData.allDay ?? false);
      setCalendarId(initialData.calendarId ?? defaultCalendarId);
      if (initialData.startTime) {
        setStartTime(initialData.allDay
          ? toLocalDateString(initialData.startTime)
          : toLocalDateTimeString(initialData.startTime));
      }
      if (initialData.endTime) {
        setEndTime(initialData.allDay
          ? toLocalDateString(initialData.endTime)
          : toLocalDateTimeString(initialData.endTime));
      }
    } else if (initialRange) {
      setTitle("");
      setDescription("");
      setSeatingPlanUrl("");
      setLocation("");
      setAllDay(initialRange.allDay);
      setCalendarId(defaultCalendarId);
      if (initialRange.allDay) {
        setStartTime(toLocalDateString(initialRange.start));
        setEndTime(toLocalDateString(initialRange.end));
      } else {
        setStartTime(toLocalDateTimeString(initialRange.start));
        setEndTime(toLocalDateTimeString(initialRange.end));
      }
    } else {
      setTitle("");
      setDescription("");
      setSeatingPlanUrl("");
      setLocation("");
      setAllDay(false);
      setCalendarId(defaultCalendarId);
      const now = new Date();
      setStartTime(toLocalDateTimeString(now.toISOString()));
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
      setEndTime(toLocalDateTimeString(oneHourLater.toISOString()));
    }
  }, [event, initialRange, initialData, defaultCalendarId]);

  // Fetch related events (same Ticket URL in description, different calendar)
  useEffect(() => {
    if (!event?.description) { setRelatedEvents([]); return; }
    const ticketUrl = event.description.match(/Ticket URL: (https?:\/\/[^\s]+)/)?.[1];
    if (!ticketUrl) { setRelatedEvents([]); return; }
    fetch(`/api/events/related?url=${encodeURIComponent(ticketUrl)}&excludeId=${event.id}`)
      .then((r) => r.json())
      .then((data) => setRelatedEvents(Array.isArray(data) ? data : []))
      .catch(() => setRelatedEvents([]));
  }, [event?.id, event?.description]);

  // Sync: re-scrape the ticket URL, diff against stored event, show changes before applying
  const handleSync = async () => {
    if (!event) return;
    const ticketUrl = event.description?.match(/Ticket URL: (https?:\/\/[^\s]+)/)?.[1];
    if (!ticketUrl) return;
    setSyncing(true);
    setSyncError(null);
    setSyncPreview(null);
    try {
      // 1. Re-scrape
      const scrapeRes = await fetch("/api/tickets/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ticketUrl }),
      });
      if (!scrapeRes.ok) throw new Error(await scrapeRes.text());
      const ticket = await scrapeRes.json();

      // 2. Diff against existing event
      const diffRes = await fetch("/api/tickets/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ticketUrl, ticket, tzOffsetMinutes: new Date().getTimezoneOffset() }),
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
          tzOffsetMinutes: -new Date().getTimezoneOffset(),
        }),
      });
      if (!applyRes.ok) throw new Error(await applyRes.text());
      const applyData = await applyRes.json();
      const { updatedEvent, createdSaleCount } = applyData;
      setSyncPreview(null);
      if (updatedEvent) {
        setTitle(updatedEvent.title ?? title);
        setDescription(updatedEvent.description ?? description);
        setLocation(updatedEvent.location ?? location);
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
    setSaving(true);
    try {
      // Merge seatingPlanUrl back into description before saving
      const finalDescription = seatingPlanUrl.trim()
        ? applySeatingPlan(description, seatingPlanUrl)
        : description;
      await onSave({
        title: title.trim(),
        description: finalDescription || undefined,
        location: location || undefined,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        allDay,
        calendarId,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{readOnly ? "View Event" : event ? "Edit Event" : "New Event"}</DialogTitle>
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

          <div className="flex items-center gap-2">
            <Switch
              id="allDay"
              checked={allDay}
              disabled={readOnly}
              onCheckedChange={(checked) => {
                setAllDay(checked);
                if (!checked) {
                  // Switching to timed — keep the date but add current time
                  const now = new Date();
                  const dateBase = startTime.slice(0, 10); // "YYYY-MM-DD"
                  const hh = String(now.getHours()).padStart(2, "0");
                  const mm = String(now.getMinutes()).padStart(2, "0");
                  const newStart = `${dateBase}T${hh}:${mm}`;
                  const endBase = endTime.slice(0, 10);
                  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
                  const eh = String(oneHourLater.getHours()).padStart(2, "0");
                  const em = String(oneHourLater.getMinutes()).padStart(2, "0");
                  const newEnd = `${endBase}T${eh}:${em}`;
                  setStartTime(newStart);
                  setEndTime(newEnd);
                } else {
                  // Switching to all-day — strip time
                  setStartTime(startTime.slice(0, 10));
                  setEndTime(endTime.slice(0, 10));
                }
              }}
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

          {!allDay && (
            <p className="text-xs text-muted-foreground -mt-2">
              Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
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
            <div className="flex items-center gap-2">
              <Label htmlFor="location">Location</Label>
              {(() => {
                if (!location) return null;
                if (location.includes("香港") || location.toLowerCase().includes("hong kong")) {
                  return <span className="text-[10px] bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 leading-none">Hong Kong</span>;
                }
                return null;
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
                      {new Date(re.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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
          </div>{/* end dimmed wrapper */}
        </form>

        {/* Sticky footer — always visible regardless of scroll position */}
        <div className="flex flex-col gap-2 pt-3 border-t shrink-0">
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
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {event && !readOnly && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
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
                  })
                }
                disabled={saving || syncing}
              >
                <Copy className="size-4 mr-1" />
                Copy
              </Button>
            )}
            {/* Sync button — only shown when event has a Ticket URL and user can edit */}
            {event && !readOnly && event.description?.includes("Ticket URL:") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={saving || syncing}
                title="Re-scrape ticket URL and update event data"
              >
                <RefreshCw className={`size-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync"}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button
                type="submit"
                form="event-modal-form"
                disabled={saving || syncing || !title.trim()}
              >
                {saving ? "Saving..." : event ? "Update" : "Create"}
              </Button>
            )}
          </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
