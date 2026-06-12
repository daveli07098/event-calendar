"use client";

import { useState, useEffect } from "react";
import {
  BadgePercent, RefreshCw, Loader2, Plus, Trash2, ExternalLink,
  CalendarPlus, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { CalendarType } from "@/types";

interface DiscountResult {
  hasDiscount: boolean;
  title: string | null;
  discountSummary: string | null;
  discountPercent: string | null;
  promoCode: string | null;
  startDate: string | null;
  endDate: string | null;
  items: Array<{ name: string; price: string | null; originalPrice: string | null }>;
  sourceUrl: string;
  aiUsed: string;
  tokensUsed: number | null;
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

  const addToCalendar = async (result: DiscountResult) => {
    const calendarId = selectedCalendar[result.sourceUrl] || defaultCalendarId;
    if (!calendarId) {
      toast.error("No calendar available");
      return;
    }
    const domain = domainOf(result.sourceUrl);
    const today = new Date().toISOString().slice(0, 10);
    const startDate = result.startDate ?? today;
    const endDate = result.endDate ?? startDate;

    const descriptionLines = [
      result.discountSummary,
      result.promoCode ? `Promo code: ${result.promoCode}` : null,
      ...result.items.map(
        (it) =>
          `• ${it.name}${it.price ? ` — ${it.price}` : ""}${it.originalPrice ? ` (was ${it.originalPrice})` : ""}`
      ),
      `Source: ${result.sourceUrl}`,
    ].filter(Boolean);

    setAddingFor(result.sourceUrl);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `🏷️ ${result.title ?? `${domain} discount`}`,
          description: descriptionLines.join("\n"),
          location: domain,
          startTime: `${startDate}T00:00:00`,
          endTime: `${endDate}T23:59:00`,
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
                    <Badge className="text-xs gap-1">
                      <BadgePercent className="size-3" />
                      {result.discountPercent ?? "Sale"}
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

                {/* Discount preview */}
                {result?.hasDiscount && (
                  <div className="border-t border-border p-3 space-y-2 bg-muted/20">
                    <p className="font-medium text-sm">{result.title ?? "Sale"}</p>
                    {result.discountSummary && (
                      <p className="text-sm text-muted-foreground">{result.discountSummary}</p>
                    )}
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {result.promoCode && (
                        <Badge variant="outline" className="font-mono text-xs">
                          {result.promoCode}
                        </Badge>
                      )}
                      {(result.startDate || result.endDate) && (
                        <span>
                          {result.startDate ?? "now"} → {result.endDate ?? "until further notice"}
                        </span>
                      )}
                      <span className="font-mono">{result.aiUsed}</span>
                    </div>
                    {result.items.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {result.items.map((it, i) => (
                          <li key={i}>
                            • {it.name}
                            {it.price && <span className="text-foreground font-medium"> {it.price}</span>}
                            {it.originalPrice && <s className="ml-1 opacity-60">{it.originalPrice}</s>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* Add to calendar — personal by default, user can choose */}
                    <div className="flex items-center gap-2 pt-1">
                      <Select
                        value={selectedCalendar[result.sourceUrl] || defaultCalendarId}
                        onValueChange={(v) => {
                          if (typeof v === "string")
                            setSelectedCalendar((prev) => ({ ...prev, [result.sourceUrl]: v }));
                        }}
                      >
                        <SelectTrigger className="h-8 w-44 text-xs">
                          <SelectValue placeholder="Choose calendar" />
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
                          onClick={() => addToCalendar(result)}
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
    </div>
  );
}
