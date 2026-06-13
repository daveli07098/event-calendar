"use client";

import { useState, useEffect } from "react";
import {
  BadgePercent, RefreshCw, Loader2, Plus, Trash2, ExternalLink,
  CalendarPlus, CheckCircle2, AlertCircle, Copy, Check, Quote, Tag, Users, Sparkles, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CalendarType } from "@/types";

interface DiscountOffer {
  label: string;
  detail: string | null;
  discountPercent: string | null;
  promoCode: string | null;
  minSpend: string | null;
  audience: "all" | "members" | "new" | null;
}

interface DiscountResult {
  hasDiscount: boolean;
  confidence: "high" | "medium" | "low" | null;
  title: string | null;
  discountSummary: string | null;
  discountPercent: string | null;
  promoCode: string | null;
  startDate: string | null;
  endDate: string | null;
  categories: string[];
  offers: DiscountOffer[];
  evidence: string[];
  items: Array<{ name: string; price: string | null; originalPrice: string | null }>;
  sourceUrl: string;
  aiUsed: string;
  tokensUsed: number | null;
}

const AUDIENCE_LABEL: Record<string, string> = {
  all: "Everyone",
  members: "Members",
  new: "New customers",
};

/** Days until an end date (YYYY-MM-DD), or null if absent/past. */
function daysUntil(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate}T23:59:59`).getTime();
  if (Number.isNaN(end)) return null;
  const diff = Math.ceil((end - Date.now()) / 86_400_000);
  return diff >= 0 ? diff : null;
}

/** Small copy-to-clipboard button for promo codes. */
function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy");
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-primary/50 bg-primary/5 px-2 py-0.5 font-mono text-xs font-medium text-primary transition-colors hover:bg-primary/10"
      title="Copy code"
    >
      {code}
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

type SourceStatus =
  | { state: "idle" }
  | { state: "scanning" }
  | { state: "done"; result: DiscountResult }
  | { state: "error"; message: string };

const DEFAULT_SOURCES = [
  "https://www.nike.com",
  "https://www.adidas.com",
  "https://www.puma.com",
  "https://marathonsports.hkstore.com/marathon_tc_hk/",
];

const CUSTOM_SOURCES_KEY = "discount-sources";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function DiscountSection({ onQuotaUpdate }: { onQuotaUpdate?: (q: { used: number; limit: number; remaining: number }) => void }) {
  const [customSources, setCustomSources] = useState<string[]>([]);
  const [newSource, setNewSource] = useState("");
  const [statuses, setStatuses] = useState<Record<string, SourceStatus>>({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [calendars, setCalendars] = useState<CalendarType[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState<Record<string, string>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiscountResult | null>(null);
  const [previewStart, setPreviewStart] = useState(""); // YYYY-MM-DD, editable in the dialog
  const [previewEnd, setPreviewEnd] = useState("");
  const [addedFor, setAddedFor] = useState<Set<string>>(new Set());

  const sources = [...DEFAULT_SOURCES, ...customSources];

  // Load persisted custom sources after mount — localStorage isn't available
  // during SSR and reading it in a useState initializer would cause a
  // hydration mismatch, so the post-mount setState is intentional here.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_SOURCES_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setCustomSources(JSON.parse(saved));
    } catch {
      // Corrupt storage — start with defaults only
    }
  }, []);

  // Writable calendars for the "add to calendar" picker
  useEffect(() => {
    fetch("/api/calendars")
      .then((r) => (r.ok ? r.json() : []))
      .then((cals: CalendarType[]) => {
        const writable = cals.filter((c) => !c.memberRole || c.memberRole === "editor");
        setCalendars(writable);
      })
      .catch(() => toast.error("Couldn't load calendars"));
  }, []);

  const defaultCalendarId =
    calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? "";

  const persistCustomSources = (next: string[]) => {
    setCustomSources(next);
    try {
      localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — sources last for the session only
    }
  };

  const addSource = () => {
    const url = newSource.trim();
    if (!url) return;
    let normalized: string;
    try {
      normalized = new URL(url.startsWith("http") ? url : `https://${url}`).toString();
    } catch {
      toast.error("Invalid URL");
      return;
    }
    if (sources.includes(normalized)) {
      toast.info("Source already in the list");
      return;
    }
    persistCustomSources([...customSources, normalized]);
    setNewSource("");
  };

  const removeSource = (url: string) => {
    persistCustomSources(customSources.filter((s) => s !== url));
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[url];
      return next;
    });
  };

  const scanSource = async (url: string): Promise<void> => {
    setStatuses((prev) => ({ ...prev, [url]: { state: "scanning" } }));
    try {
      const res = await fetch("/api/discounts/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatuses((prev) => ({ ...prev, [url]: { state: "error", message: data.error ?? `HTTP ${res.status}` } }));
        return;
      }
      setStatuses((prev) => ({ ...prev, [url]: { state: "done", result: data.result } }));
      if (data.aiQuota) onQuotaUpdate?.(data.aiQuota);
    } catch {
      setStatuses((prev) => ({ ...prev, [url]: { state: "error", message: "Network error" } }));
    }
  };

  // Sequential on purpose — free-tier AI providers are RPM-limited
  const checkAll = async () => {
    setCheckingAll(true);
    for (const url of sources) {
      await scanSource(url);
    }
    setCheckingAll(false);
  };

  // Build the full calendar-event payload + display fields for a discount,
  // using the (possibly user-edited) start/end dates from the preview dialog.
  const buildEvent = (result: DiscountResult, startDate: string, endDate: string) => {
    const domain = domainOf(result.sourceUrl);
    const fmtD = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const period = startDate === endDate ? `🗓️ ${fmtD(startDate)} · all-day` : `🗓️ Valid ${fmtD(startDate)} – ${fmtD(endDate)}`;

    const descriptionLines = [
      period,
      result.discountSummary,
      result.discountPercent ? `Headline: ${result.discountPercent} off` : null,
      result.promoCode ? `Promo code: ${result.promoCode}` : null,
      result.categories.length ? `On sale: ${result.categories.join(", ")}` : null,
      result.offers.length ? "\nAll offers:" : null,
      ...result.offers.map((o) => {
        const bits = [
          o.detail || o.discountPercent,
          o.promoCode ? `code ${o.promoCode}` : null,
          o.minSpend ? `min ${o.minSpend}` : null,
          o.audience && o.audience !== "all" ? AUDIENCE_LABEL[o.audience] : null,
        ].filter(Boolean);
        return `• ${o.label}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
      }),
      result.items.length ? "\nItems:" : null,
      ...result.items.map(
        (it) =>
          `• ${it.name}${it.price ? ` — ${it.price}` : ""}${it.originalPrice ? ` (was ${it.originalPrice})` : ""}`
      ),
      `\n🛒 Shop: ${result.sourceUrl}`,
    ].filter((l) => l !== null);

    return {
      title: `🏷️ ${result.title ?? `${domain} discount`}${startDate !== endDate ? ` (until ${fmtD(endDate)})` : ""}`,
      description: descriptionLines.join("\n"),
      location: domain,
      startDate,
      endDate,
      period,
    };
  };

  // Open the preview, seeding the editable dates from the detected period.
  const openPreview = (result: DiscountResult) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = result.startDate ?? today;
    setPreviewStart(start);
    setPreviewEnd(result.endDate ?? start);
    setPreview(result);
  };

  // Confirm from the preview dialog → create the event.
  const confirmAdd = async () => {
    if (!preview) return;
    const result = preview;
    const calendarId = selectedCalendar[result.sourceUrl] || defaultCalendarId;
    if (!calendarId) {
      toast.error("No calendar available");
      return;
    }
    const ev = buildEvent(result, previewStart, previewEnd);
    setAddingFor(result.sourceUrl);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ev.title,
          description: ev.description,
          location: ev.location,
          startTime: `${ev.startDate}T00:00:00`,
          endTime: `${ev.endDate}T23:59:00`,
          allDay: true,
          calendarId,
          category: "ticket",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't add event");
        return;
      }
      setAddedFor((prev) => new Set(prev).add(result.sourceUrl));
      toast.success("Discount added to calendar");
      setPreview(null);
    } catch {
      toast.error("Couldn't add event — network error");
    } finally {
      setAddingFor(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <BadgePercent className="size-6" />
          Discount Sale
        </h2>
        <p className="text-muted-foreground text-sm">
          Scan retail sites for active sales and discounts using AI. Found a deal?
          Add it to your calendar so you don&apos;t miss the window.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Sources</CardTitle>
              <CardDescription>Sites checked for discounts</CardDescription>
            </div>
            <Button onClick={checkAll} disabled={checkingAll} className="gap-2">
              {checkingAll ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Check all
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sources.map((url) => {
            const status = statuses[url] ?? { state: "idle" };
            const isCustom = customSources.includes(url);
            const result = status.state === "done" ? status.result : null;
            return (
              <div key={url} className="rounded-lg border border-border">
                {/* Source row */}
                <div className="flex items-center gap-2 p-3">
                  <span className="font-medium text-sm flex-1 truncate" title={url}>
                    {domainOf(url)}
                  </span>
                  {status.state === "done" && !result?.hasDiscount && (
                    <Badge variant="secondary" className="text-xs">No discount found</Badge>
                  )}
                  {result?.hasDiscount && (
                    <Badge className="text-xs gap-1" title={result.confidence ? `${result.confidence} confidence` : undefined}>
                      <BadgePercent className="size-3" />
                      {result.discountPercent ?? "Sale"}
                      {result.offers.length > 1 && (
                        <span className="opacity-80">· {result.offers.length} offers</span>
                      )}
                    </Badge>
                  )}
                  {status.state === "error" && (
                    <span className="flex items-center gap-1 text-xs text-destructive" title={status.message}>
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span className="max-w-44 truncate">{status.message}</span>
                    </span>
                  )}
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${domainOf(url)} in new tab`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                  {isCustom && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => removeSource(url)}
                      aria-label="Remove source"
                      title="Remove source"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => scanSource(url)}
                    disabled={status.state === "scanning" || checkingAll}
                  >
                    {status.state === "scanning" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    {status.state === "done" || status.state === "error" ? "Re-check" : "Check"}
                  </Button>
                </div>

                {/* Discount preview — rich deal card */}
                {result?.hasDiscount && (
                  <div className="border-t border-border bg-muted/20">
                    {/* Headline: big discount + title + confidence */}
                    <div className="flex items-start gap-3 p-3 pb-2">
                      {result.discountPercent && (
                        <div className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1.5 text-center">
                          <div className="text-lg font-bold leading-none text-primary">{result.discountPercent}</div>
                          <div className="text-[10px] uppercase tracking-wide text-primary/70">off</div>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{result.title ?? "Sale"}</p>
                          {result.confidence && (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                result.confidence === "high"
                                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                                  : result.confidence === "medium"
                                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                    : "bg-muted text-muted-foreground",
                              )}
                            >
                              {result.confidence} confidence
                            </span>
                          )}
                        </div>
                        {result.discountSummary && (
                          <p className="mt-0.5 text-sm text-muted-foreground">{result.discountSummary}</p>
                        )}
                      </div>
                    </div>

                    {/* Meta row: dates / countdown / promo code / categories */}
                    <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-xs text-muted-foreground">
                      {result.promoCode && <CopyCode code={result.promoCode} />}
                      {(() => {
                        const d = daysUntil(result.endDate);
                        return d !== null ? (
                          <span className={cn("inline-flex items-center gap-1", d <= 3 && "text-amber-600 dark:text-amber-400 font-medium")}>
                            <Clock className="size-3" />
                            {d === 0 ? "Ends today" : `${d} day${d === 1 ? "" : "s"} left`}
                          </span>
                        ) : (result.startDate || result.endDate) ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" />
                            {result.startDate ?? "now"} → {result.endDate ?? "ongoing"}
                          </span>
                        ) : null;
                      })()}
                    </div>

                    {/* Categories on sale */}
                    {result.categories.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
                        <Tag className="size-3 text-muted-foreground" />
                        {result.categories.map((c, i) => (
                          <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Distinct offers breakdown */}
                    {result.offers.length > 0 && (
                      <div className="mx-3 mb-2 divide-y divide-border rounded-md border border-border bg-background/50">
                        {result.offers.map((o, i) => (
                          <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
                            <BadgePercent className="mt-0.5 size-3.5 shrink-0 text-primary" />
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-foreground">{o.label}</span>
                              {o.detail && <span className="text-muted-foreground"> — {o.detail}</span>}
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                {o.discountPercent && (
                                  <span className="font-semibold text-primary">{o.discountPercent} off</span>
                                )}
                                {o.minSpend && <span className="text-muted-foreground">min spend {o.minSpend}</span>}
                                {o.promoCode && <CopyCode code={o.promoCode} />}
                                {o.audience && o.audience !== "all" && (
                                  <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                                    <Users className="size-3" />
                                    {AUDIENCE_LABEL[o.audience]}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Items with computed savings */}
                    {result.items.length > 0 && (
                      <ul className="px-3 pb-2 text-xs text-muted-foreground space-y-0.5">
                        {result.items.map((it, i) => (
                          <li key={i}>
                            • {it.name}
                            {it.price && <span className="text-foreground font-medium"> {it.price}</span>}
                            {it.originalPrice && <s className="ml-1 opacity-60">{it.originalPrice}</s>}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Why flagged — the evidence */}
                    {result.evidence.length > 0 && (
                      <details className="group px-3 pb-2">
                        <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                          <Sparkles className="size-3" />
                          Why this was flagged ({result.evidence.length})
                        </summary>
                        <ul className="mt-1.5 space-y-1 border-l-2 border-border pl-3">
                          {result.evidence.map((ev, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <Quote className="mt-0.5 size-3 shrink-0 opacity-50" />
                              <span className="italic">{ev}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {/* Add to calendar — personal by default, user can choose */}
                    <div className="flex items-center gap-2 border-t border-border p-3">
                      <Select
                        value={selectedCalendar[result.sourceUrl] || defaultCalendarId}
                        onValueChange={(v) => {
                          if (typeof v === "string")
                            setSelectedCalendar((prev) => ({ ...prev, [result.sourceUrl]: v }));
                        }}
                      >
                        <SelectTrigger className="h-8 w-44 text-xs">
                          <SelectValue placeholder="Choose calendar">
                            {(value) => calendars.find((c) => c.id === value)?.name ?? "Choose calendar"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {calendars.map((c) => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {addedFor.has(result.sourceUrl) ? (
                        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle2 className="size-3.5" /> Added
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={() => openPreview(result)}
                          disabled={addingFor === result.sourceUrl || !defaultCalendarId}
                        >
                          {addingFor === result.sourceUrl ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <CalendarPlus className="size-3.5" />
                          )}
                          Add to calendar
                        </Button>
                      )}
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground/70" title="AI provider used">
                        via {result.aiUsed}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add custom source */}
          <div className="flex gap-2 pt-1">
            <Input
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSource()}
              placeholder="https://store.example.com"
              className="h-9 text-sm"
              aria-label="Add discount source URL"
            />
            <Button variant="outline" onClick={addSource} className="gap-1.5 shrink-0">
              <Plus className="size-4" /> Add source
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Detection works best on pages that render promotions in HTML. Heavily
        JavaScript-rendered or bot-protected sites may return errors or miss deals —
        try a specific sale/landing page URL for those.
      </p>

      {/* Preview the event before adding it to the calendar */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add discount to calendar</DialogTitle>
            <DialogDescription>Preview the event, choose a calendar, then add.</DialogDescription>
          </DialogHeader>
          {preview && (() => {
            const ev = buildEvent(preview, previewStart, previewEnd);
            const cal = selectedCalendar[preview.sourceUrl] || defaultCalendarId;
            return (
              <div className="space-y-3 text-sm">
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                  <p className="font-semibold">{ev.title}</p>
                  <p className="mt-0.5 text-xs font-medium text-primary">{ev.period} · {ev.location}</p>
                </div>

                {/* Editable time period */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Time period</label>
                  <div className="flex items-center gap-2">
                    <Input type="date" value={previewStart} max={previewEnd || undefined} onChange={(e) => setPreviewStart(e.target.value)} className="h-8 text-xs" />
                    <span className="text-xs text-muted-foreground">→</span>
                    <Input type="date" value={previewEnd} min={previewStart || undefined} onChange={(e) => setPreviewEnd(e.target.value)} className="h-8 text-xs" />
                  </div>
                </div>

                {/* Clickable discount URL */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Discount link</label>
                  <a
                    href={preview.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 truncate rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5 shrink-0" />
                    <span className="truncate">{preview.sourceUrl}</span>
                  </a>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Calendar</label>
                  <Select value={cal} onValueChange={(v) => { if (typeof v === "string") setSelectedCalendar((prev) => ({ ...prev, [preview.sourceUrl]: v })); }}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose calendar">
                        {(value) => calendars.find((c) => c.id === value)?.name ?? "Choose calendar"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {calendars.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="inline-block size-2.5 rounded-full" style={{ background: c.color }} />
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Details</label>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 font-sans text-xs leading-relaxed text-foreground/90">{ev.description}</pre>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            <Button className="gap-1.5" onClick={confirmAdd} disabled={!!addingFor}>
              {addingFor ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarPlus className="size-3.5" />}
              Add to calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
