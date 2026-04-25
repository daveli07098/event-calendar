"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, Loader2, RefreshCw, Unlink } from "lucide-react";

interface GoogleCalendarImportProps {
  onImported: () => void;
}

interface GoogleCalendarItem {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

export function GoogleCalendarImport({ onImported }: GoogleCalendarImportProps) {
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarItem[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasGoogleLinked, setHasGoogleLinked] = useState<boolean | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  // Check if user has a Google account linked on mount
  useEffect(() => {
    fetch("/api/google/account")
      .then((r) => setHasGoogleLinked(r.ok))
      .catch(() => setHasGoogleLinked(false));
  }, []);

  const unlinkGoogle = async () => {
    if (!confirm("Unlink your Google account? You can reconnect at any time, but synced calendars will stop updating.")) return;
    setUnlinking(true);
    try {
      const res = await fetch("/api/google/account", { method: "DELETE" });
      if (res.ok) {
        setHasGoogleLinked(false);
        setGoogleCalendars([]);
        setError(null);
        onImported(); // refresh calendars (clears G badge)
      } else {
        const data = await res.json();
        alert(data.error || "Failed to unlink");
      }
    } finally {
      setUnlinking(false);
    }
  };

  const fetchGoogleCalendars = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/google/sync");
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to fetch calendars");
        return;
      }
      const data = await res.json();
      setGoogleCalendars(data);
    } catch {
      setError("Failed to connect to Google Calendar");
    } finally {
      setLoading(false);
    }
  };

  const importCalendar = async (googleCal: GoogleCalendarItem) => {
    setImporting(googleCal.id);
    try {
      const res = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleCalendarId: googleCal.id,
          name: googleCal.summary,
          color: googleCal.backgroundColor || "#0f9d58",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Imported ${data.importedEvents} events from ${googleCal.summary}`);
        onImported();
      }
    } catch {
      setError("Failed to import calendar");
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Google Calendar</h3>
          <p className="text-xs text-muted-foreground">
            Import events from your Google Calendar
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchGoogleCalendars}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 mr-1 animate-spin" />
          ) : (
            <Download className="size-4 mr-1" />
          )}
          {googleCalendars.length ? "Refresh" : "Load Calendars"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {googleCalendars.length > 0 && (
        <div className="flex flex-col gap-2 border border-border rounded-lg p-3">
          {googleCalendars.map((cal) => (
            <div
              key={cal.id}
              className="flex items-center justify-between py-1"
            >
              <div className="flex items-center gap-2">
                <div
                  className="size-3 rounded-sm"
                  style={{
                    backgroundColor: cal.backgroundColor || "#4285f4",
                  }}
                />
                <span className="text-sm">{cal.summary}</span>
                {cal.primary && (
                  <Badge variant="secondary" className="text-[10px]">
                    Primary
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => importCalendar(cal)}
                disabled={importing === cal.id}
              >
                {importing === cal.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  "Import"
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>

      {/* Unlink section */}
      {hasGoogleLinked !== null && (
        <>
          <Separator />
          <div className="flex items-center justify-between pt-1">
            {hasGoogleLinked ? (
              <>
                <div>
                  <p className="text-sm font-medium">Google Account linked</p>
                  <p className="text-xs text-muted-foreground">
                    Remove access to stop syncing and importing
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={unlinkGoogle}
                  disabled={unlinking}
                  className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                >
                  {unlinking ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Unlink className="size-3.5 mr-1.5" />
                  )}
                  Unlink Google Account
                </Button>
              </>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium">No Google Account linked</p>
                  <p className="text-xs text-muted-foreground">
                    Connect to import and sync Google Calendar events
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => signIn("google", { callbackUrl: "/settings" })}
                >
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Connect Google Account
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
