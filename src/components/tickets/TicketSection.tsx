"use client";

import { useState, useEffect } from "react";
import {
  ArrowLeft, Ticket, Sparkles, ExternalLink, CalendarPlus,
  CheckCircle2, Loader2, AlertCircle, RefreshCw, ArrowRight, MapPin,
} from "lucide-react";
import { VenueSection } from "@/components/tickets/VenueSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface AiQuota { used: number; limit: number; remaining: number; resetAt?: string }

interface EventSlot {
  date: string;
  endDate: string | null;
  time: string | null;
  endTime: string | null;
  label: string;
}

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
  aiTokensUsed: number | null; // tokens consumed by the AI call
  aiQuota: AiQuota;
  ticketPrices: string[] | null;
  ticketPlatforms: string[] | null;
  endDate: string | null;
  endTime: string | null;
  saleDate: string | null;
  saleFirstDate: string | null;
  saleDates: Array<{ date: string; time: string | null; label: string }> | null;
  slots?: EventSlot[];
  duplicateCandidates?: Array<{ id: string; title: string; startTime: string; location: string | null }>;
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
  saleEventIds: Record<string, string>; // label → eventId (all sale windows)
  saleEventId: string | null;
  presaleEventId: string | null;
  changes: FieldChange[];
  storedDate: string | null;
  storedTime: string | null;
  storedVenue: string | null;
  storedSaleWindows: Array<{ label: string; date: string; time: string }>;
}

type Status = "idle" | "scraping" | "checking" | "scraped" | "diff" | "adding" | "updating" | "done" | "error";

/** Add N hours to a "HH:MM" string and return "HH:MM". Used for UTC→HKT display. */
function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h + hours) % 24;
  return `${String(total).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
}

/** Format a date range. If endDate == date or endDate is absent, show just date. */
function dateRange(date: string | null, endDate: string | null): string {
  if (!date) return "";
  if (!endDate || endDate === date) return date;
  return `${date} – ${endDate}`;
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
            className="mt-0.5 pointer-events-none"
            aria-hidden
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
  const [section, setSection] = useState<"import" | "venues">("import");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [ticket, setTicket] = useState<ScrapedTicket | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [addedCalendarName, setAddedCalendarName] = useState("");
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [extractMethod, setExtractMethod] = useState<"auto" | "og-meta">("auto");
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editVenue, setEditVenue] = useState("");
  // Multi-slot picker
  const [slots, setSlots] = useState<EventSlot[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const [calendarOptions, setCalendarOptions] = useState<{ eventReminders: import('@/app/api/tickets/calendars/route').TicketCalendarOption[]; saleTicket: import('@/app/api/tickets/calendars/route').TicketCalendarOption[] } | null>(null);
  const [selectedEventCalId, setSelectedEventCalId] = useState<string | null>(null);
  const [selectedSaleCalId, setSelectedSaleCalId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  // Fetch quota on mount so badge shows before first scan
  useEffect(() => {
    fetch("/api/tickets/scrape")
      .then((r) => r.json())
      .then((d) => { if (d.aiQuota) setQuota(d.aiQuota); })
      .catch(() => null);
  }, []);

  const handleRefix = async () => {
    // Re-fix Times has been removed from the UI; this handler is kept for safety but unused
  };

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
      setEditEndDate(data.endDate ?? "");
      setEditEndTime(data.endTime ?? "");      setEditVenue(data.venue ?? data.location ?? "");
      // Multi-slot picker — pre-select all slots
      const dataSlots: EventSlot[] = data.slots ?? [];
      setSlots(dataSlots);
      setSelectedSlots(new Set(dataSlots.map((_, i) => i)));

      // Fetch available calendars to offer picker if multiple options exist
      fetch("/api/tickets/calendars")
        .then((r) => r.json())
        .then((opts) => {
          setCalendarOptions(opts);
          // Default selections to the user's own calendar (first own option)
          const ownEvent = opts.eventReminders?.find((c: import('@/app/api/tickets/calendars/route').TicketCalendarOption) => c.isOwn);
          const ownSale = opts.saleTicket?.find((c: import('@/app/api/tickets/calendars/route').TicketCalendarOption) => c.isOwn);
          setSelectedEventCalId(ownEvent?.id ?? null);
          setSelectedSaleCalId(ownSale?.id ?? null);
        })
        .catch(() => null); // best-effort — fall back to default behaviour

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

  const handleMerge = async (targetEventId: string) => {
    if (!ticket) return;
    setMerging(true);
    try {
      // Load the existing event's current description
      const evRes = await fetch(`/api/events/${targetEventId}`);
      if (!evRes.ok) throw new Error("Could not load existing event");
      const existing = await evRes.json();
      const prevDesc: string = existing.description ?? "";

      // 1. Append new Ticket URL line if not already present
      const newUrl = ticket.sourceUrl;
      let newDesc = prevDesc;
      if (!prevDesc.includes(newUrl)) {
        newDesc = newDesc.trimEnd() + `\nTicket URL: ${newUrl}`;
      }

      // 2. Merge new platforms (add to existing "Platforms:" line, or append section)
      if (ticket.ticketPlatforms?.length) {
        const platformLine = newDesc.match(/^售票平台 Platforms: (.+)$/m);
        if (platformLine) {
          const existing_platforms = platformLine[1].split(/,\s*/);
          const toAdd = ticket.ticketPlatforms.filter(
            (p) => !existing_platforms.some((ep) => ep.toLowerCase() === p.toLowerCase())
          );
          if (toAdd.length) {
            newDesc = newDesc.replace(
              /^售票平台 Platforms: .+$/m,
              `售票平台 Platforms: ${[...existing_platforms, ...toAdd].join(", ")}`
            );
          }
        } else if (!newDesc.includes("售票平台 Platforms:")) {
          newDesc = newDesc.trimEnd() + `\n\n售票平台 Platforms: ${ticket.ticketPlatforms.join(", ")}`;
        }
      }

      // 3. Merge new prices (add to existing "Ticket Prices:" line, or append section)
      if (ticket.ticketPrices?.length) {
        const priceLine = newDesc.match(/^門票票價 Ticket Prices: (.+)$/m);
        if (priceLine) {
          const existing_prices = priceLine[1].split(/\s*\/\s*/);
          const toAdd = ticket.ticketPrices.filter(
            (p) => !existing_prices.some((ep) => ep.toLowerCase() === p.toLowerCase())
          );
          if (toAdd.length) {
            newDesc = newDesc.replace(
              /^門票票價 Ticket Prices: .+$/m,
              `門票票價 Ticket Prices: ${[...existing_prices, ...toAdd].join(" / ")}`
            );
          }
        } else if (!newDesc.includes("門票票價 Ticket Prices:")) {
          newDesc = newDesc.trimEnd() + `\n\n門票票價 Ticket Prices: ${ticket.ticketPrices.join(" / ")}`;
        }
      }

      if (newDesc === prevDesc) {
        toast.info("No new information to merge — event is already up to date");
        return;
      }

      const patchRes = await fetch(`/api/events/${targetEventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: newDesc }),
      });
      if (!patchRes.ok) throw new Error("Failed to update event");

      toast.success("Merged ticket info into existing event");
      handleReset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  const handleAddToCalendar = async () => {
    if (!ticket) return;
    setStatus("adding");

    const baseTitle = editTitle.trim() || ticket.title;
    const baseVenue = editVenue.trim() || ticket.venue;

    // Helper: build end date/time (defaults to start + 3 h) and call add API.
    // omitSales=true strips sale-window fields so only the first slot creates sale-ticket events.
    const addOneSlot = async (date: string | null, time: string | null, endDate: string | null, endTime: string | null, omitSales = false) => {
      const resolvedDate = (date ?? editDate.trim()) || ticket.date;
      const resolvedTime = (time ?? editTime.trim()) || ticket.time;
      let resolvedEndDate = (endDate ?? editEndDate.trim()) || null;
      let resolvedEndTime = (endTime ?? editEndTime.trim()) || null;
      if (!resolvedEndDate && !resolvedEndTime && resolvedDate && resolvedTime) {
        const [h, m] = resolvedTime.split(":").map(Number);
        const totalMins = h * 60 + m + 3 * 60;
        const endH = Math.floor(totalMins / 60) % 24;
        const endM = totalMins % 60;
        const dayOverflow = Math.floor(totalMins / (24 * 60));
        resolvedEndTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
        if (dayOverflow > 0) {
          const d = new Date(resolvedDate + "T00:00:00");
          d.setDate(d.getDate() + dayOverflow);
          resolvedEndDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        } else {
          resolvedEndDate = resolvedDate;
        }
      }
      const ticketPayload = omitSales
        ? { ...ticket, title: baseTitle, date: resolvedDate, time: resolvedTime, endDate: resolvedEndDate, endTime: resolvedEndTime, venue: baseVenue, saleDates: null, saleDate: null, saleFirstDate: null }
        : { ...ticket, title: baseTitle, date: resolvedDate, time: resolvedTime, endDate: resolvedEndDate, endTime: resolvedEndTime, venue: baseVenue };
      return fetch("/api/tickets/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: ticketPayload,
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          ...(selectedEventCalId ? { targetCalendarId: selectedEventCalId } : {}),
          ...(omitSales ? {} : selectedSaleCalId ? { targetSaleCalendarId: selectedSaleCalId } : {}),
        }),
      });
    };

    try {
      const slotsToAdd = slots.length > 1 ? slots.filter((_, i) => selectedSlots.has(i)) : null;

      if (slotsToAdd && slotsToAdd.length > 0) {
        // Multi-slot: one performance event per slot.
        // Sale-ticket events (presale, public sale, etc.) are created only on the FIRST slot
        // — they apply to all performance dates equally and should not be duplicated.
        let calName = "event-reminders";
        for (const [i, slot] of slotsToAdd.entries()) {
          const res = await addOneSlot(slot.date, slot.time, slot.endDate, slot.endTime, i > 0);
          const data = await res.json();
          if (!res.ok) {
            toast.error(data.error ?? "Failed to add event");
            setStatus("scraped");
            return;
          }
          calName = data.calendarName ?? calName;
        }
        setAddedCalendarName(calName);
        setStatus("done");
        toast.success(`${slotsToAdd.length} slot${slotsToAdd.length > 1 ? "s" : ""} added to "${calName}"!`);
      } else {
        // Single event
        const res = await addOneSlot(null, null, null, null);
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to add event");
          setStatus("scraped");
          return;
        }
        setAddedCalendarName(data.calendarName ?? "event-reminders");
        setStatus("done");
        toast.success(`Event added to "${data.calendarName}"!`);
      }
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
          presaleEventId: diffResult.presaleEventId,
          saleEventIds: diffResult.saleEventIds,
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
    setSlots([]);
    setSelectedSlots(new Set());
    setCalendarOptions(null);
    setSelectedEventCalId(null);
    setSelectedSaleCalId(null);
  };

  // Auto-reset 3 s after a successful add so the input is ready for the next scan
  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(handleReset, 3000);
    return () => clearTimeout(t);
  }, [status]); // handleReset is stable (no deps change identity)

  const isLoading = ["scraping", "checking", "adding", "updating"].includes(status);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center gap-4 shrink-0">
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
          {quota && (
            <div className="flex flex-col items-end gap-0.5">
              <Badge
                variant={quota.remaining <= 10 ? "destructive" : "outline"}
                className="text-xs tabular-nums"
              >
                {quota.remaining}/{quota.limit} AI calls left
              </Badge>
              {quota.resetAt && (
                <span className="text-[10px] text-muted-foreground leading-none">
                  resets {new Date(quota.resetAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}
                </span>
              )}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground gap-1 hidden"
            onClick={handleRefix}
            disabled
            title="Re-fix Times has been moved to settings"
          >
          </Button>
          {ticket?.aiUsed && (
            <Badge variant="secondary" className="text-xs font-mono">
              {ticket.aiUsed}
              {ticket.aiTokensUsed ? ` · ${ticket.aiTokensUsed.toLocaleString()}t` : ""}
            </Badge>
          )}
        </div>
      </header>

      {/* Body: left sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav */}
        <nav className="w-44 border-r shrink-0 p-2 space-y-0.5">
          <button
            onClick={() => setSection("import")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
              section === "import"
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Ticket className="size-4 shrink-0" />
            Import Event
          </button>
          <button
            onClick={() => setSection("venues")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
              section === "venues"
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <MapPin className="size-4 shrink-0" />
            Venues
          </button>
        </nav>

        {/* Main content */}
        <div className="flex-1 overflow-auto">
          {section === "venues" ? (
            <VenueSection />
          ) : (
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
                      <p className="font-medium">{dateRange(diffResult.storedDate, ticket.endDate)}</p>
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
                  {diffResult.storedSaleWindows?.length > 0 && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Sale Windows 售票時段</p>
                      {diffResult.storedSaleWindows.map((w) => (
                        <p key={w.label} className="font-medium text-xs">
                          <span className="text-muted-foreground">{w.label}:</span> {w.date} {w.time}
                        </p>
                      ))}
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
                    <p className="font-medium">{dateRange(ticket.date, ticket.endDate)}</p>
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
                {(ticket.saleDates?.length ? ticket.saleDates : [
                  ...(ticket.saleFirstDate ? [{ date: ticket.saleFirstDate, time: null, label: "Fan Presale" }] : []),
                  ...(ticket.saleDate ? [{ date: ticket.saleDate, time: null, label: "Public Sale" }] : []),
                ]).map((w, i) => (
                  <div key={i} className="col-span-2">
                    <p className="text-xs text-muted-foreground">{w.label}</p>
                    <p className="font-medium">{w.date}{w.time ? " " + w.time : ""}</p>
                  </div>
                ))}
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
                  <CardDescription className="text-xs mt-0.5 flex items-center flex-wrap gap-1.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                      ticket.aiError
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : ticket.aiUsed.startsWith("og-meta")
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary"
                    }`}>
                      {ticket.aiError ? "⚠" : ticket.aiUsed.startsWith("og-meta") ? "📄" : "✦"}&nbsp;{ticket.aiUsed}
                    </span>
                    {ticket.aiError ? (
                      <span className="text-amber-500" title={ticket.aiError}>AI error — using OG-meta fallback</span>
                    ) : (
                      <span className="text-muted-foreground">edit any field if wrong</span>
                    )}
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
              {/* Duplicate warning — when a similar event already exists on the same day */}
              {ticket.duplicateCandidates && ticket.duplicateCandidates.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm space-y-2">
                  <p className="font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertCircle className="size-3.5 shrink-0" />
                    Similar event already in your calendar
                  </p>
                  {ticket.duplicateCandidates.map((c) => (
                    <div key={c.id} className="flex items-start justify-between gap-2 pl-5">
                      <p className="text-xs text-muted-foreground">
                        &ldquo;{c.title}&rdquo;{c.location ? ` · ${c.location}` : ""}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2 shrink-0"
                        disabled={merging}
                        onClick={() => handleMerge(c.id)}
                      >
                        {merging ? <Loader2 className="size-3 animate-spin" /> : null}
                        Merge URL
                      </Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pl-5">Merge to add this ticket URL + any new info to the existing event, or add as a new event below.</p>
                </div>
              )}

              {ticket.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ticket.imageUrl}
                  alt={ticket.title}
                  className="w-full h-32 object-cover rounded-md"
                />
              )}

              {/* Slot picker — shown when scraper found multiple distinct timeslots */}
              {slots.length > 1 && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1.5">
                    Performance Slots ({selectedSlots.size}/{slots.length} selected)
                  </label>
                  <div className="space-y-1.5">
                    {slots.map((slot, i) => (
                      <label
                        key={i}
                        className={`flex items-center gap-2.5 cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${
                          selectedSlots.has(i) ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40"
                        }`}
                      >
                        <Checkbox
                          checked={selectedSlots.has(i)}
                          onCheckedChange={(checked) =>
                            setSelectedSlots((prev) => {
                              const next = new Set(prev);
                              checked ? next.add(i) : next.delete(i);
                              return next;
                            })
                          }
                        />
                        <span>{slot.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
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
                <div className={`grid grid-cols-2 gap-2 ${slots.length > 1 ? "hidden" : ""}`}>
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
                    Platforms 售票平台
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ticket.ticketPlatforms.map((platform) => (
                      <span key={platform} className="inline-block bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded">
                        {platform}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(ticket.saleDates?.length ? ticket.saleDates : [
                ...(ticket.saleFirstDate ? [{ date: ticket.saleFirstDate, time: null, label: "Fan Presale 會員優先購票" }] : []),
                ...(ticket.saleDate ? [{ date: ticket.saleDate, time: null, label: "Public Sale 公開發售" }] : []),
              ]).map((w, i) => (
                <div key={i}>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    {w.label}
                  </p>
                  <p className="text-sm">{w.date}{w.time ? " " + w.time : ""}</p>
                </div>
              ))}

              {/* Calendar picker — only shown when 2+ options exist */}
              {status === "scraped" && calendarOptions && calendarOptions.eventReminders.length >= 2 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Save event to</p>
                  <div className="flex flex-col gap-1.5">
                    {calendarOptions.eventReminders.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setSelectedEventCalId(opt.id)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                          selectedEventCalId === opt.id
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                        <span className="flex-1 truncate">
                          {opt.name}{opt.isOwn ? " (yourself)" : opt.ownerName ? ` — ${opt.ownerName}` : ""}
                        </span>
                        {!opt.isOwn && (
                          <span className="text-[10px] text-muted-foreground border border-border rounded px-1">collaborative</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sale calendar picker */}
              {status === "scraped" && calendarOptions && calendarOptions.saleTicket.length >= 2 && (ticket.saleDates?.length || ticket.saleDate || ticket.saleFirstDate) && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Save sale reminders to</p>
                  <div className="flex flex-col gap-1.5">
                    {calendarOptions.saleTicket.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setSelectedSaleCalId(opt.id)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                          selectedSaleCalId === opt.id
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                        <span className="flex-1 truncate">
                          {opt.name}{opt.isOwn ? " (yourself)" : opt.ownerName ? ` — ${opt.ownerName}` : ""}
                        </span>
                        {!opt.isOwn && (
                          <span className="text-[10px] text-muted-foreground border border-border rounded px-1">collaborative</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              {status === "scraped" && (
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleAddToCalendar}
                    className="flex-1"
                    disabled={slots.length > 1 && selectedSlots.size === 0}
                  >
                    <CalendarPlus className="size-4 mr-2" />
                    {slots.length > 1
                      ? `Add ${selectedSlots.size} slot${selectedSlots.size !== 1 ? "s" : ""}`
                      : "Add to event-reminders"}
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
          )}
        </div>
      </div>
    </div>
  );
}
