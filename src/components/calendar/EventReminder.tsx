"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Bell, MapPin, Clock } from "lucide-react";
import type { CalendarType, EventType } from "@/types";
import { getReminderLeadMinutes } from "@/lib/reminder-prefs";
import { hasFired, markFired, onFiredElsewhere } from "@/lib/reminder-fired-store";

interface ReminderToast {
  id: string; // event id + trigger key
  event: EventType;
  calendar: CalendarType | undefined;
  kind: "soon" | "now"; // ≤lead-time away | just started
  minutesLeft: number;
}

interface EventReminderProps {
  events: EventType[];
  calendars: CalendarType[];
}

function fmtTime(iso: string) {
  // Explicit locale — keeps times consistent with the rest of the (English) UI
  // regardless of the OS/browser locale.
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function EventReminder({ events, calendars }: EventReminderProps) {
  const [toasts, setToasts] = useState<ReminderToast[]>([]);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const notifPermission = useRef<NotificationPermission>("default");

  // Request browser notification permission once
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    notifPermission.current = Notification.permission;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        notifPermission.current = p;
      });
    }
  }, []);

  // Cross-tab coordination: if another tab fires the same reminder key
  // (e.g. both tabs' polls raced the same 30s tick), drop any toast we
  // already queued for it here rather than leaving duplicates shown.
  useEffect(() => {
    return onFiredElsewhere((key) => {
      setToasts((prev) => prev.filter((t) => t.id !== key));
    });
  }, []);

  const dismiss = useCallback((toastId: string) => {
    setExiting((prev) => new Set([...prev, toastId]));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
      setExiting((prev) => {
        const next = new Set(prev);
        next.delete(toastId);
        return next;
      });
    }, 350); // matches exit animation duration
  }, []);

  // Check upcoming events every 30 seconds
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const soonMinutes = getReminderLeadMinutes(); // re-read each tick so a preference change (this or another tab) takes effect on the next poll
      const newToasts: ReminderToast[] = [];

      for (const event of events) {
        if (event.allDay) continue;
        const start = new Date(event.startTime).getTime();
        const diffMs = start - now;
        const diffMin = diffMs / 60000;
        const cal = calendars.find((c) => c.id === event.calendarId);

        // "starting soon" — between 0 and soonMinutes minutes away
        const soonKey = `${event.id}:soon`;
        if (diffMin > 0 && diffMin <= soonMinutes && !hasFired(soonKey)) {
          markFired(soonKey, start);
          newToasts.push({
            id: soonKey,
            event,
            calendar: cal,
            kind: "soon",
            minutesLeft: Math.ceil(diffMin),
          });
          // Browser notification
          if (notifPermission.current === "granted") {
            new Notification(`Starting in ${Math.ceil(diffMin)} min: ${event.title}`, {
              body: event.location ? `📍 ${event.location}` : fmtTime(event.startTime),
              icon: "/favicon.ico",
              tag: soonKey,
            });
          }
        }

        // "just started" — within 1 minute past start
        const nowKey = `${event.id}:now`;
        if (diffMs <= 0 && diffMs > -60000 && !hasFired(nowKey)) {
          markFired(nowKey, start);
          newToasts.push({
            id: nowKey,
            event,
            calendar: cal,
            kind: "now",
            minutesLeft: 0,
          });
          if (notifPermission.current === "granted") {
            new Notification(`Starting now: ${event.title}`, {
              body: event.location ? `📍 ${event.location}` : fmtTime(event.startTime),
              icon: "/favicon.ico",
              tag: nowKey,
            });
          }
        }
      }

      if (newToasts.length > 0) {
        setToasts((prev) => [...newToasts, ...prev].slice(0, 5)); // cap at 5
      }
    };

    check(); // run immediately
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [events, calendars]);

  // Auto-dismiss after 12 seconds
  useEffect(() => {
    for (const t of toasts) {
      const timer = setTimeout(() => dismiss(t.id), 12_000);
      return () => clearTimeout(timer);
    }
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => {
        const isExiting = exiting.has(t.id);
        const color = t.calendar?.color ?? "#4285f4";
        return (
          <div
            key={t.id}
            className="pointer-events-auto"
            style={{
              animation: isExiting
                ? "reminderExit 0.35s ease forwards"
                : "reminderEnter 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
            }}
          >
            <div
              className="relative flex items-start gap-3 rounded-xl border bg-popover text-popover-foreground shadow-lg px-4 py-3 w-80 max-w-[calc(100vw-3rem)] overflow-hidden"
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}
            >
              {/* Animated progress bar */}
              <div
                className="absolute bottom-0 left-0 h-0.5 rounded-full"
                style={{
                  backgroundColor: color,
                  animation: "reminderBar 12s linear forwards",
                  width: "100%",
                  transformOrigin: "left",
                }}
              />

              {/* Icon */}
              <div
                className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${color}22` }}
              >
                <Bell className="size-4" style={{ color }} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: `${color}22`, color }}
                  >
                    {t.kind === "now" ? "Starting now" : `In ${t.minutesLeft} min`}
                  </span>
                </div>
                <p className="text-sm font-semibold truncate leading-snug">{t.event.title}</p>
                <div className="flex flex-col gap-0.5 mt-1">
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="size-3" />
                    {fmtTime(t.event.startTime)} – {fmtTime(t.event.endTime)}
                  </span>
                  {t.event.location && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                      <MapPin className="size-3 shrink-0" />
                      {t.event.location}
                    </span>
                  )}
                </div>
              </div>

              {/* Dismiss */}
              <button
                onClick={() => dismiss(t.id)}
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
