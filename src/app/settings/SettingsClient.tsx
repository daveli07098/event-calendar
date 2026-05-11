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
import { ArrowLeft, Trash2, Share2, LogOut, Copy, FileDown, RefreshCw, Tag } from "lucide-react";
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

function ChangePasswordSection() {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (newPassword.length < 8) {
      setMsg({ type: "err", text: "Password must be at least 8 characters." });
      return;
    }
    if (newPassword !== confirm) {
      setMsg({ type: "err", text: "Passwords do not match." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ type: "ok", text: "Password updated." });
        setNewPassword("");
        setConfirm("");
      } else {
        setMsg({ type: "err", text: data.error || "Failed to update password." });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm font-medium">Change Password</p>
      <Input
        type="password"
        placeholder="New password (min 8 chars)"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        autoComplete="new-password"
      />
      <Input
        type="password"
        placeholder="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
      />
      {msg && (
        <p className={`text-sm ${msg.type === "ok" ? "text-green-500" : "text-destructive"}`}>
          {msg.text}
        </p>
      )}
      <Button type="submit" size="sm" disabled={saving} className="self-start">
        {saving ? "Saving…" : "Update Password"}
      </Button>
    </form>
  );
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
  const [syncingCalendarId, setSyncingCalendarId] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<string | null>(null);

  const syncCalendar = async (cal: CalendarType) => {
    setSyncingCalendarId(cal.id);
    try {
      const res = await fetch(`/api/calendars/${cal.id}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert(`Synced ${data.importedEvents} events from Google Calendar.`);
        fetchCalendars();
      } else {
        alert(data.error || "Sync failed");
      }
    } finally {
      setSyncingCalendarId(null);
    }
  };

  const leaveCalendar = async (id: string) => {
    if (!confirm("Leave this calendar? You will lose access to its events.")) return;
    await fetch(`/api/calendars/${id}`, { method: "DELETE" });
    setCalendars((prev) => prev.filter((c) => c.id !== id));
  };

  const duplicateCalendar = async (cal: CalendarType) => {
    const res = await fetch(`/api/calendars/${cal.id}/duplicate`, { method: "POST" });
    if (res.ok) {
      fetchCalendars();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to duplicate");
    }
  };

  const exportCalendar = (cal: CalendarType) => {
    const a = document.createElement("a");
    a.href = `/api/calendars/${cal.id}/export`;
    a.download = `${cal.name}.ics`;
    a.click();
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
            <Separator className="my-4" />
            <ChangePasswordSection />
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => syncCalendar(cal)}
                      disabled={syncingCalendarId === cal.id}
                      className="size-8"
                      title="Sync from Google Calendar"
                    >
                      <RefreshCw
                        className={`size-4 ${
                          syncingCalendarId === cal.id ? "animate-spin" : ""
                        }`}
                      />
                    </Button>
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

                  {/* Duplicate button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => duplicateCalendar(cal)}
                    className="size-8"
                    title="Duplicate calendar"
                  >
                    <Copy className="size-4" />
                  </Button>

                  {/* Export to ICS */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => exportCalendar(cal)}
                    className="size-8"
                    title="Export as .ics (Google Calendar, Apple Calendar, Outlook)"
                  >
                    <FileDown className="size-4" />
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
          </CardContent>
        </Card>

        {/* ICS File Import */}
        <Card className="mb-6">
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

        {/* AI Category Classification */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="size-4" />
              Event Categories
            </CardTitle>
            <CardDescription>
              Use AI to automatically classify all your events into categories (Concert, Exhibition, Theatre, Anime, etc.)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Scans every event and assigns the best-matching category using Gemini AI.
              Events are processed in batches — this may take a few seconds for large calendars.
              Only unclassified events are processed by default.
            </p>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                disabled={classifying}
                onClick={async () => {
                  setClassifying(true);
                  setClassifyResult(null);
                  try {
                    const res = await fetch("/api/events/classify", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ onlyUnclassified: true }),
                    });
                    const data = await res.json();
                    setClassifyResult(data.message ?? "Done.");
                  } catch {
                    setClassifyResult("Classification failed — check your AI quota.");
                  } finally {
                    setClassifying(false);
                  }
                }}
              >
                {classifying ? (
                  <><RefreshCw className="size-3 mr-1 animate-spin" />Classifying…</>
                ) : (
                  <><Tag className="size-3 mr-1" />Classify Unclassified Events</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={classifying}
                onClick={async () => {
                  setClassifying(true);
                  setClassifyResult(null);
                  try {
                    const res = await fetch("/api/events/classify", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ onlyUnclassified: false }),
                    });
                    const data = await res.json();
                    setClassifyResult(data.message ?? "Done.");
                  } catch {
                    setClassifyResult("Classification failed — check your AI quota.");
                  } finally {
                    setClassifying(false);
                  }
                }}
              >
                Re-classify All
              </Button>
            </div>
            {classifyResult && (
              <p className="text-sm text-muted-foreground">{classifyResult}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
