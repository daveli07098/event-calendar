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
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { CalendarType } from "@/types";

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

        {/* Calendars */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Calendars</CardTitle>
            <CardDescription>Manage your calendars</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {calendars.map((cal) => (
                <div key={cal.id} className="flex items-center gap-3">
                  <div
                    className="size-4 rounded-sm shrink-0"
                    style={{ backgroundColor: cal.color }}
                  />
                  <Input
                    defaultValue={cal.name}
                    className="flex-1"
                    onBlur={(e) => {
                      if (e.target.value !== cal.name) {
                        updateCalendar(cal.id, e.target.value);
                      }
                    }}
                  />
                  {cal.googleCalendarId && (
                    <span className="text-xs text-muted-foreground px-2">Google</span>
                  )}
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
      </div>
    </div>
  );
}
