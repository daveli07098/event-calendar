"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GoogleCalendarImport } from "@/components/settings/GoogleCalendarImport";
import { ICSImport } from "@/components/settings/ICSImport";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { ArrowLeft, Trash2, Share2, LogOut } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ShareCalendarDialog } from "@/components/calendar/ShareCalendarDialog";
import type { CalendarType } from "@/types";

const PRESET_COLORS = [
  "#4285f4", "#0f9d58", "#db4437", "#f4b400",
  "#7c4dff", "#00acc1", "#e67c73", "#33b679",
  "#ff7043", "#8d6e63", "#546e7a", "#ec407a",
];

interface SettingsClientProps {
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function SettingsClient({ user }: SettingsClientProps) {
  const [calendars, setCalendars] = useState<CalendarType[]>([]);

  const fetchCalendars = async () => {
    const res = await fetch("/api/calendars");
    if (res.ok) {
      setCalendars(await res.json());
    }
  };

  useEffect(() => {
    fetchCalendars();
  }, []);

  const deleteCalendar = async (id: string) => {
    if (!confirm("Delete this calendar and all its events?")) return;
    const res = await fetch(`/api/calendars/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCalendars((prev) => prev.filter((c) => c.id !== id));
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete");
    }
  };

  const updateCalendar = async (id: string, name: string) => {
    await fetch(`/api/calendars/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    fetchCalendars();
  };

  const updateCalendarColor = async (id: string, color: string) => {
    const res = await fetch(`/api/calendars/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
    if (res.ok) {
      setCalendars((prev) =>
        prev.map((c) => (c.id === id ? { ...c, color } : c))
      );
    }
  };

  const [openColorPicker, setOpenColorPicker] = useState<string | null>(null);
  const [shareCalendar, setShareCalendar] = useState<CalendarType | null>(null);

  const leaveCalendar = async (id: string) => {
    if (!confirm("Leave this calendar? You will lose access to its events.")) return;
    await fetch(`/api/calendars/${id}`, { method: "DELETE" });
    setCalendars((prev) => prev.filter((c) => c.id !== id));
  };

  // Split owned vs joined
  const ownedCalendars = calendars.filter((c) => !c.memberRole);
  const joinedCalendars = calendars.filter((c) => c.memberRole);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl p-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        {/* Account */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={user.image || undefined} />
                  <AvatarFallback>
                    {user.name?.[0]?.toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Owned Calendars */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>My Calendars</CardTitle>
            <CardDescription>Manage and share your calendars</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {ownedCalendars.map((cal) => (
                <div key={cal.id} className="flex items-center gap-3">
                  {/* Color picker */}
                  <Popover
                    open={openColorPicker === cal.id}
                    onOpenChange={(open) =>
                      setOpenColorPicker(open ? cal.id : null)
                    }
                  >
                    <PopoverTrigger
                      className="size-6 rounded-full border-2 border-transparent hover:border-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                      style={{ backgroundColor: cal.color }}
                      title="Change color"
                    />
                    <PopoverContent side="bottom" align="start" className="w-auto p-3">
                      <div className="grid grid-cols-4 gap-2">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => {
                              updateCalendarColor(cal.id, c);
                              setOpenColorPicker(null);
                            }}
                            style={{ backgroundColor: c }}
                            className={`size-7 rounded-full border-2 transition-transform hover:scale-110 ${
                              cal.color === c ? "border-foreground scale-110" : "border-transparent"
                            }`}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Input
                    defaultValue={cal.name}
                    className="flex-1"
                    onBlur={(e) => {
                      if (e.target.value !== cal.name) updateCalendar(cal.id, e.target.value);
                    }}
                  />

                  {cal.googleCalendarId && (
                    <span className="text-xs text-muted-foreground px-1">G</span>
                  )}

                  {/* Share badge */}
                  {cal.shareMode && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">
                      {cal.shareMode === "collaborative" ? "Collab" : "Broadcast"}
                    </span>
                  )}

                  {/* Share button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShareCalendar(cal)}
                    className="size-8"
                    title="Share"
                  >
                    <Share2 className="size-4" />
                  </Button>

                  {!cal.isDefault && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteCalendar(cal.id)}
                      className="size-8 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Joined / Shared-with-me Calendars */}
        {joinedCalendars.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Shared with me</CardTitle>
              <CardDescription>Calendars you have joined</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {joinedCalendars.map((cal) => (
                  <div key={cal.id} className="flex items-center gap-3">
                    <div
                      className="size-6 rounded-full shrink-0"
                      style={{ backgroundColor: cal.color }}
                    />
                    <span className="flex-1 text-sm truncate">{cal.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                      {cal.memberRole}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => leaveCalendar(cal.id)}
                      className="size-8 text-muted-foreground hover:text-destructive"
                      title="Leave calendar"
                    >
                      <LogOut className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Share Dialog */}
        <ShareCalendarDialog
          calendar={shareCalendar}
          open={shareCalendar !== null}
          onOpenChange={(open) => { if (!open) setShareCalendar(null); }}
          onUpdated={() => {
            fetchCalendars();
            // Keep dialog open but refresh calendar data
            if (shareCalendar) {
              fetch("/api/calendars")
                .then((r) => r.json())
                .then((data: CalendarType[]) => {
                  const updated = data.find((c) => c.id === shareCalendar.id);
                  if (updated) setShareCalendar(updated);
                });
            }
          }}
        />

        {/* Appearance */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Customize the look and feel of your calendar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AppearanceSettings />
          </CardContent>
        </Card>

        {/* Google Calendar Import */}
        <Card>
          <CardHeader>
            <CardTitle>Google Calendar Import</CardTitle>
            <CardDescription>
              Import events from your connected Google account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoogleCalendarImport onImported={fetchCalendars} />
            <Separator className="my-4" />
            <p className="text-xs text-muted-foreground">
              Your Google account is connected via the sign-in you used. Events
              are imported as read-only copies.
            </p>
          </CardContent>
        </Card>

        {/* ICS File Import */}
        <Card>
          <CardHeader>
            <CardTitle>Import from ICS File</CardTitle>
            <CardDescription>
              Import events from a .ics / iCalendar export file
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ICSImport onImported={fetchCalendars} />
            <Separator className="my-4" />
            <p className="text-xs text-muted-foreground">
              Supports standard iCalendar (.ics) files exported from Google
              Calendar, Apple Calendar, Outlook, and others.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
