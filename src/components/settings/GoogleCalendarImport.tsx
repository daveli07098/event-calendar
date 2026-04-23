"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2 } from "lucide-react";

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
  );
}
