"use client";

import { useState, useEffect, useRef } from "react";
import {
  BadgePercent, RefreshCw, Loader2, Plus, Trash2, ExternalLink,
  CalendarPlus, CheckCircle2, AlertCircle, Copy, Check, Quote, Tag, Users, Sparkles, Clock, XCircle,
  ClipboardPaste,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAbortableRequest } from "@/lib/use-abortable-request";
import { mutate } from "@/lib/mutate";
import type { CalendarType } from "@/types";
import type { DiscountScanResult, DiscountScanErrorReason } from "@/lib/discounts/types";
import { PAGE_MESSAGE_TYPE, READY_MESSAGE_TYPE } from "@/lib/discounts/bookmarklet";
import { BookmarkletInstall } from "@/components/tickets/BookmarkletInstall";

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

/**
 * Parses a "YYYY-MM-DD" as a date-only value in the device's local timezone,
 * or null when it isn't a real, strict "YYYY-MM-DD" calendar date.
 * `new Date("YYYY-MM-DD")` parses as UTC midnight, which shifts a day
 * backwards in any timezone west of UTC — split the string instead.
 *
 * The server (route.ts's isoDateOnly()) already rejects anything but a
 * strict, real calendar date before persisting a fresh scan result — but
 * results are also persisted verbatim in localStorage, so an entry saved
 * before that server-side guard existed (an AI-returned "Ongoing"/"TBD"/
 * "Sept 2026") can still be sitting there. Returning null here instead of an
 * Invalid Date lets formatValidity() skip it instead of crash-looping the
 * whole section on every mount via Intl.DateTimeFormat.
 */
function parseDateOnly(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const [, yStr, moStr, dStr] = m;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  const date = new Date(y, mo - 1, d);
  const isReal = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return isReal ? date : null;
}

/** YYYY-MM-DD in the device's local calendar, for seeding date-only inputs. */
function localDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const CHIP_DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/**
 * "Until 30 Sep" / "15–30 Sep" validity chip from a startDate/endDate pair.
 * Either value can be an invalid/non-calendar string on an already-persisted
 * result (see parseDateOnly()) — an invalid side is skipped rather than fed
 * to Intl.DateTimeFormat, which throws a RangeError on an Invalid Date.
 */
function formatValidity(startDate: string | null, endDate: string | null): string | null {
  const start = startDate ? parseDateOnly(startDate) : null;
  const end = endDate ? parseDateOnly(endDate) : null;
  if (!start && !end) return null;
  const fmt = new Intl.DateTimeFormat(undefined, CHIP_DATE_FORMAT);
  if (start && end && startDate !== endDate) {
    if (typeof fmt.formatRange === "function") return fmt.formatRange(start, end);
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  }
  const only = end ?? start;
  if (!only) return null;
  return `Until ${fmt.format(only)}`;
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Whether a scan result is old enough to show its badge muted. */
function isStale(checkedAt: string): boolean {
  return Date.now() - Date.parse(checkedAt) > STALE_AFTER_MS;
}

/** "Checked 2h ago" / "Checked just now" relative-time label for a scan timestamp. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
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
  | { state: "done"; result: DiscountScanResult; checkedAt: string /* ISO */ }
  // `reason` is optional — older cached errors / a server that hasn't
  // deployed it yet never had one; always treat its absence as "unknown,
  // generic failure" (see DiscountScanErrorReason in lib/discounts/types).
  | { state: "error"; message: string; reason?: DiscountScanErrorReason };

// The scanner reads server-rendered HTML only — a storefront is only useful
// as a default if its promo text is actually present in the markup, not
// injected client-side after load. Measured against the app's own text
// extraction: nike.com's global page is US-facing and nearly textless;
// nike.com/hk and hk.puma.com are JavaScript-rendered shells with no
// readable server-side text; adidas.com / adidas.com.hk and fanatics.com are
// permanently Akamai-blocked. The three below all extracted real, readable
// promo text — GigaSports (same hkstore.com platform as Marathon Sports) is
// the one route that still surfaces adidas markdowns despite adidas.com
// itself being unreachable.
const DEFAULT_SOURCES = [
  "https://marathonsports.hkstore.com/marathon_tc_hk/",
  "https://gigasports.hkstore.com/gigasports_tc_hk/",
  "https://www.skechers.com.hk/",
];

// Mirrors the server's pasted-content cap (see DiscountScanErrorReason's
// "content_too_large") — drives the dialog's live character count. Not
// enforced client-side with a hard `maxLength`: a paste over the cap still
// submits, the count just turns red, and the server's "content_too_large"
// error surfaces inline (see scanSource) so the user knows exactly why and
// can trim it, instead of a silent truncation they'd never notice.
const PASTE_CONTENT_MAX_CHARS = 400_000;

const CUSTOM_SOURCES_KEY = "discount-sources";
/** Persisted scan results, keyed by source URL, so a reload doesn't wipe them. */
const RESULTS_KEY = "discount-results";
type StoredResults = Record<string, { result: DiscountScanResult; checkedAt: string }>;

/**
 * Narrows an unknown localStorage-parsed value to a `DiscountScanResult`.
 * Storage can hold a stale shape from a previous schema (or arbitrary junk if
 * tampered with), and the render path indexes straight into `.offers.length`
 * etc. without further checks — a malformed entry here would otherwise throw
 * and take down the whole section, so entries that fail this are dropped.
 */
function isDiscountScanResult(v: unknown): v is DiscountScanResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.hasDiscount === "boolean" &&
    typeof r.sourceUrl === "string" &&
    typeof r.aiUsed === "string" &&
    Array.isArray(r.offers) &&
    Array.isArray(r.items) &&
    Array.isArray(r.categories) &&
    Array.isArray(r.evidence) &&
    (r.url === null || r.url === undefined || typeof r.url === "string")
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Short muted path hint ("/hk/w/sale-3yaep") for a source row. `domainOf()`
 * alone renders two sources on the same host identically (e.g. a custom
 * "https://www.nike.com/" root alongside the "nike.com/hk/w/sale-3yaep"
 * default) — this makes them visually distinguishable. Omitted when the path
 * is just "/", and truncated so a long query string doesn't blow out the row.
 */
function pathHintOf(url: string): string | null {
  try {
    const { pathname, search } = new URL(url);
    const full = `${pathname}${search}`;
    if (!full || full === "/") return null;
    return full.length > 20 ? `${full.slice(0, 20)}…` : full;
  } catch {
    return null;
  }
}

/** Account-backed store for custom sources — GET on mount, PUT on add/remove. */
const SOURCES_API = "/api/discounts/sources";

export function DiscountSection({ onQuotaUpdate }: { onQuotaUpdate?: (q: { used: number; limit: number; remaining: number }) => void }) {
  const [customSources, setCustomSources] = useState<string[]>([]);
  const [newSource, setNewSource] = useState("");
  const [statuses, setStatuses] = useState<Record<string, SourceStatus>>({});
  const [checkingAll, setCheckingAll] = useState(false);
  // Aggregate progress for the sequential "Check all" loop — shown as
  // "Checking N/M…" next to the button since it can run for minutes.
  const [checkAllProgress, setCheckAllProgress] = useState<{ index: number; total: number; url: string } | null>(null);
  // Set by cancelCheckAll() to stop the loop cleanly after the in-flight
  // request aborts, instead of racing ahead into the remaining sources.
  const stopCheckAllRef = useRef(false);
  // Keyed by source URL so concurrent per-row scans and the sequential
  // "Check all" loop can each be cancelled/timed out independently.
  const { start: startAbortable, cancel: cancelSource } = useAbortableRequest(45_000);
  const [calendars, setCalendars] = useState<CalendarType[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState<Record<string, string>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiscountScanResult | null>(null);
  const [previewStart, setPreviewStart] = useState(""); // YYYY-MM-DD, editable in the dialog
  const [previewEnd, setPreviewEnd] = useState("");
  const [addedFor, setAddedFor] = useState<Set<string>>(new Set());
  // Source URL currently open in the "paste page" dialog (some sites block a
  // server-side fetch entirely, or only render their content client-side —
  // pasting lets the user's own browser stand in for the fetch).
  const [pasteDialogFor, setPasteDialogFor] = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  // Inline message for a fixable paste problem ("content_too_large" /
  // "empty_content") — shown in the dialog instead of closing it and writing
  // an error row, so the user can trim/reselect the paste and resubmit.
  const [pasteError, setPasteError] = useState<string | null>(null);
  // Screen-reader-only status line for scan lifecycle transitions.
  const [announcement, setAnnouncement] = useState("");
  // True once the mount-time GET to the account-backed sources API has failed
  // (offline/401/500) and we've fallen back to the localStorage copy — drives
  // the small "Saved on this device only" note near the Add-source input.
  const [sourcesLocalOnly, setSourcesLocalOnly] = useState(false);
  // Guards the results-persistence effect from firing (and clobbering storage
  // with an empty `statuses`) before the post-mount restore below has run.
  const hydratedResultsRef = useRef(false);
  // A page handed over by the "Scan with Event Calendar" bookmarklet (see
  // bookmarklet.ts + the receiver effect below) — shown as a confirmation
  // strip instead of auto-scanning, so a spoofed/unwanted message can never
  // trigger a scan (and spend AI quota) without the user clicking through.
  const [received, setReceived] = useState<{ url: string; title: string; html: string } | null>(null);
  // Guards the message listener so only the first valid ec-discount-page
  // message this mount receives is ever accepted — a second one (e.g. a
  // stale/duplicate post) is ignored rather than clobbering the strip.
  const receivedAcceptedRef = useRef(false);

  const sources = [...DEFAULT_SOURCES, ...customSources];

  // Load prior scan results after mount — localStorage isn't available during
  // SSR and reading it in a useState initializer would cause a hydration
  // mismatch, so the post-mount setState is intentional here. Filtered
  // against this device's last-known custom sources (defaults + whatever was
  // in localStorage); the account-backed sources effect below may broaden
  // `customSources` further once its GET resolves, which only ever *adds* to
  // the known-source set, so it can't orphan anything restored here.
  useEffect(() => {
    let loadedCustom: string[] = [];
    try {
      const saved = localStorage.getItem(CUSTOM_SOURCES_KEY);
      if (saved) loadedCustom = JSON.parse(saved);
    } catch {
      // Corrupt storage — start with defaults only
    }

    try {
      const savedResults = localStorage.getItem(RESULTS_KEY);
      if (savedResults) {
        // Untrusted until each entry passes isDiscountScanResult() below —
        // storage can hold a stale/foreign schema or tampered JSON.
        const parsed: Record<string, { result?: unknown; checkedAt?: unknown }> = JSON.parse(savedResults);
        const knownSources = new Set([...DEFAULT_SOURCES, ...loadedCustom]);
        const restored: Record<string, SourceStatus> = {};
        for (const [url, entry] of Object.entries(parsed)) {
          const checkedAt = entry?.checkedAt;
          const validCheckedAt = typeof checkedAt === "string" && !Number.isNaN(Date.parse(checkedAt));
          if (knownSources.has(url) && validCheckedAt && isDiscountScanResult(entry?.result)) {
            // Normalise a missing/undefined `url` to null rather than leaking
            // `undefined` past the type boundary into the rest of the component.
            const result: DiscountScanResult = { ...entry.result, url: entry.result.url ?? null };
            restored[url] = { state: "done", result, checkedAt };
          }
        }
        if (Object.keys(restored).length) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setStatuses((prev) => ({ ...restored, ...prev }));
        }
      }
    } catch {
      // Corrupt storage — start with no restored results
    }
    hydratedResultsRef.current = true;
  }, []);

  // Custom sources are account-backed (`GET`/`PUT` SOURCES_API) so they survive
  // a different browser/device — localStorage is only an offline mirror now.
  // On mount: GET the server list. If this device's localStorage held custom
  // sources the server doesn't know about (added before this migration, or on
  // a device that never synced), PUT the union up once so they aren't
  // silently dropped, then use whatever the server confirms. On failure
  // (offline/401/500) fall back to the localStorage list exactly as before.
  useEffect(() => {
    let cancelled = false;
    let localSources: string[] = [];
    try {
      const saved = localStorage.getItem(CUSTOM_SOURCES_KEY);
      if (saved) localSources = JSON.parse(saved);
    } catch {
      // Corrupt storage — start with [] below
    }
    // Show the localStorage copy immediately so the list isn't empty while
    // the network round-trip is in flight; superseded below once it resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localSources.length) setCustomSources(localSources);

    (async () => {
      try {
        const res = await fetch(SOURCES_API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { sources?: unknown } = await res.json();
        const serverSources = Array.isArray(data.sources)
          ? data.sources.filter((s): s is string => typeof s === "string")
          : [];
        const missing = localSources.filter((s) => !serverSources.includes(s));
        let finalSources = serverSources;
        let migrationFailed = false;
        if (missing.length) {
          const union = [...serverSources, ...missing];
          try {
            const putRes = await fetch(SOURCES_API, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sources: union }),
            });
            if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`);
            const putData: { sources?: unknown } = await putRes.json();
            finalSources = Array.isArray(putData.sources)
              ? putData.sources.filter((s): s is string => typeof s === "string")
              : union;
          } catch {
            // Migration PUT failed after a successful GET — this is exactly
            // the "why didn't my source save?" bug the user hit, just at
            // mount time instead of on add/remove. Don't swallow it: fall
            // back to the union locally (so it still renders this session)
            // and surface it the same way an offline GET would.
            finalSources = union;
            migrationFailed = true;
          }
        }
        if (cancelled) return;
        setCustomSources(finalSources);
        if (migrationFailed) {
          setSourcesLocalOnly(true);
          toast.error("Couldn't save your sources");
        } else {
          setSourcesLocalOnly(false);
        }
        try {
          localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(finalSources));
        } catch {
          // Storage unavailable — sources last for the session only
        }
      } catch {
        // Offline / unauthenticated / server error — the localStorage list
        // applied above (if any) is all we have this session.
        if (!cancelled) setSourcesLocalOnly(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist scan results per source so a reload doesn't wipe them — only
  // "done" entries, and only for sources still in the list, keeping storage
  // bounded as sources are added/removed.
  useEffect(() => {
    if (!hydratedResultsRef.current) return;
    try {
      const toStore: StoredResults = {};
      for (const url of sources) {
        const status = statuses[url];
        if (status?.state === "done") {
          toStore[url] = { result: status.result, checkedAt: status.checkedAt };
        }
      }
      localStorage.setItem(RESULTS_KEY, JSON.stringify(toStore));
    } catch {
      // Storage unavailable — results last for the session only
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, customSources]);

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

  // Receiving end of the "Scan with Event Calendar" bookmarklet (see
  // BookmarkletInstall / bookmarklet.ts): when this page was opened with
  // `?receive=1` (the bookmarklet's window.open target), ping window.opener
  // to say we're ready, then accept exactly one ec-discount-page message —
  // validated hard, since it's untrusted input from an arbitrary shop page's
  // script, not something the AI or server ever gets to see first:
  //   - shape: right `type`/`v`, `url` is http(s), `html` is a non-empty
  //     string under the same cap the paste dialog enforces
  //   - anti-spoofing: `url`'s hostname must equal the hostname of
  //     `event.origin` — the message's *actual* sender, which postMessage
  //     sets and a page can't fake — so a malicious page can't claim to be
  //     e.g. fanatics.com while actually posting from evil.example.
  // On accept: stash it for the confirmation strip below (never auto-scan —
  // that would spend AI quota on an unreviewed page) and strip `receive=1`
  // from the URL so a reload doesn't re-arm the listener for nothing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("receive") !== "1") return;

    if (window.opener) {
      try {
        (window.opener as Window).postMessage({ type: READY_MESSAGE_TYPE, v: 1 }, "*");
      } catch {
        // Opener gone, or a cross-origin quirk on an unusual embedder — the
        // bookmarklet's own handshake timeout covers this case either way.
      }
    }

    const onMessage = (event: MessageEvent) => {
      if (receivedAcceptedRef.current) return;
      const data = event.data as { type?: unknown; v?: unknown; url?: unknown; title?: unknown; html?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type !== PAGE_MESSAGE_TYPE || data.v !== 1) return;
      if (typeof data.url !== "string" || !/^https?:\/\//i.test(data.url)) return;
      if (typeof data.html !== "string" || data.html.length === 0 || data.html.length > PASTE_CONTENT_MAX_CHARS) return;
      let urlHost: string;
      let originHost: string;
      try {
        urlHost = new URL(data.url).hostname;
        originHost = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (!urlHost || urlHost !== originHost) return;

      receivedAcceptedRef.current = true;
      window.removeEventListener("message", onMessage);
      setReceived({ url: data.url, title: typeof data.title === "string" ? data.title : "", html: data.html });
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("receive");
        window.history.replaceState(null, "", u.toString());
      } catch {
        // Non-fatal — the strip below still renders either way.
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const receivedDomain = received ? domainOf(received.url) : null;
  // Match by host, not exact string — the bookmarklet posts the tab's exact
  // location.href, which can differ from a saved source's URL by a trailing
  // slash, query string, or path.
  const receivedMatch = received ? (sources.find((s) => domainOf(s) === receivedDomain) ?? null) : null;
  const receivedSizeKB = received ? Math.max(1, Math.round(received.html.length / 1024)) : 0;

  // localStorage is now only an offline mirror of the account-backed list —
  // does not touch React state itself, so callers control the optimistic
  // update (see addSource/removeSource below).
  const persistCustomSourcesLocally = (next: string[]) => {
    try {
      localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — sources last for the session only
    }
  };

  /** `new URL(u).toString()`, or the raw string if it doesn't parse. */
  const normalizeUrl = (u: string): string => {
    try {
      return new URL(u).toString();
    } catch {
      return u;
    }
  };

  // Shared PUT + optimistic-update + rollback for appending one normalised
  // URL to the account-backed custom-sources list — used by both the manual
  // "Add source" input (addSource) and the bookmarklet strip's "Add as
  // source & scan" path (scanReceived) below, so the two can't drift.
  const addCustomSource = async (normalized: string): Promise<boolean> => {
    const previous = customSources;
    const next = [...customSources, normalized];
    const { ok } = await mutate(SOURCES_API, {
      method: "PUT",
      body: { sources: next },
      optimisticUpdate: () => {
        setCustomSources(next);
        persistCustomSourcesLocally(next);
      },
      rollback: () => {
        setCustomSources(previous);
        persistCustomSourcesLocally(previous);
      },
      silent: true,
    });
    if (!ok) toast.error("Couldn't save your sources");
    return ok;
  };

  const addSource = async () => {
    const url = newSource.trim();
    if (!url) return;
    let normalized: string;
    try {
      normalized = new URL(url.startsWith("http") ? url : `https://${url}`).toString();
    } catch {
      toast.error("Invalid URL");
      return;
    }
    // Compare normalised forms against both defaults and custom sources, so
    // e.g. adding "nike.com" when "https://www.nike.com/" is already a source
    // is caught as a duplicate even though the raw strings differ (missing
    // scheme, trailing slash, etc).
    const normalizedExisting = new Set(sources.map(normalizeUrl));
    if (normalizedExisting.has(normalized)) {
      toast.info("Source already in the list");
      return;
    }
    setNewSource("");
    await addCustomSource(normalized);
  };

  const removeSource = async (url: string) => {
    const previous = customSources;
    const next = customSources.filter((s) => s !== url);
    const { ok } = await mutate(SOURCES_API, {
      method: "PUT",
      body: { sources: next },
      optimisticUpdate: () => {
        setCustomSources(next);
        persistCustomSourcesLocally(next);
        setStatuses((prev) => {
          const n = { ...prev };
          delete n[url];
          return n;
        });
      },
      rollback: () => {
        setCustomSources(previous);
        persistCustomSourcesLocally(previous);
      },
      silent: true,
    });
    if (!ok) toast.error("Couldn't save your sources");
  };

  // `pageContent`, when passed, is a user-pasted page (HTML or plain text) —
  // the server skips its own fetch and runs the same AI extraction on it
  // instead. Every other transition below (status shape, abortable/timeout
  // plumbing, result rendering, quota callback, localStorage persistence via
  // the `statuses` effect) is shared with a normal URL-only scan; the paste
  // dialog is only special-cased for the two fixable input-problem reasons.
  const scanSource = async (url: string, pageContent?: string): Promise<void> => {
    const isPaste = pageContent !== undefined;
    // What this row showed before this attempt — restored verbatim if the
    // paste turns out to be too large/empty, so that failure never clobbers
    // whatever the row previously displayed with a spurious error state.
    const priorStatus = statuses[url] ?? { state: "idle" };
    setStatuses((prev) => ({ ...prev, [url]: { state: "scanning" } }));
    setAnnouncement(`Scanning ${domainOf(url)}…`);
    const signal = startAbortable(url);
    try {
      const res = await fetch("/api/discounts/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isPaste ? { url, pageContent } : { url }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) {
        // `reason` is a newer, optional field — tolerate its absence for
        // older cached responses or a server that hasn't deployed it yet.
        const reason: DiscountScanErrorReason | undefined = typeof data?.reason === "string" ? data.reason : undefined;
        // A paste that's too large or reads as empty is a fixable input
        // problem, not a scan failure — keep the dialog open with the
        // server's message inline so the user can fix the paste, instead of
        // closing it and writing an error row over this source.
        if (isPaste && (reason === "content_too_large" || reason === "empty_content")) {
          setStatuses((prev) => ({ ...prev, [url]: priorStatus }));
          setPasteError(data.error ?? "Couldn't read that paste");
          setAnnouncement(data.error ?? `Couldn't read the pasted page for ${domainOf(url)}`);
          return;
        }
        setStatuses((prev) => ({ ...prev, [url]: { state: "error", message: data.error ?? `HTTP ${res.status}`, reason } }));
        // A site we can never read isn't a failed scan — announce it the same
        // way the row renders it, so screen-reader users aren't told to retry.
        setAnnouncement(
          reason === "bot_protected" || reason === "corporate_redirect" || reason === "thin_content"
            ? `Can't scan ${domainOf(url)}`
            : `Scan failed for ${domainOf(url)}`
        );
        if (isPaste) closePasteDialog();
        return;
      }
      const result: DiscountScanResult = data.result;
      setStatuses((prev) => ({ ...prev, [url]: { state: "done", result, checkedAt: new Date().toISOString() } }));
      setAnnouncement(`Found ${result.offers.length} offers on ${domainOf(url)}`);
      if (data.aiQuota) onQuotaUpdate?.(data.aiQuota);
      if (isPaste) closePasteDialog();
    } catch {
      if (signal.aborted && signal.reason === "superseded") {
        // A newer request for this same source (e.g. from "Check all" moving
        // on, or another click) already took over — that request owns this
        // row's status now. Writing here would race it and can clobber a
        // just-arrived "done"/"scanning" state with a false "Network error".
        return;
      }
      if (signal.aborted && signal.reason === "cancel") {
        // User cancelled — back to idle rather than showing an error state.
        setStatuses((prev) => ({ ...prev, [url]: { state: "idle" } }));
        return;
      }
      if (signal.aborted && signal.reason === "timeout") {
        setStatuses((prev) => ({ ...prev, [url]: { state: "error", message: "This took too long — the AI provider may be busy" } }));
        setAnnouncement(`Scan failed for ${domainOf(url)}`);
        if (isPaste) closePasteDialog();
        return;
      }
      setStatuses((prev) => ({ ...prev, [url]: { state: "error", message: "Network error" } }));
      setAnnouncement(`Scan failed for ${domainOf(url)}`);
      if (isPaste) closePasteDialog();
    }
  };

  /** Opens the "paste page" dialog for `url`, clearing any previous paste. */
  const openPasteDialog = (url: string) => {
    setPasteDialogFor(url);
    setPasteContent("");
    setPasteError(null);
  };

  const closePasteDialog = () => {
    setPasteDialogFor(null);
    setPasteContent("");
    setPasteError(null);
  };

  const dismissReceived = () => setReceived(null);

  // Confirm action for the bookmarklet's confirmation strip: scans the
  // received HTML via the same paste path as the "Paste page" dialog
  // (scanSource(url, pageContent)) — matched-by-host source row if there is
  // one, otherwise saves it as a new custom source first so the result has
  // somewhere to land. Never fires automatically on message receipt: only
  // this explicit click spends AI quota.
  const scanReceived = async () => {
    if (!received) return;
    const page = received;
    setReceived(null);
    if (receivedMatch) {
      await scanSource(receivedMatch, page.html);
      return;
    }
    const normalized = normalizeUrl(page.url);
    const normalizedExisting = new Set(sources.map(normalizeUrl));
    if (!normalizedExisting.has(normalized)) {
      await addCustomSource(normalized);
    }
    await scanSource(normalized, page.html);
  };

  /** Cancel whichever source is currently scanning (single "Check" or "Check all" loop). */
  const cancelScan = (url: string) => {
    if (checkingAll && checkAllProgress?.url === url) stopCheckAllRef.current = true;
    cancelSource(url);
  };

  // Sequential on purpose — free-tier AI providers are RPM-limited
  const checkAll = async () => {
    setCheckingAll(true);
    stopCheckAllRef.current = false;
    for (const [i, url] of sources.entries()) {
      if (stopCheckAllRef.current) break;
      setCheckAllProgress({ index: i + 1, total: sources.length, url });
      await scanSource(url);
      if (stopCheckAllRef.current) break;
    }
    setCheckingAll(false);
    setCheckAllProgress(null);
  };

  /** Stop the "Check all" loop after the current in-flight request aborts. */
  const cancelCheckAll = () => {
    stopCheckAllRef.current = true;
    if (checkAllProgress) cancelSource(checkAllProgress.url);
  };

  // Build the full calendar-event payload + display fields for a discount,
  // using the (possibly user-edited) start/end dates from the preview dialog.
  const buildEvent = (result: DiscountScanResult, startDate: string, endDate: string) => {
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
      // Only worth a second line when the detected deep link differs from the
      // scanned source; otherwise the two would just repeat each other.
      result.url && result.url !== result.sourceUrl ? `🔗 Discount URL: ${result.url}` : null,
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
  const openPreview = (result: DiscountScanResult) => {
    // Local calendar date, not toISOString() — that is the UTC date, which is
    // still "yesterday" for a Hong Kong user until 08:00.
    const today = localDateOnly(new Date());
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
      {/* Screen-reader-only announcement of scan lifecycle transitions — the
          visual badges/spinners convey the same info sighted users. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
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

      {/* Confirmation strip for a page handed over by the "Scan with Event
          Calendar" bookmarklet — never auto-scans (see scanReceived's
          comment); this is the only way that page's content gets used. */}
      {received && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <ClipboardPaste className="size-4 shrink-0 text-primary" />
          <span>
            Received page from <strong>{receivedDomain}</strong> ({receivedSizeKB} KB)
            {!receivedMatch && (
              <span className="text-muted-foreground"> — not yet in your sources</span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={scanReceived}>
              <RefreshCw className="size-3.5" />
              {receivedMatch ? "Scan now" : "Add as source & scan"}
            </Button>
            <Button variant="ghost" size="sm" onClick={dismissReceived}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Sources</CardTitle>
              <CardDescription>Sites checked for discounts</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {checkingAll && checkAllProgress && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Checking {checkAllProgress.index}/{checkAllProgress.total}…
                </span>
              )}
              {checkingAll && (
                <Button variant="outline" size="sm" onClick={cancelCheckAll} className="gap-1.5">
                  <XCircle className="size-3.5" />
                  Cancel
                </Button>
              )}
              <Button onClick={checkAll} disabled={checkingAll} className="gap-2">
                {checkingAll ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Check all
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sources.map((url) => {
            const status = statuses[url] ?? { state: "idle" };
            const isCustom = customSources.includes(url);
            const result = status.state === "done" ? status.result : null;
            const stale = status.state === "done" && isStale(status.checkedAt);
            const pathHint = pathHintOf(url);
            // "bot_protected" / "corporate_redirect" are permanent, server-side
            // facts about the site (Akamai, a corporate redirect), not a
            // transient bug — render them muted/amber, never as an alarming
            // red "Failed". Re-checking either can never succeed — a bot wall
            // still blocks the next request, and a corporate redirect just
            // redirects again — so both get "Open site" instead of Re-check.
            const cantScan =
              status.state === "error" &&
              (status.reason === "bot_protected" ||
                status.reason === "corporate_redirect" ||
                status.reason === "thin_content");
            // A JS-rendered page keeps Re-check (it can come back, and another
            // path on the same site may render server-side) but still reads as
            // "can't scan" rather than a red failure.
            const unfetchable =
              status.state === "error" &&
              (status.reason === "bot_protected" || status.reason === "corporate_redirect");
            return (
              <div key={url} className="rounded-lg border border-border">
                {/* Source row — wraps to a second line on narrow (≈390px) viewports
                    instead of overflowing, since a badge + two buttons don't fit
                    alongside a long hostname on one line. */}
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <span className="font-medium text-sm min-w-0 flex-1 truncate" title={url}>
                    <span>{domainOf(url)}</span>
                    {pathHint && <span className="ml-1 font-normal text-muted-foreground">{pathHint}</span>}
                  </span>
                  {status.state === "done" && !result?.hasDiscount && (
                    <Badge variant="secondary" className="text-xs">No discount found</Badge>
                  )}
                  {result?.hasDiscount && (
                    <Badge
                      variant={stale ? "secondary" : "default"}
                      className={cn("text-xs gap-1", stale && "opacity-70")}
                      title={result.confidence ? `${result.confidence} confidence` : undefined}
                    >
                      <BadgePercent className="size-3" />
                      {result.discountPercent ?? "Sale"}
                      {result.offers.length > 1 && (
                        <span className="opacity-80">· {result.offers.length} offers</span>
                      )}
                    </Badge>
                  )}
                  {status.state === "done" && (
                    <span className="text-[11px] text-muted-foreground" title={status.checkedAt}>
                      Checked {relativeTime(status.checkedAt)}
                      {status.result.fromPastedContent && (
                        <span className="ml-1 italic">· from pasted page</span>
                      )}
                    </span>
                  )}
                  {status.state === "error" && (
                    <span className={cn("flex items-center gap-1 text-xs", cantScan ? "text-amber-600 dark:text-amber-400" : "text-destructive")}>
                      <AlertCircle className="size-3.5 shrink-0" />
                      {cantScan ? "Can't scan" : "Failed"}
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
                  {/* Small, always-available paste affordance — separate from the
                      primary "Paste page" button below (which only appears on a
                      can't-scan row) so a source that merely returned a poor
                      result (e.g. thin_content that technically "succeeded") can
                      still be re-scanned from a pasted page, without a second
                      button in every row's main action area. */}
                  <button
                    type="button"
                    onClick={() => openPasteDialog(url)}
                    aria-label={`Paste page content for ${domainOf(url)}`}
                    title="Paste page content instead"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ClipboardPaste className="size-3.5" />
                  </button>
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
                  {unfetchable ? (
                    <>
                      {/* Re-checking can never succeed for either reason — link
                          straight to the site instead of offering a dead-end button. */}
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
                      >
                        <ExternalLink className="size-3.5" />
                        Open site
                      </a>
                      {/* The primary way forward for a site we can never fetch
                          server-side — paste it in instead. */}
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => openPasteDialog(url)}
                      >
                        <ClipboardPaste className="size-3.5" />
                        Paste page
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => (status.state === "scanning" ? cancelScan(url) : scanSource(url))}
                        disabled={status.state !== "scanning" && checkingAll}
                      >
                        {status.state === "scanning" ? (
                          <><Loader2 className="size-3.5 animate-spin" />Cancel</>
                        ) : (
                          <>
                            <RefreshCw className="size-3.5" />
                            {status.state === "done" || status.state === "error" ? "Re-check" : "Check"}
                          </>
                        )}
                      </Button>
                      {/* thin_content keeps Re-check (see the comment above) but
                          is still a can't-scan row — offer the same primary
                          paste path alongside it. */}
                      {cantScan && (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => openPasteDialog(url)}
                        >
                          <ClipboardPaste className="size-3.5" />
                          Paste page
                        </Button>
                      )}
                    </>
                  )}
                </div>

                {/* Full error text as its own row — touch users have no hover for a
                    title tooltip, so this can no longer be truncated-with-title only. */}
                {status.state === "error" && (
                  <div className={cn("px-3 pb-3", cantScan ? "text-amber-600 dark:text-amber-400" : "text-destructive")}>
                    <p className="break-words text-xs">{status.message}</p>
                    {/* A site we can never fetch server-side is exactly what the
                        bookmarklet is for — offer the one-click install inline,
                        right where the user just learned they need it. */}
                    {cantScan && <BookmarkletInstall compact />}
                  </div>
                )}

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
                      {formatValidity(result.startDate, result.endDate) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                          <Clock className="size-3" />
                          {formatValidity(result.startDate, result.endDate)}
                        </span>
                      )}
                      {(() => {
                        const d = daysUntil(result.endDate);
                        return d !== null ? (
                          <span className={cn("inline-flex items-center gap-1", d <= 3 && "text-amber-600 dark:text-amber-400 font-medium")}>
                            <Clock className="size-3" />
                            {d === 0 ? "Ends today" : `${d} day${d === 1 ? "" : "s"} left`}
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
                                {o.url && (
                                  <a
                                    href={o.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open ${o.label} page`}
                                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                  >
                                    <ExternalLink className="size-3" />
                                    View offer
                                  </a>
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
                            •{" "}
                            {it.url ? (
                              <a
                                href={it.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                {it.name}
                              </a>
                            ) : (
                              it.name
                            )}
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
          {sourcesLocalOnly && (
            <p className="text-xs text-muted-foreground">Saved on this device only</p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Detection works best on pages that render promotions in HTML. Sites that
        build themselves with JavaScript, or block automated requests, can&apos;t be read
        from a server at all — open one in your browser and use Paste page instead.
      </p>

      <BookmarkletInstall />

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

                {/* Clickable discount URL — prefer the headline deep link over the plain source */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Discount link</label>
                  <a
                    href={preview.url ?? preview.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 truncate rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5 shrink-0" />
                    <span className="truncate">{preview.url ?? preview.sourceUrl}</span>
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

      {/* Paste a page's content in for sites a server-side fetch can never read
          (bot-protected, corporate-redirected) or only reads a client-rendered
          shell of (thin_content) — mirrors the "Add discount to calendar"
          preview dialog above: base-ui Dialog primitives, open/onOpenChange
          driven by a single "which source" piece of state. */}
      <Dialog open={!!pasteDialogFor} onOpenChange={(o) => { if (!o) closePasteDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Paste {pasteDialogFor ? domainOf(pasteDialogFor) : "page"}</DialogTitle>
            <DialogDescription>
              Some sites block automated requests, or only render their promos
              after the page loads in a real browser — paste what you see
              there and we&apos;ll scan that instead.
            </DialogDescription>
          </DialogHeader>
          {pasteDialogFor && (() => {
            const pasteUrl = pasteDialogFor;
            const submitting = statuses[pasteUrl]?.state === "scanning";
            const overCap = pasteContent.length > PASTE_CONTENT_MAX_CHARS;
            return (
              <div className="space-y-3 text-sm">
                <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                  <li>
                    <a
                      href={pasteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Open the site in a new tab
                      <ExternalLink className="size-3" />
                    </a>
                  </li>
                  <li>Select all and copy</li>
                  <li>Paste below</li>
                </ol>

                <div className="space-y-1">
                  <Label htmlFor="paste-page-content">Page content</Label>
                  <Textarea
                    id="paste-page-content"
                    value={pasteContent}
                    onChange={(e) => {
                      setPasteContent(e.target.value);
                      if (pasteError) setPasteError(null);
                    }}
                    placeholder="Paste the page's HTML or its visible text here"
                    className="h-40 resize-y font-mono text-xs"
                    disabled={submitting}
                  />
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>Pasting the page source keeps offer links — plain text works too.</span>
                    <span className={cn("shrink-0 tabular-nums", overCap && "text-destructive")}>
                      {pasteContent.length.toLocaleString()} / {PASTE_CONTENT_MAX_CHARS.toLocaleString()}
                    </span>
                  </div>
                </div>

                {pasteError && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="size-3.5 shrink-0" />
                    {pasteError}
                  </p>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="ghost" onClick={closePasteDialog}>Cancel</Button>
            <Button
              className="gap-1.5"
              onClick={() => pasteDialogFor && scanSource(pasteDialogFor, pasteContent)}
              disabled={!pasteContent.trim() || (pasteDialogFor ? statuses[pasteDialogFor]?.state === "scanning" : false)}
            >
              {pasteDialogFor && statuses[pasteDialogFor]?.state === "scanning" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ClipboardPaste className="size-3.5" />
              )}
              Scan pasted page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
