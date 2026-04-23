"use client";

import { useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import Link from "next/link";
import type { CalendarType } from "@/types";

interface CalendarSidebarProps {
  calendars: CalendarType[];
  onCalendarToggle: (id: string, visible: boolean) => void;
  onAddCalendar: () => void;
}

export function CalendarSidebar({
  calendars,
  onCalendarToggle,
  onAddCalendar,
}: CalendarSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Mini calendar state
  const [miniDate, setMiniDate] = useState(new Date());
  const year = miniDate.getFullYear();
  const month = miniDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const monthName = miniDate.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () => setMiniDate(new Date(year, month - 1, 1));
  const nextMonth = () => setMiniDate(new Date(year, month + 1, 1));

  if (collapsed) {
    return (
      <div className="w-12 border-r border-border bg-card flex flex-col items-center pt-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(false)}
          className="size-8"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="w-64 border-r border-border bg-card flex flex-col">
      {/* Collapse button */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-sm font-semibold">Calendars</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(true)}
          className="size-6"
        >
          <ChevronLeft className="size-4" />
        </Button>
      </div>

      {/* Mini Calendar */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <Button variant="ghost" size="icon" onClick={prevMonth} className="size-6">
            <ChevronLeft className="size-3" />
          </Button>
          <span className="text-xs font-medium">{monthName}</span>
          <Button variant="ghost" size="icon" onClick={nextMonth} className="size-6">
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
              day === today.getDate() &&
              month === today.getMonth() &&
              year === today.getFullYear();
            return (
              <div
                key={day}
                className={`text-[11px] py-0.5 rounded-full ${
                  isToday
                    ? "bg-primary text-primary-foreground font-bold"
                    : "hover:bg-accent cursor-pointer"
                }`}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>

      {/* Calendar list */}
      <div className="flex-1 overflow-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            My Calendars
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={onAddCalendar}
            className="size-6"
          >
            <Plus className="size-3" />
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          {calendars.map((cal) => (
            <div
              key={cal.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent group"
            >
              <div
                className="size-3 rounded-sm shrink-0"
                style={{ backgroundColor: cal.color }}
              />
              <span className="text-sm flex-1 truncate">{cal.name}</span>
              {cal.googleCalendarId && (
                <span className="text-[10px] text-muted-foreground">G</span>
              )}
              <Switch
                checked={cal.isVisible}
                onCheckedChange={(checked) =>
                  onCalendarToggle(cal.id, checked)
                }
                className="scale-75"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Settings link */}
      <div className="p-3 border-t border-border">
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
            <Settings className="size-4" />
            Settings
          </Button>
        </Link>
      </div>
    </div>
  );
}
