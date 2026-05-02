"use client";

import { useState, useEffect } from "react";
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
import { Trash2, ExternalLink } from "lucide-react";
import type { CalendarType, EventType, EventFormData } from "@/types";

interface EventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventType | null;
  calendars: CalendarType[];
  defaultCalendarId: string;
  initialRange: { start: string; end: string; allDay: boolean } | null;
  onSave: (data: EventFormData) => Promise<void>;
  onDelete: () => Promise<void>;
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
  onSave,
  onDelete,
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

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setDescription(event.description || "");
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
    } else if (initialRange) {
      setTitle("");
      setDescription("");
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
      setLocation("");
      setAllDay(false);
      setCalendarId(defaultCalendarId);
      const now = new Date();
      setStartTime(toLocalDateTimeString(now.toISOString()));
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
      setEndTime(toLocalDateTimeString(oneHourLater.toISOString()));
    }
  }, [event, initialRange, defaultCalendarId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description || undefined,
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
            <Label htmlFor="location">Location</Label>
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

          {/* Ticket URL — parsed from description; shown as a clickable link when present */}
          {(() => {
            const ticketUrl = description.match(/Ticket URL: (https?:\/\/[^\s]+)/)?.[1];
            return ticketUrl ? (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Ticket Link 購票連結</Label>
                <a
                  href={ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={ticketUrl}
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline min-w-0"
                >
                  <ExternalLink className="size-3.5 shrink-0" />
                  <span className="truncate">{ticketUrl}</span>
                </a>
              </div>
            ) : null;
          })()}
          </div>{/* end dimmed wrapper */}
        </form>

        {/* Sticky footer — always visible regardless of scroll position */}
        <div className="flex items-center justify-between pt-3 border-t shrink-0">
          {event && !readOnly && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={saving}
            >
              <Trash2 className="size-4 mr-1" />
              Delete
            </Button>
          )}
          <div className="flex items-center gap-2 ml-auto">
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
                disabled={saving || !title.trim()}
              >
                {saving ? "Saving..." : event ? "Update" : "Create"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
