"use client";

import { useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Loader2, Upload, Link2, FileText, Sparkles, Check, Trash2, ExternalLink, Users, Eye, TriangleAlert, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { parseSeat, parseSeats } from "@/lib/seat-parse";
import { SeatBreakdown } from "@/components/events/SeatBreakdown";
import { layoutOf } from "@/lib/venue-seatmap/geometry";
import { validateSeatMapConfig } from "@/lib/venue-seatmap/validate";
import { invalidateVenueSeatMapsCache, type VenueSeatMapListEntry } from "@/lib/venue-seatmap/use-venue-seatmaps";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";
import type { VenueEventSummary } from "@/app/api/venues/events/route";

// Lazy, client-only — same rationale as EventModal: the SVG bowl, geometry tables and `three`
// only load once someone opens a panel and types a seat.
const SeatMap = dynamic(() => import("@/components/venue/SeatMap").then((m) => m.SeatMap), { ssr: false });
const SeatMap3D = dynamic(() => import("@/components/venue/SeatMap3D").then((m) => m.SeatMap3D), { ssr: false });

export type SeatMapStatusKind = "built-in" | "approved" | "draft" | "none";

export function seatMapStatusOf(
  builtInConfig: VenueSeatMapConfig | null,
  entry: VenueSeatMapListEntry | null | undefined,
): SeatMapStatusKind {
  if (builtInConfig) return "built-in";
  if (entry?.config && entry.status === "approved") return "approved";
  if (entry?.config && entry.status === "draft") return "draft";
  return "none";
}

const STATUS_LABEL: Record<SeatMapStatusKind, string> = {
  "built-in": "Built-in",
  approved: "Approved",
  draft: "Draft",
  none: "No seat map",
};

/** Status pill — same shape/colour language as DiscountSection's confidence chip. */
export function SeatMapStatusChip({ status, className }: { status: SeatMapStatusKind; className?: string }) {
  return (
    <span
      data-testid="seatmap-status"
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        status === "built-in" && "bg-primary/10 text-primary",
        status === "approved" && "bg-green-500/15 text-green-600 dark:text-green-400",
        status === "draft" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        status === "none" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PLAN_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

function isPdfUrl(url: string): boolean {
  return /\.pdf(?:[?#]|$)/i.test(url);
}

function formatUpdated(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

interface ApiError {
  message: string;
  errors: string[];
}

async function readApiError(res: Response, fallback: string): Promise<ApiError> {
  let body: { error?: unknown; errors?: unknown; resetAt?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON error body — fall through to the fallback message
  }
  const errors = Array.isArray(body.errors) ? body.errors.filter((e): e is string => typeof e === "string") : [];
  let message = typeof body.error === "string" && body.error ? body.error : fallback;
  if (res.status === 429) {
    const reset = typeof body.resetAt === "string" ? formatUpdated(body.resetAt) : null;
    message = `${message}. Try again${reset ? ` after ${reset}` : " tomorrow"}.`;
  } else if (res.status === 503) {
    message = `${message}. AI drafting is unavailable on this server — you can still paste a config under “Advanced: edit JSON”.`;
  }
  return { message, errors };
}

/** A plausible seat line for this config, so "Try a sample seat" shows the projection working. */
function sampleSeatFor(config: VenueSeatMapConfig | null): string | null {
  if (!config) return null;
  for (const level of config.levels) {
    if (level.kind === "floor") continue;
    const numeric = level.blockNumberRanges.find((r) => r.positionConfidence === "confirmed");
    if (numeric) return `Block ${Math.round((numeric.min + numeric.max) / 2)} Row F Seat 12`;
    const labelled = level.blockLabelRanges?.find((r) => r.positionConfidence === "confirmed" && r.labels.length > 0);
    if (labelled) return `Block ${labelled.labels[Math.floor(labelled.labels.length / 2)]} Row F Seat 12`;
  }
  for (const level of config.levels) {
    const any = level.blockNumberRanges[0];
    if (any) return `Block ${any.min} Row F Seat 12`;
    const label = level.blockLabelRanges?.[0]?.labels[0];
    if (label) return `Block ${label} Row F Seat 12`;
  }
  return null;
}

function summarizeRanges(config: VenueSeatMapConfig) {
  return config.levels.map((level) => {
    const parts = [
      ...level.blockNumberRanges.map((r) => ({
        text: r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`,
        unconfirmed: r.positionConfidence === "unconfirmed",
      })),
      ...(level.blockLabelRanges ?? []).map((r) => ({
        text: r.labels.length > 6 ? `${r.labels.slice(0, 6).join(", ")} +${r.labels.length - 6}` : r.labels.join(", "),
        unconfirmed: r.positionConfidence === "unconfirmed",
      })),
    ];
    return { id: level.id, label: level.label, kind: level.kind ?? "stand", parts, zones: level.zones ?? [] };
  });
}

const LAYOUT_LABEL: Record<string, string> = {
  "bowl-end-stage": "Bowl, end stage",
  "bowl-centre-stage": "Bowl, centre stage",
  theatre: "Theatre",
};

function Step({
  n, title, hint, done, children,
}: { n: number; title: string; hint?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          done ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-primary/10 text-primary",
        )}
      >
        {done ? <Check className="size-3" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <h4 className="text-sm font-medium">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h4>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {children}
      </div>
    </li>
  );
}

function ErrorBox({ error }: { error: ApiError }) {
  return (
    <div role="alert" className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
      <p className="font-medium">{error.message}</p>
      {error.errors.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {error.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}
          {error.errors.length > 12 && <li>…and {error.errors.length - 12} more</li>}
        </ul>
      )}
    </div>
  );
}

function PlanPreview({ url, venueName, compact }: { url: string; venueName: string; compact?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (isPdfUrl(url) || broken) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-primary hover:underline"
      >
        <FileText className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{isPdfUrl(url) ? "Seating plan (PDF)" : "Seating plan"} — open</span>
        <ExternalLink className="size-3 shrink-0" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open seating plan in a new tab"
      className="block overflow-hidden rounded-md border border-border bg-muted"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`Seating plan for ${venueName}`}
        onError={() => setBroken(true)}
        className={cn("w-full object-contain", compact ? "max-h-40" : "max-h-80")}
      />
    </a>
  );
}

export interface VenueSeatMapPanelProps {
  venue: { id: string; name: string; aliases: string[] };
  entry: VenueSeatMapListEntry | null;
  /** Static-registry config (e.g. Kai Tak) — makes the panel read-only. */
  builtInConfig: VenueSeatMapConfig | null;
  /** This venue's upcoming events (only those with a `seat` are listed). */
  events: VenueEventSummary[];
  /** True when /api/venues/events failed, so an empty ticket list isn't presented as "none". */
  eventsUnavailable?: boolean;
  /** Called after any successful write; `null` means the seat map was removed entirely. */
  onChanged: (entry: VenueSeatMapListEntry | null) => void;
  id?: string;
  hidden?: boolean;
}

type Source = "ai-draft" | "research" | "user";

export function VenueSeatMapPanel({ venue, entry, builtInConfig, events, eventsUnavailable, onChanged, id, hidden }: VenueSeatMapPanelProps) {
  const uid = useId();
  const readOnly = !!builtInConfig;
  const testSeatId = `venue-seatmap-test-seat-${venue.id}`;

  // ---- working state -------------------------------------------------------
  const [planUrl, setPlanUrl] = useState<string | null>(entry?.planUrl ?? null);
  const [linkText, setLinkText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [planError, setPlanError] = useState<ApiError | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [notes, setNotes] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<ApiError | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const initialConfig = builtInConfig ?? entry?.config ?? null;
  const [config, setConfig] = useState<VenueSeatMapConfig | null>(initialConfig);
  const [jsonText, setJsonText] = useState(() => (entry?.config ? JSON.stringify(entry.config, null, 2) : ""));
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [source, setSource] = useState<Source | null>((entry?.source as Source | null) ?? null);
  const [dirty, setDirty] = useState(false);

  const [saving, setSaving] = useState<"draft" | "approved" | "remove" | null>(null);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"seatmap" | "plan" | null>(null);

  const [testSeat, setTestSeat] = useState("");
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [webglMissing, setWebglMissing] = useState(false);
  const testSeatRef = useRef<HTMLInputElement>(null);

  const [live, setLive] = useState("");

  const seatResult = useMemo(() => (testSeat.trim() ? parseSeat(testSeat) : null), [testSeat]);
  const isTheatre = !!config && layoutOf(config) === "theatre";
  const effectiveView = isTheatre ? "2d" : view;
  const sampleSeat = useMemo(() => sampleSeatFor(config), [config]);
  const summary = useMemo(() => (config ? summarizeRanges(config) : []), [config]);
  const jsonInvalid = jsonErrors.length > 0;
  const savedStatus = entry?.config ? entry.status : null;

  const tickets = useMemo(
    () =>
      events
        .filter((ev) => ev.seat && ev.seat.trim())
        .map((ev) => {
          const seats = parseSeats(ev.seat as string).filter((r) => r.status !== "unparseable");
          return { ev, seats: seats.length > 1 ? seats.map((s) => s.raw.trim()) : [(ev.seat as string).trim()] };
        }),
    [events],
  );

  // ---- step 1: plan ----------------------------------------------------------
  const applyPlanUrl = (url: string) => {
    setPlanUrl(url);
    onChanged({
      venueId: venue.id,
      venueName: venue.name,
      aliases: venue.aliases,
      status: entry?.status ?? null,
      source: entry?.source ?? null,
      planUrl: url,
      updatedAt: entry?.updatedAt ?? null,
      config: entry?.config ?? null,
    });
  };

  const uploadPlan = async (file: File | undefined) => {
    if (!file) return;
    setPlanError(null);
    const isPdf = file.type === "application/pdf";
    if (!isPdf && !file.type.startsWith("image/")) {
      setPlanError({ message: `Unsupported file type: ${file.type || file.name}. Use an image or a PDF.`, errors: [] });
      return;
    }
    const max = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
    if (file.size > max) {
      setPlanError({ message: `${file.name} is too large (max ${max / (1024 * 1024)} MB for ${isPdf ? "PDFs" : "images"}).`, errors: [] });
      return;
    }
    setUploading(true);
    setLive("Uploading seating plan…");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/venues/${venue.id}/seatmap/plan`, { method: "POST", body: form });
      if (!res.ok) throw await readApiError(res, "Upload failed");
      const { planUrl: url } = (await res.json()) as { planUrl: string };
      applyPlanUrl(url);
      setLive("Seating plan attached.");
    } catch (e) {
      const err = isApiError(e) ? e : { message: "Upload failed", errors: [] };
      setPlanError(err);
      setLive(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const linkPlan = async () => {
    const url = linkText.trim();
    if (!url) return;
    setPlanError(null);
    if (!/^https:\/\//i.test(url)) {
      setPlanError({ message: "Paste an https:// link to the seating plan image or PDF.", errors: [] });
      return;
    }
    setUploading(true);
    setLive("Linking seating plan…");
    try {
      const res = await fetch(`/api/venues/${venue.id}/seatmap/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw await readApiError(res, "Could not link the plan");
      const { planUrl: saved } = (await res.json()) as { planUrl: string };
      applyPlanUrl(saved);
      setLinkText("");
      setLive("Seating plan linked.");
    } catch (e) {
      const err = isApiError(e) ? e : { message: "Could not link the plan", errors: [] };
      setPlanError(err);
      setLive(err.message);
    } finally {
      setUploading(false);
    }
  };

  // ---- step 2: AI draft --------------------------------------------------------
  const draft = async () => {
    if (!planUrl) return;
    setDrafting(true);
    setDraftError(null);
    setWarnings([]);
    setLive("Drafting a seat map from the plan…");
    try {
      const res = await fetch(`/api/venues/${venue.id}/seatmap/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planUrl, notes: notes.trim() || undefined }),
      });
      if (!res.ok) throw await readApiError(res, "AI draft failed");
      const data = (await res.json()) as { draft: VenueSeatMapConfig; warnings?: string[] };
      setConfig(data.draft);
      setJsonText(JSON.stringify(data.draft, null, 2));
      setJsonErrors([]);
      setSource("ai-draft");
      setDirty(true);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      if (!testSeat.trim()) {
        const sample = sampleSeatFor(data.draft);
        if (sample) setTestSeat(sample);
      }
      setLive(`Draft ready: ${data.draft.levels.length} level${data.draft.levels.length === 1 ? "" : "s"}. Review it below before saving.`);
    } catch (e) {
      const err = isApiError(e) ? e : { message: "AI draft failed", errors: [] };
      setDraftError(err);
      setLive(err.message);
    } finally {
      setDrafting(false);
    }
  };

  // ---- step 3: JSON edit -------------------------------------------------------
  const onJsonChange = (text: string) => {
    setJsonText(text);
    setDirty(true);
    setSource("user");
    if (!text.trim()) {
      setJsonErrors(["Config is empty — draft one with AI or paste a seat-map JSON config."]);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setJsonErrors([`JSON syntax error: ${e instanceof Error ? e.message : "could not parse"}`]);
      return;
    }
    const result = validateSeatMapConfig(parsed);
    if (!result.ok) {
      setJsonErrors(result.errors);
      return;
    }
    setJsonErrors([]);
    setConfig(result.config);
  };

  // ---- step 4: save / remove ---------------------------------------------------
  const save = async (status: "draft" | "approved") => {
    if (!config || jsonInvalid) return;
    setSaving(status);
    setSaveError(null);
    try {
      const res = await fetch(`/api/venues/${venue.id}/seatmap`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, status, ...(source ? { source } : {}) }),
      });
      if (!res.ok) throw await readApiError(res, "Save failed");
      const data = (await res.json()) as {
        config: VenueSeatMapConfig; status: string; source: string | null; planUrl: string | null;
        updatedBy: string | null; updatedAt: string | null;
      };
      setUpdatedBy(data.updatedBy);
      setDirty(false);
      invalidateVenueSeatMapsCache();
      onChanged({
        venueId: venue.id,
        venueName: venue.name,
        aliases: venue.aliases,
        status: data.status,
        source: data.source,
        planUrl: data.planUrl,
        updatedAt: data.updatedAt,
        config: data.config,
      });
      const msg = status === "approved" ? "Approved — tickets at this venue now use this seat map." : "Saved as draft.";
      setLive(msg);
      toast.success(msg);
    } catch (e) {
      const err = isApiError(e) ? e : { message: "Save failed", errors: [] };
      setSaveError(err);
      setLive(err.message);
    } finally {
      setSaving(null);
    }
  };

  /** DELETE clears every seatMap* field — there's no plan-only endpoint. `planOnly` is used when
   * nothing is saved yet, so an unsaved local draft survives detaching the plan. */
  const removeAll = async (planOnly = false) => {
    setSaving("remove");
    setSaveError(null);
    try {
      const res = await fetch(`/api/venues/${venue.id}/seatmap`, { method: "DELETE" });
      if (!res.ok) throw await readApiError(res, "Remove failed");
      setPlanUrl(null);
      if (!planOnly) {
        setConfig(null);
        setJsonText("");
        setJsonErrors([]);
        setWarnings([]);
        setSource(null);
        setDirty(false);
      }
      setUpdatedBy(null);
      invalidateVenueSeatMapsCache();
      onChanged(null);
      const msg = planOnly ? "Seating plan removed." : `Seat map removed from ${venue.name}.`;
      setLive(msg);
      toast.success(msg);
    } catch (e) {
      const err = isApiError(e) ? e : { message: "Remove failed", errors: [] };
      setSaveError(err);
      setLive(err.message);
    } finally {
      setSaving(null);
    }
  };

  const viewTicketSeat = (seat: string) => {
    setTestSeat(seat);
    testSeatRef.current?.focus();
    testSeatRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  const updatedLabel = formatUpdated(entry?.updatedAt ?? null);

  // ---- shared review block (also the whole body for built-in venues) -----------
  const review = (
    <div className="space-y-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={testSeatId} className="text-xs font-medium text-muted-foreground">
          Test seat
        </label>
        <div className="flex gap-2">
          <Input
            id={testSeatId}
            ref={testSeatRef}
            value={testSeat}
            onChange={(e) => setTestSeat(e.target.value)}
            placeholder="Type any seat line, e.g. Level 2 Block 225 Row J Seat 78"
            className="h-8 text-sm"
            autoComplete="off"
          />
          {testSeat && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setTestSeat("")} aria-label="Clear test seat">
              Clear
            </Button>
          )}
        </div>
        <div className="min-h-4">
          {seatResult ? (
            <>
              <SeatBreakdown result={seatResult} />
              {seatResult.status !== "unparseable" && seatResult.additionalSeatsDetected > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {seatResult.additionalSeatsDetected} more ticket{seatResult.additionalSeatsDetected === 1 ? "" : "s"} found in this line — showing the first
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground/70">
              The breakdown and projection update as you type.
              {sampleSeat && config && (
                <>
                  {" "}
                  <button type="button" className="text-primary hover:underline" onClick={() => setTestSeat(sampleSeat)}>
                    Try a sample seat
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <div className={cn("grid gap-3", planUrl && !readOnly && "md:grid-cols-2")}>
        {planUrl && !readOnly && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Seating plan</p>
            <PlanPreview url={planUrl} venueName={venue.name} />
          </div>
        )}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            {config && !isTheatre && (
              <div className="flex gap-1" role="group" aria-label="Preview view">
                <Button type="button" size="xs" variant={effectiveView === "2d" ? "secondary" : "ghost"} aria-pressed={effectiveView === "2d"} onClick={() => setView("2d")}>
                  2D
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={effectiveView === "3d" ? "secondary" : "ghost"}
                  aria-pressed={effectiveView === "3d"}
                  disabled={webglMissing}
                  title={webglMissing ? "3D needs WebGL, which isn't available in this browser" : undefined}
                  onClick={() => setView("3d")}
                >
                  3D
                </Button>
              </div>
            )}
          </div>
          <div className={cn("rounded-md border border-border bg-card p-2 flex items-center justify-center", config ? "min-h-48" : "min-h-16")}>
            {!config ? (
              <p className="text-xs text-muted-foreground/70 text-center px-4">
                No config yet — draft one with AI (step 2) or paste JSON under “Advanced”.
              </p>
            ) : !seatResult || seatResult.status === "unparseable" ? (
              <p className="text-xs text-muted-foreground/70 text-center px-4">
                Type a seat above to see where it lands.
              </p>
            ) : effectiveView === "3d" ? (
              <SeatMap3D
                venue={venue.name}
                seat={seatResult}
                config={config}
                className="w-full"
                onUnavailable={() => {
                  setWebglMissing(true);
                  setView("2d");
                }}
              />
            ) : (
              <SeatMap venue={venue.name} seat={seatResult} config={config} className="w-full flex flex-col items-center" />
            )}
          </div>
          {isTheatre && (
            <p className="text-xs text-muted-foreground">
              3D isn&apos;t available yet for theatres — the seat breakdown still works, and you can save this config.
            </p>
          )}
          {webglMissing && !isTheatre && (
            <p className="text-xs text-muted-foreground">3D needs WebGL, which isn&apos;t available in this browser.</p>
          )}
        </div>
      </div>

      {config && (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs" data-testid="seatmap-summary">
          <p className="text-muted-foreground">
            {LAYOUT_LABEL[layoutOf(config)] ?? layoutOf(config)} · {config.levels.length} level{config.levels.length === 1 ? "" : "s"}
            {config.capacityApprox?.total ? ` · ~${config.capacityApprox.total.toLocaleString()} seats` : ""}
          </p>
          <ul className="mt-1 space-y-0.5">
            {summary.map((level) => (
              <li key={level.id} className="flex flex-wrap gap-x-1.5">
                <span className="font-medium">{level.label}</span>
                {level.kind === "floor" && <span className="text-muted-foreground">(floor)</span>}
                <span className="text-muted-foreground">
                  {level.parts.length === 0 && level.zones.length === 0 && "no blocks"}
                  {level.parts.map((p, i) => (
                    <span key={i}>
                      {i > 0 && "; "}
                      {p.text}
                      {p.unconfirmed && <span className="text-amber-600 dark:text-amber-400" title="Position unconfirmed — not projected"> (position unconfirmed)</span>}
                    </span>
                  ))}
                  {level.zones.length > 0 && `${level.parts.length ? "; " : ""}zones ${level.zones.join(", ")}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const ticketList = (
    <section aria-labelledby={`${uid}-tickets`} className="space-y-1.5">
      <h4 id={`${uid}-tickets`} className="text-sm font-medium">Your tickets here</h4>
      {tickets.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">
          {eventsUnavailable ? "Couldn’t load your events for this venue right now." : "No upcoming events with a seat at this venue."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tickets.map(({ ev, seats }) => (
            <li key={ev.id} className="rounded-md border border-border bg-card px-3 py-2 text-xs">
              <p className="font-medium truncate">{ev.title}</p>
              <ul className="mt-1 space-y-1">
                {seats.map((s, i) => (
                  <li key={`${ev.id}-${i}`} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-muted-foreground">{s}</span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => viewTicketSeat(s)}
                      aria-label={`View seat ${s}`}
                    >
                      <Eye /> View seat
                    </Button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div id={id} hidden={hidden} className="border-t border-border bg-muted/10 px-4 py-4 space-y-4" data-testid="venue-seatmap-panel">
      <p className="sr-only" aria-live="polite" role="status">{live}</p>

      {readOnly ? (
        <>
          <p className="text-xs text-muted-foreground">
            This venue uses a built-in seat map maintained with the app, so it can&apos;t be edited here. Test a seat or view your tickets below.
          </p>
          {review}
          {ticketList}
        </>
      ) : (
        <>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Users className="mt-px size-3.5 shrink-0" />
            <span>
              Anyone signed in can see and edit this seat map.
              {updatedLabel && (
                <> Last updated {updatedLabel}{updatedBy ? ` by ${updatedBy}` : ""}.</>
              )}
            </span>
          </p>

          <ol className="space-y-5">
            <Step n={1} title="Seating plan" hint="Upload the official plan (image up to 5 MB, PDF up to 10 MB) or paste a link." done={!!planUrl}>
              <input
                ref={fileRef}
                type="file"
                accept={PLAN_ACCEPT}
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(e) => uploadPlan(e.target.files?.[0])}
              />
              {planUrl && (
                <div className="max-w-sm">
                  <PlanPreview url={planUrl} venueName={venue.name} compact />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="animate-spin" /> : planUrl ? <RefreshCw /> : <Upload />}
                  {planUrl ? "Replace plan" : "Upload image or PDF"}
                </Button>
                {planUrl && !savedStatus && (
                  <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive" disabled={uploading || !!saving} onClick={() => setConfirm("plan")}>
                    <Trash2 /> Remove plan
                  </Button>
                )}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  linkPlan();
                }}
              >
                <Input
                  type="url"
                  inputMode="url"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  placeholder="…or paste a link: https://…/seating-plan.png"
                  aria-label={`Seating plan link for ${venue.name}`}
                  className="h-7 text-xs"
                  disabled={uploading}
                />
                <Button type="submit" size="sm" variant="outline" className="gap-1.5 shrink-0" disabled={uploading || !linkText.trim()}>
                  <Link2 /> Use link
                </Button>
              </form>
              {planUrl && savedStatus && (
                <p className="text-[11px] text-muted-foreground/80">The plan stays attached to the saved seat map; “Remove seat map” below clears both.</p>
              )}
              {planError && <ErrorBox error={planError} />}
            </Step>

            <Step n={2} title="Draft with AI" hint="Reads the plan and proposes levels and block ranges. Nothing is saved until you choose below." done={!!config}>
              <label htmlFor={`${uid}-notes`} className="sr-only">Notes for the AI draft</label>
              <Textarea
                id={`${uid}-notes`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes, e.g. stage at the north end; floor blocks A–D"
                className="min-h-14 text-xs md:text-xs"
                maxLength={1000}
                disabled={drafting}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" className="gap-1.5" disabled={!planUrl || drafting} onClick={draft}>
                  {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {drafting ? "Drafting…" : config ? "Re-draft with AI" : "Draft with AI"}
                </Button>
                {!planUrl && <span className="text-xs text-muted-foreground">Add a seating plan first.</span>}
                {drafting && <span className="text-xs text-muted-foreground">Reading the plan — this can take up to a minute.</span>}
              </div>
              {draftError && <ErrorBox error={draftError} />}
              {warnings.length > 0 && (
                <ul className="space-y-0.5 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {warnings.map((w) => (
                    <li key={w} className="flex gap-1.5"><TriangleAlert className="mt-px size-3.5 shrink-0" />{w}</li>
                  ))}
                </ul>
              )}
            </Step>

            <Step n={3} title="Review" hint="Check the draft against the plan. Test any seat line to see where it lands.">
              {review}
              <div>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  aria-expanded={jsonOpen}
                  aria-controls={`${uid}-json`}
                  onClick={() => setJsonOpen((o) => !o)}
                >
                  {jsonOpen ? "Hide JSON" : "Advanced: edit JSON"}
                </button>
                {jsonOpen && (
                  <div id={`${uid}-json`} className="mt-1.5 space-y-1.5">
                    <label htmlFor={`${uid}-json-text`} className="sr-only">Seat-map config JSON</label>
                    <Textarea
                      id={`${uid}-json-text`}
                      value={jsonText}
                      onChange={(e) => onJsonChange(e.target.value)}
                      spellCheck={false}
                      aria-invalid={jsonInvalid}
                      aria-describedby={jsonInvalid ? `${uid}-json-errors` : undefined}
                      placeholder='{"id": "…", "name": "…", "levels": [ … ] }'
                      className="h-64 field-sizing-fixed font-mono text-[11px] md:text-[11px]"
                    />
                    {jsonInvalid && (
                      <ul id={`${uid}-json-errors`} role="alert" className="list-disc space-y-0.5 rounded-md bg-destructive/10 py-2 pl-6 pr-2.5 text-xs text-destructive">
                        {jsonErrors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}
                        {jsonErrors.length > 12 && <li>…and {jsonErrors.length - 12} more</li>}
                      </ul>
                    )}
                    {!jsonInvalid && jsonText.trim() && <p className="text-xs text-green-600 dark:text-green-400">Valid config — the preview above reflects it.</p>}
                  </div>
                )}
              </div>
            </Step>

            <Step n={4} title="Save" hint="Drafts are only visible here. Approved seat maps are used to project seats on your events.">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Saved status:</span>
                <SeatMapStatusChip status={seatMapStatusOf(null, entry)} />
                {dirty && config && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Unsaved changes</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={!config || jsonInvalid || !!saving} onClick={() => save("draft")}>
                  {saving === "draft" && <Loader2 className="animate-spin" />}
                  Save draft
                </Button>
                <Button type="button" size="sm" className="gap-1.5" disabled={!config || jsonInvalid || !!saving} onClick={() => save("approved")}>
                  {saving === "approved" ? <Loader2 className="animate-spin" /> : <Check />}
                  Approve for tickets
                </Button>
                {(savedStatus || entry?.planUrl || planUrl) && (
                  <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive sm:ml-auto" disabled={!!saving} onClick={() => setConfirm("seatmap")}>
                    {saving === "remove" ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Remove seat map
                  </Button>
                )}
              </div>
              {jsonInvalid && <p className="text-xs text-destructive">Fix the JSON errors above before saving.</p>}
              {!config && <p className="text-xs text-muted-foreground/70">Draft or paste a config first.</p>}
              {saveError && <ErrorBox error={saveError} />}
            </Step>
          </ol>

          {ticketList}
        </>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(next) => { if (!next) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "plan" ? `Remove the seating plan from ${venue.name}?` : `Remove the seat map for ${venue.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "plan"
                ? "The uploaded plan is detached from this venue for everyone."
                : "This clears the saved config and seating plan for everyone using this directory. Tickets at this venue will no longer be projected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const planOnly = confirm === "plan";
                setConfirm(null);
                removeAll(planOnly);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "message" in e && "errors" in e && Array.isArray((e as ApiError).errors);
}
