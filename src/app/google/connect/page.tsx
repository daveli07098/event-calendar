"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle2, Loader2, X } from "lucide-react";

interface GoogleCalendarItem {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  primary?: boolean;
}

type Step = "prompt" | "picker" | "syncing" | "done";

export default function GoogleConnectPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("prompt");
  const [calendars, setCalendars] = useState<GoogleCalendarItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [results, setResults] = useState<{ name: string; importedEvents: number }[]>([]);

  // On first mount: if user already has a linked Google account, skip the prompt
  useEffect(() => {
    fetch("/api/google/account")
      .then((r) => {
        if (r.ok) router.replace("/"); // Google already linked — skip connect flow
      })
      .catch(() => { /* non-fatal — show prompt as fallback */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the user's Google calendars when entering picker step
  useEffect(() => {
    if (step !== "picker") return;
    setLoadingCalendars(true);
    fetch("/api/google/sync")
      .then((r) => r.json())
      .then((data: GoogleCalendarItem[]) => {
        setCalendars(data);
        // Pre-select the primary calendar
        const primary = data.find((c) => c.primary);
        if (primary) setSelected(new Set([primary.id]));
      })
      .catch(() => setSyncError("Failed to load your Google calendars."))
      .finally(() => setLoadingCalendars(false));
  }, [step]);

  function toggleCalendar(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSync() {
    setSyncError("");
    setStep("syncing");

    const toSync = calendars
      .filter((c) => selected.has(c.id))
      .map((c) => ({
        googleCalendarId: c.id,
        name: c.summary,
        color: c.backgroundColor || "#0f9d58",
      }));

    try {
      const res = await fetch("/api/google/sync/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendars: toSync }),
      });
      const data = await res.json();
      setResults(data.results || []);
      setStep("done");
    } catch {
      setSyncError("Sync failed — you can try again from Settings.");
      setStep("picker");
    }
  }

  // ── Prompt step ────────────────────────────────────────────────────────────
  if (step === "prompt") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-primary/10">
              <Calendar className="size-7 text-primary" />
            </div>
            <CardTitle className="text-xl">Sync Google Calendar?</CardTitle>
            <CardDescription>
              Would you like to import your Google Calendar events into Event Calendar?
              You can always do this later from Settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button className="w-full" onClick={() => setStep("picker")}>
              Yes, let me choose calendars
            </Button>
            <Button variant="outline" className="w-full" onClick={() => router.push("/")}>
              Skip for now
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Picker step ────────────────────────────────────────────────────────────
  if (step === "picker") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">Choose calendars to sync</CardTitle>
                <CardDescription className="mt-1">
                  Select one or more calendars. Events from the last 3 months and
                  next 6 months will be imported.
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
                <X className="size-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {loadingCalendars ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : syncError ? (
              <p className="text-sm text-destructive">{syncError}</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                {calendars.map((cal) => (
                  <label
                    key={cal.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-accent transition-colors"
                  >
                    <Checkbox
                      checked={selected.has(cal.id)}
                      onCheckedChange={() => toggleCalendar(cal.id)}
                    />
                    <div
                      className="size-3 rounded-full shrink-0"
                      style={{ backgroundColor: cal.backgroundColor || "#4285f4" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{cal.summary}</span>
                        {cal.primary && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1">
                            Primary
                          </Badge>
                        )}
                      </div>
                      {cal.description && (
                        <p className="text-xs text-muted-foreground truncate">{cal.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => router.push("/")}
              >
                Skip
              </Button>
              <Button
                className="flex-1"
                disabled={selected.size === 0 || loadingCalendars}
                onClick={handleSync}
              >
                Sync {selected.size > 0 ? `(${selected.size})` : ""} calendar{selected.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Syncing step ───────────────────────────────────────────────────────────
  if (step === "syncing") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4">
            <Loader2 className="size-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Importing your calendar events&hellip; This may take a moment.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Done step ──────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <CheckCircle2 className="size-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-xl">All synced!</CardTitle>
          <CardDescription>Your Google Calendar events have been imported.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="rounded-lg border border-border divide-y divide-border">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm truncate">{r.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">
                  {r.importedEvents} event{r.importedEvents !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
          <Button className="w-full" onClick={() => router.push("/")}>
            Go to Calendar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
