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
import { Trash2 } from "lucide-react";
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{event ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Add title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="allDay"
              checked={allDay}
              onCheckedChange={setAllDay}
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
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="end">End</Label>
              <Input
                id="end"
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? endTime.slice(0, 10) : endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="calendar">Calendar</Label>
            <Select value={calendarId} onValueChange={(v) => { if (v) setCalendarId(v); }}>
              <SelectTrigger>
                <SelectValue />
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
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            {event && (
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
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !title.trim()}>
                {saving ? "Saving..." : event ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
