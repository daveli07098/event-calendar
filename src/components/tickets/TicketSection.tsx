"use client";

import { useState } from "react";
import {
  ArrowLeft, Ticket, Sparkles, ExternalLink, CalendarPlus,
  CheckCircle2, Loader2, AlertCircle, RefreshCw, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface AiQuota { used: number; limit: number; remaining: number }

interface ScrapedTicket {
  title: string;
  date: string | null;       // ISO string or natural language
  time: string | null;
  venue: string | null;
  location: string | null;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string;
  aiUsed: string;            // which AI provider processed it
  aiError: string | null;    // set when AI failed and fell back to og-meta
  aiQuota: AiQuota;
  ticketPrices: string[] | null;
  ticketPlatforms: string[] | null;
  saleDate: string | null;
}

interface FieldChange {
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
}

interface DiffResult {
  hasExisting: boolean;
  hasChanges: boolean;
  eventId: string | null;
  saleEventId: string | null;
  changes: FieldChange[];
  storedDate: string | null;
  storedTime: string | null;
  storedVenue: string | null;
}

type Status = "idle" | "scraping" | "checking" | "scraped" | "diff" | "adding" | "updating" | "done" | "error";

/** Add N hours to a "HH:MM" string and return "HH:MM". Used for UTC→HKT display. */
function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h + hours) % 24;
  return `${String(total).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Diff table sub-component
// ---------------------------------------------------------------------------
function DiffTable({
  changes,
  selected,
  onToggle,
}: {
  changes: FieldChange[];
  selected: Set<string>;
  onToggle: (field: string) => void;
}) {
  return (
    <div className="rounded-md border border-border overflow-hidden text-sm">
      <div className="grid grid-cols-[auto_1fr_auto_1fr] bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide gap-x-3">
        <span />
        <span>Current 目前</span>
        <span className="text-center">→</span>
        <span>Updated 更新</span>
      </div>
      {changes.map((change) => (
        <div
          key={change.field}
          className="grid grid-cols-[auto_1fr_auto_1fr] items-start px-3 py-2.5 border-t border-border gap-x-3 hover:bg-muted/30 cursor-pointer"
          onClick={() => onToggle(change.field)}
        >
          <Checkbox
            checked={selected.has(change.field)}
            onCheckedChange={() => onToggle(change.field)}
            className="mt-0.5"
          />
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">{change.label}</p>
            <p className={selected.has(change.field) ? "line-through text-muted-foreground text-sm" : "text-sm"}>
              {change.oldValue ?? <span className="italic text-muted-foreground">none</span>}
            </p>
          </div>
          <ArrowRight className="size-3.5 text-muted-foreground mt-4" />
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">&nbsp;</p>
            <p className={`text-sm font-medium ${selected.has(change.field) ? "text-primary" : "text-muted-foreground"}`}>
              {change.newValue ?? "—"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TicketSection() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [ticket, setTicket] = useState<ScrapedTicket | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [addedCalendarName, setAddedCalendarName] = useState("");
  const [quota, setQuota] = useState<AiQuota | null>(null);
  // Extraction method: "auto" uses AI when available; "og-meta" forces OG/Schema only (free, no quota)
  const [extractMethod, setExtractMethod] = useState<"auto" | "og-meta">("auto");
  // Diff state
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  // Editable preview fields — pre-filled from scrape, user can correct before adding
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editVenue, setEditVenue] = useState("");

  const handleScrape = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setStatus("scraping");
    setTicket(null);
    setDiffResult(null);
    setSelectedFields(new Set());
    setErrorMsg("");

    try {
      const res = await fetch("/api/tickets/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, method: extractMethod }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to scrape the URL");
        setStatus("error");
        return;
      }

      setTicket(data);
      if (data.aiQuota) setQuota(data.aiQuota);
      // Warn user if AI fell back to og-meta due to an error (e.g. quota exceeded)
      if (data.aiError && data.aiUsed.startsWith("og-meta")) {
        toast.warning(`AI unavailable: ${data.aiError}. Showing OG-meta results only.`);
      }
      // Pre-fill editable fields so user can adjust before adding
      setEditTitle(data.title ?? "");
      setEditDate(data.date ?? "");
      setEditTime(data.time ?? "");
      setEditVenue(data.venue ?? "");

      // Auto-check for existing events with this URL
      setStatus("checking");
      try {
        const diffRes = await fetch("/api/tickets/diff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed, ticket: data, tzOffsetMinutes: new Date().getTimezoneOffset() }),
        });
        if (diffRes.ok) {
          const diff: DiffResult = await diffRes.json();
          setDiffResult(diff);
          if (diff.hasExisting && diff.hasChanges) {
            setSelectedFields(new Set(diff.changes.map((c) => c.field)));
            setStatus("diff");
            return;
          }
        }
      } catch { /* diff check failure is non-fatal */ }

      setStatus("scraped");
    } catch {
      setErrorMsg("Network error — please try again");
      setStatus("error");
    }
  };

  const toggleField = (field: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };

  const handleAddToCalendar = async () => {
    if (!ticket) return;
    setStatus("adding");

    // Merge user edits back into the ticket before sending
    const ticketToAdd = {
      ...ticket,
      title: editTitle.trim() || ticket.title,
      date: editDate.trim() || ticket.date,
      time: editTime.trim() || ticket.time,
      endDate: editEndDate.trim() || null,
      endTime: editEndTime.trim() || null,
      venue: editVenue.trim() || ticket.venue,
    };

    try {
      const res = await fetch("/api/tickets/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: ticketToAdd }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to add event");
        setStatus("scraped");
        return;
      }

      setAddedCalendarName(data.calendarName ?? "event-reminders");
      setStatus("done");
      toast.success(`Event added to "${data.calendarName}"!`);
    } catch {
      toast.error("Network error — please try again");
      setStatus("scraped");
    }
  };

  const handleApplyUpdates = async () => {
    if (!ticket || !diffResult?.eventId || selectedFields.size === 0) return;
    setStatus("updating");

    try {
      const res = await fetch("/api/tickets/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: diffResult.eventId,
          saleEventId: diffResult.saleEventId,
          appliedFields: Array.from(selectedFields),
          ticket,
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update event");
        setStatus("diff");
        return;
      }

      setAddedCalendarName("event-reminders");
      setStatus("done");
      toast.success(`Updated ${selectedFields.size} field${selectedFields.size > 1 ? "s" : ""}!`);
    } catch {
      toast.error("Network error — please try again");
      setStatus("diff");
    }
  };

  const handleReset = () => {
    setUrl("");
    setStatus("idle");
    setTicket(null);
    setDiffResult(null);
    setSelectedFields(new Set());
    setErrorMsg("");
    setAddedCalendarName("");
    setEditTitle("");
    setEditDate("");
    setEditTime("");
    setEditEndDate("");
    setEditEndTime("");
    setEditVenue("");
  };

  const isLoading = ["scraping", "checking", "adding", "updating"].includes(status);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <a href="/">
          <Button variant="ghost" size="icon" className="size-8">
            <ArrowLeft className="size-4" />
          </Button>
        </a>
        <div className="flex items-center gap-2">
          <Ticket className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Ticket Section</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Extraction method selector */}
          <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
            <button
              onClick={() => setExtractMethod("auto")}
              className={`px-2.5 py-1.5 transition-colors ${
                extractMethod === "auto"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title="Use Gemini AI when available (uses quota)"
            >
              <Sparkles className="size-3 inline mr-1" />Auto
            </button>
            <button
              onClick={() => setExtractMethod("og-meta")}
              className={`px-2.5 py-1.5 transition-colors ${
                extractMethod === "og-meta"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title="OG Meta only — free, no AI quota used"
            >
              OG Meta
            </button>
          </div>
          {extractMethod === "auto" && quota && (
            <Badge
              variant={quota.remaining <= 10 ? "destructive" : "outline"}
              className="text-xs tabular-nums"
            >
              {quota.remaining}/{quota.limit} AI calls left
            </Badge>
          )}
          {ticket?.aiUsed && (
            <Badge variant="secondary" className="text-xs font-mono">
              {ticket.aiUsed}
            </Badge>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        {/* Intro */}
        <div className="space-y-1">
          <h2 className="text-2xl font-bold">Auto-import your tickets</h2>
          <p className="text-muted-foreground text-sm">
            Paste any event or ticket URL (Eventbrite, Ticketmaster, KKTIX, Accupass, etc.)
            and AI will extract the details and add it to a{" "}
            <span className="font-semibold text-foreground">event-reminders</span> calendar.
            Scan the same URL again anytime to check for updates — price changes, new sale dates, etc.
          </p>
        </div>

        {/* URL Input */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Paste ticket URL</CardTitle>
            <CardDescription>
              Scan once to import · scan again to check for updates.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="url"
                placeholder="https://timable.com/hk/zh/event/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && status === "idle" && handleScrape()}
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                onClick={handleScrape}
                disabled={!url.trim() || isLoading || status === "done"}
              >
                {status === "scraping" ? (
                  <><Loader2 className="size-4 mr-2 animate-spin" />Scanning…</>
                ) : status === "checking" ? (
                  <><Loader2 className="size-4 mr-2 animate-spin" />Checking…</>
                ) : (
                  <><RefreshCw className="size-4 mr-2" />Scan</>
                )}
              </Button>
            </div>

            {/* Supported sites hint */}
            <p className="text-xs text-muted-foreground">
              Works best with: Eventbrite · Ticketmaster · KKTIX · Accupass · Meetup · Lu.ma ·
              any site with proper Open Graph or Schema.org markup
            </p>
          </CardContent>
        </Card>

        {/* Error */}
        {status === "error" && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-start gap-3 pt-4">
              <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Could not extract ticket info</p>
                <p className="text-xs text-muted-foreground">{errorMsg}</p>
                <Button variant="outline" size="sm" onClick={handleReset} className="mt-2">
                  Try another URL
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── DIFF VIEW — existing event has changes ── */}
        {status === "diff" && ticket && diffResult && (
          <Card className="border-primary/40">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base leading-snug">{ticket.title}</CardTitle>
                  <CardDescription className="mt-1">
                    Already in your calendar.{" "}
                    <span className="font-semibold text-foreground">
                      {diffResult.changes.length} change{diffResult.changes.length > 1 ? "s" : ""}
                    </span>{" "}
                    detected — tick what you want to apply.
                  </CardDescription>
                </div>
                <a href={ticket.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <Button variant="ghost" size="icon" className="size-7">
                    <ExternalLink className="size-3.5" />
                  </Button>
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Static context — show date/venue even when they haven't changed */}
              {(diffResult.storedDate || diffResult.storedVenue) && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm bg-muted/40 rounded-md px-3 py-2.5">
                  {diffResult.storedDate && (
                    <div>
                      <p className="text-xs text-muted-foreground">Date 日期</p>
                      <p className="font-medium">{diffResult.storedDate}</p>
                    </div>
                  )}
                  {diffResult.storedTime && (
                    <div>
                      <p className="text-xs text-muted-foreground">Time 時間</p>
                      <p className="font-medium">{diffResult.storedTime}</p>
                    </div>
                  )}
                  {diffResult.storedVenue && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Venue 場地</p>
                      <p className="font-medium">{diffResult.storedVenue}</p>
                    </div>
                  )}
                </div>
              )}
              <DiffTable changes={diffResult.changes} selected={selectedFields} onToggle={toggleField} />

              <div className="flex gap-3 text-xs text-muted-foreground">
                <button onClick={() => setSelectedFields(new Set(diffResult.changes.map((c) => c.field)))} className="text-primary hover:underline">
                  Select all
                </button>
                <span>·</span>
                <button onClick={() => setSelectedFields(new Set())} className="hover:underline">
                  Deselect all
                </button>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleApplyUpdates} disabled={selectedFields.size === 0} className="flex-1">
                  <CheckCircle2 className="size-4 mr-2" />
                  Apply {selectedFields.size > 0 ? `${selectedFields.size} ` : ""}update{selectedFields.size !== 1 ? "s" : ""}
                </Button>
                <Button variant="outline" onClick={handleReset}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* No changes detected — show basic event info */}
        {diffResult?.hasExisting && !diffResult.hasChanges && status === "scraped" && ticket && (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="space-y-3 pt-4 pb-4">
              <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
                <CheckCircle2 className="size-4 shrink-0" />
                Already in your calendar — up to date
              </div>
              {ticket.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ticket.imageUrl} alt={ticket.title} className="w-full h-28 object-cover rounded-md" />
              )}
              <p className="text-sm font-semibold">{ticket.title}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {ticket.date && (
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="font-medium">{ticket.date}</p>
                  </div>
                )}
                {ticket.time && (
                  <div>
                    <p className="text-xs text-muted-foreground">Time</p>
                    <p className="font-medium">{ticket.time}</p>
                  </div>
                )}
                {ticket.venue && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Venue 場地</p>
                    <p className="font-medium">{ticket.venue}</p>
                  </div>
                )}
                {ticket.ticketPrices?.length ? (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Ticket Prices 門票票價</p>
                    <p className="font-medium">{ticket.ticketPrices.join(" / ")}</p>
                  </div>
                ) : null}
                {ticket.saleDate && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Sale Opens 開售日期</p>
                    <p className="font-medium">{ticket.saleDate}</p>
                  </div>
                )}
                {ticket.ticketPlatforms?.length ? (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Platforms 售票平台</p>
                    <p className="font-medium">{ticket.ticketPlatforms.join(", ")}</p>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <a
                  href={ticket.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline truncate"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  Ticket link
                </a>
                <Button variant="outline" size="sm" onClick={handleReset}>Scan another URL</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Updating in progress */}
        {status === "updating" && (
          <Card>
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <Loader2 className="size-5 animate-spin text-primary shrink-0" />
              <p className="text-sm">Applying updates…</p>
            </CardContent>
          </Card>
        )}

        {/* Scraped preview — editable so user can correct any field before adding */}
        {(status === "scraped" || status === "adding") && ticket && !diffResult?.hasExisting && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Review &amp; adjust before adding</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Extracted by <span className="font-medium">{ticket.aiUsed}</span>
                    {ticket.aiError ? (
                      <span className="ml-1 text-amber-500" title={ticket.aiError}>⚠ AI failed</span>
                    ) : " · edit any field if wrong"}
                  </CardDescription>
                </div>
                <a href={ticket.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <Button variant="ghost" size="icon" className="size-7">
                    <ExternalLink className="size-3.5" />
                  </Button>
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {ticket.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ticket.imageUrl}
                  alt={ticket.title}
                  className="w-full h-32 object-cover rounded-md"
                />
              )}

              {/* Editable fields */}
              <div className="space-y-2.5">
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1">Title</label>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Event title"
                    disabled={status === "adding"}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1">Start Date</label>
                    <Input
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      placeholder="e.g. 2026-07-18"
                      disabled={status === "adding"}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1">Start Time</label>
                    <Input
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      placeholder="e.g. 20:00"
                      disabled={status === "adding"}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1">End Date</label>
                    <Input
                      value={editEndDate}
                      onChange={(e) => setEditEndDate(e.target.value)}
                      placeholder="e.g. 2026-07-18"
                      disabled={status === "adding"}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1">End Time</label>
                    <Input
                      value={editEndTime}
                      onChange={(e) => setEditEndTime(e.target.value)}
                      placeholder="e.g. 22:00"
                      disabled={status === "adding"}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1">Venue</label>
                  <Input
                    value={editVenue}
                    onChange={(e) => setEditVenue(e.target.value)}
                    placeholder="Venue name"
                    disabled={status === "adding"}
                  />
                </div>
              </div>

              {ticket.description && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-muted-foreground line-clamp-3">{ticket.description}</p>
                </div>
              )}

              {/* Ticket-specific info */}
              {ticket.ticketPrices && ticket.ticketPrices.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Ticket Prices 門票票價
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ticket.ticketPrices.map((price) => (
                      <span
                        key={price}
                        className="inline-block bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs font-semibold px-2 py-0.5 rounded"
                      >
                        {price}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {ticket.ticketPlatforms && ticket.ticketPlatforms.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Buy Tickets 立即購票
                  </p>
                  <p className="text-sm">{ticket.ticketPlatforms.join(" · ")}</p>
                </div>
              )}

              {ticket.saleDate && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    On Sale 開售
                  </p>
                  <p className="text-sm">{ticket.saleDate}</p>
                </div>
              )}

              {/* Actions */}
              {status === "scraped" && (
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleAddToCalendar} className="flex-1">
                    <CalendarPlus className="size-4 mr-2" />
                    Add to event-reminders
                  </Button>
                  <Button variant="outline" onClick={handleReset}>Clear</Button>
                </div>
              )}

              {status === "adding" && (
                <Button disabled className="w-full">
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Adding to calendar…
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Done */}
        {status === "done" && (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="size-4" />
                Saved to <span className="font-semibold">{addedCalendarName}</span>
              </div>
              <div className="flex gap-2">
                {/* Hard reload so new event-reminders / sale-ticket calendars appear in sidebar */}
                <a href="/" className="flex-1">
                  <Button variant="outline" className="w-full">View calendar</Button>
                </a>
                <Button variant="outline" onClick={handleReset}>Add another</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI provider info */}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            Which AI is used for extraction?
          </summary>
          <div className="mt-2 space-y-1 pl-2 border-l border-border">
            <p>The server checks for these env vars in order:</p>
            <ol className="list-decimal list-inside space-y-1 mt-1">
              <li>
                <code className="bg-muted px-1 rounded">GEMINI_API_KEY</code> — Google Gemini
                1.5 Flash (free: 1M tokens/day at{" "}
                <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="underline">
                  aistudio.google.com
                </a>
                )
              </li>
              <li>
                <code className="bg-muted px-1 rounded">GITHUB_TOKEN</code> — GitHub Copilot
                Chat API (uses your existing Copilot subscription)
              </li>
              <li>
                <code className="bg-muted px-1 rounded">GROQ_API_KEY</code> — Groq / Llama 3
                (free tier at{" "}
                <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="underline">
                  console.groq.com
                </a>
                )
              </li>
              <li>
                <span className="font-medium">OG / Schema fallback</span> — no key needed, reads
                meta tags & JSON-LD (works for most major platforms)
              </li>
            </ol>
          </div>
        </details>
      </div>
    </div>
  );
}
