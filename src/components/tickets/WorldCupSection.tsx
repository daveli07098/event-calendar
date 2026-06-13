"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Trophy, RefreshCw, Loader2, Clock, AlertCircle, Goal, CalendarPlus, Check, Plus, Minus, Maximize2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { DEFAULT_TIME_ZONE } from "@/lib/theme";
import type { EventType, CalendarType } from "@/types";
import {
  isWorldCupEvent,
  buildGroups,
  buildBracket,
  computeStandings,
  resolveKnockout,
  groupOdds,
  ROUND_LABELS_EN,
  type MatchScore,
  type TeamStanding,
  type KnockoutMatch,
  type ResolvedSlot,
} from "@/lib/worldcup";

interface AiQuota { used: number; limit: number; remaining: number; resetAt?: string }
interface GroupScores { standings: TeamStanding[]; matches: MatchScore[] }
interface ScoresSnapshot { groups: Record<string, GroupScores>; asOf: string }

// Tournament window — wide enough to cover the whole 2026 schedule.
const TOURNAMENT_START = "2026-06-01T00:00:00.000Z";
const TOURNAMENT_END = "2026-07-31T23:59:59.000Z";

/** Format a kickoff in the user's timezone, e.g. "Jun 12, 03:00 GMT+8". */
function fmtKickoff(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: tz, timeZoneName: "short",
  });
}

function fmtAgo(iso: string | null, tz: string): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz });
}

function scoreFor(matches: MatchScore[], home: string, away: string): MatchScore | undefined {
  return matches.find((m) => m.home === home && m.away === away);
}

/**
 * Hover tooltip that reliably shows multi-line info. Portals to <body> so it's
 * never clipped by the card's overflow, and follows the cursor. Replaces the
 * unreliable native `title` attribute.
 */
function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const track = (e: React.MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
  return (
    <span className={className} onMouseEnter={track} onMouseMove={track} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && typeof document !== "undefined" && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] max-w-xs whitespace-pre-line rounded-md bg-popover px-2 py-1.5 text-[11px] leading-relaxed text-popover-foreground shadow-lg ring-1 ring-foreground/15"
          style={{ left: Math.min(pos.x + 14, window.innerWidth - 220), top: pos.y + 14 }}
        >
          {label}
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Per-match goals-for/against breakdown for a team, for the GD hover tooltip. */
function goalBreakdown(team: string, matches: MatchScore[]): string {
  const lines: string[] = [];
  let gf = 0, ga = 0;
  for (const m of matches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    if (m.home === team) { gf += m.homeScore; ga += m.awayScore; lines.push(`vs ${m.away}: scored ${m.homeScore} / conceded ${m.awayScore}`); }
    else if (m.away === team) { gf += m.awayScore; ga += m.homeScore; lines.push(`vs ${m.home}: scored ${m.awayScore} / conceded ${m.homeScore}`); }
  }
  if (!lines.length) return "No matches played yet";
  return `Goals for ${gf} / against ${ga}\n${lines.join("\n")}`;
}

/** Win/draw/loss breakdown and points for a team, for the Pts hover tooltip. */
function pointsBreakdown(team: string, matches: MatchScore[]): string {
  const lines: string[] = [];
  let pts = 0;
  for (const m of matches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const isHome = m.home === team, isAway = m.away === team;
    if (!isHome && !isAway) continue;
    const my = isHome ? m.homeScore : m.awayScore;
    const opp = isHome ? m.awayScore : m.homeScore;
    const oppName = isHome ? m.away : m.home;
    if (my > opp) { pts += 3; lines.push(`Won vs ${oppName} (${my}-${opp})  +3`); }
    else if (my === opp) { pts += 1; lines.push(`Drew vs ${oppName} (${my}-${opp})  +1`); }
    else { lines.push(`Lost vs ${oppName} (${my}-${opp})  +0`); }
  }
  if (!lines.length) return "No matches played yet";
  return `${pts} pts\n${lines.join("\n")}`;
}

/** Small popover button that adds a single match to a chosen calendar. */
function AddMatchButton({
  title, startIso, location, calendars,
}: {
  title: string;
  startIso: string;
  location?: string | null;
  calendars: CalendarType[];
}) {
  const [open, setOpen] = useState(false);
  const [calId, setCalId] = useState("");
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);

  const writable = calendars.filter((c) => c.userId === undefined || c.memberRole !== "viewer");
  const target = calId || writable[0]?.id || "";

  async function add() {
    if (!target) return;
    setAdding(true);
    try {
      const start = new Date(startIso);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2-hour slot
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: "2026 FIFA World Cup",
          location: location ?? null,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          allDay: false,
          calendarId: target,
          category: "sports",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Couldn't add to calendar");
        return;
      }
      setDone(true);
      toast.success(`Added “${title}” to your calendar`);
      setTimeout(() => { setOpen(false); setDone(false); }, 900);
    } catch {
      toast.error("Network error");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className="size-6 shrink-0 text-muted-foreground hover:text-primary" />}
        aria-label="Add to calendar"
        title="Add to my calendar"
      >
        <CalendarPlus className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-2 p-3" align="end">
        <p className="text-xs font-medium truncate">{title}</p>
        <Select value={target} onValueChange={(v) => setCalId(String(v))}>
          <SelectTrigger className="w-full" size="sm">
            <SelectValue placeholder="Choose calendar…">
              {(value) => calendars.find((c) => c.id === value)?.name ?? "Choose calendar…"}
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
        <Button size="sm" className="w-full gap-1.5" onClick={add} disabled={adding || !target || done}>
          {done ? <Check className="size-3.5" /> : adding ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarPlus className="size-3.5" />}
          {done ? "Added" : "Add to calendar"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function WorldCupSection({ onQuotaUpdate }: { onQuotaUpdate?: (q: AiQuota) => void }) {
  const { theme } = useTheme();
  const tz = theme.timeZone || DEFAULT_TIME_ZONE;

  const [events, setEvents] = useState<EventType[]>([]);
  const [calendars, setCalendars] = useState<CalendarType[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<ScoresSnapshot | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // clock read on mount (avoids impure Date.now() in render)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the clock once on mount
    setNow(Date.now());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [evRes, scRes, calRes] = await Promise.all([
          fetch(`/api/events?start=${TOURNAMENT_START}&end=${TOURNAMENT_END}`),
          fetch("/api/worldcup/scores"),
          fetch("/api/calendars"),
        ]);
        const evJson = evRes.ok ? await evRes.json() : [];
        const scJson = scRes.ok ? await scRes.json() : null;
        const calJson = calRes.ok ? await calRes.json() : [];
        if (cancelled) return;
        setEvents(Array.isArray(evJson) ? (evJson as EventType[]).filter(isWorldCupEvent) : []);
        setCalendars(Array.isArray(calJson) ? (calJson as CalendarType[]) : []);
        const hasWcEvents = Array.isArray(evJson) && (evJson as EventType[]).some(isWorldCupEvent);
        if (scJson?.data) {
          setSnapshot(scJson.data as ScoresSnapshot);
          setProvider(scJson.provider ?? null);
          setFetchedAt(scJson.fetchedAt ?? null);
        } else if (hasWcEvents) {
          // No cached scores yet → fetch them once automatically.
          void refreshScores();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // refreshScores is a stable hoisted function; intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => buildGroups(events), [events]);
  const bracket = useMemo(() => buildBracket(events), [events]);

  // Resolve Round-of-32 placeholders (組冠軍/組亞軍/最佳第三名) from the synced
  // standings — provisional until each group/the thirds are mathematically locked.
  // Each slot gets a hover tooltip: what it stands for, current group record, and
  // (while provisional) the Monte-Carlo % chance of finishing in that position.
  const resolved = useMemo(() => {
    const r32 = bracket.find((r) => r.round === "R32")?.matches ?? [];
    const perGroup: Record<string, TeamStanding[]> = {};
    if (snapshot) for (const [g, v] of Object.entries(snapshot.groups)) perGroup[g] = v.standings;
    const base = resolveKnockout(r32, perGroup);

    // Per-group qualification odds from played results + remaining fixtures.
    const odds: Record<string, ReturnType<typeof groupOdds>> = {};
    for (const g of groups) {
      const fixtures = g.matches.map((m) => ({ home: m.home, away: m.away }));
      odds[g.group] = groupOdds(g.teams, fixtures, snapshot?.groups[g.group]?.matches ?? []);
    }

    const ordinal = (p: number | null) => (p === 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "3rd" : "");
    // English description of what a slot stands for (team names stay Chinese).
    const meaningOf = (slot: typeof base[string]["home"]): string => {
      if (slot.position === 1 && slot.group) return `Group ${slot.group} winner`;
      if (slot.position === 2 && slot.group) return `Group ${slot.group} runner-up`;
      if (slot.position === 3) return "best 3rd place";
      return slot.label; // e.g. "M74勝者"
    };
    const titleFor = (slot: typeof base[string]["home"]): string => {
      const meaning = meaningOf(slot);
      if (!slot.team) return `${meaning}\nNot decided yet — depends on the earlier matches`;
      if (slot.confirmed) return `${slot.team} — ${meaning}\n✓ Confirmed`;
      const st = slot.group ? snapshot?.groups[slot.group]?.standings.find((t) => t.team === slot.team) : undefined;
      const o = slot.group ? odds[slot.group]?.[slot.team] : undefined;
      const pct = o ? Math.round((slot.position === 1 ? o.first : slot.position === 2 ? o.second : o.third) * 100) : null;
      const lines = [`${slot.team} — currently ${meaning} (not yet confirmed)`];
      if (st) lines.push(`${st.pts} ${st.pts === 1 ? "point" : "points"} from ${st.p} ${st.p === 1 ? "game" : "games"} played · goal difference ${st.gd >= 0 ? "+" : ""}${st.gd}`);
      if (pct != null) lines.push(`~${pct}% chance to finish ${ordinal(slot.position)}`);
      return lines.join("\n");
    };

    const out: typeof base = {};
    for (const [id, m] of Object.entries(base)) {
      out[id] = { home: { ...m.home, title: titleFor(m.home) }, away: { ...m.away, title: titleFor(m.away) } };
    }
    return out;
  }, [bracket, snapshot, groups]);

  async function refreshScores() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/worldcup/scores", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setRefreshError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setSnapshot(json.data as ScoresSnapshot);
      setProvider(json.provider ?? null);
      setFetchedAt(json.fetchedAt ?? null);
      if (json.aiQuota) onQuotaUpdate?.(json.aiQuota as AiQuota);
    } catch {
      setRefreshError("Network error");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" /> Loading World Cup…
      </div>
    );
  }

  if (groups.length === 0 && bracket.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center space-y-3">
        <Trophy className="size-10 mx-auto text-muted-foreground" />
        <h2 className="text-xl font-bold">No World Cup events found</h2>
        <p className="text-muted-foreground text-sm">
          Import the 2026 FIFA World Cup schedule into a calendar to see groups, standings and the
          knockout bracket here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Trophy className="size-6 text-primary" />
          2026 FIFA World Cup
        </h2>
        <p className="text-muted-foreground text-sm">
          Group standings, fixtures and the road to the trophy — times shown in {tz.replace(/_/g, " ")}.
        </p>
      </div>

      <Tabs defaultValue="groups">
        <TabsList>
          <TabsTrigger value="groups">Group Stage</TabsTrigger>
          <TabsTrigger value="bracket">Road to Trophy</TabsTrigger>
        </TabsList>

        {/* ── Group stage ── */}
        <TabsContent value="groups" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={refreshScores} disabled={refreshing} size="sm" className="gap-1.5">
              {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {refreshing ? "Checking scores…" : "Refresh scores (AI)"}
            </Button>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Clock className="size-3" /> Updated {fmtAgo(fetchedAt, tz)}
            </span>
            {provider && (
              <Badge variant="secondary" className="font-mono text-[10px]">via {provider}</Badge>
            )}
          </div>
          {refreshError && (
            <p className="text-sm text-destructive inline-flex items-center gap-1.5">
              <AlertCircle className="size-4" /> {refreshError}
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => {
              const gs = snapshot?.groups[g.group];
              const matches = gs?.matches ?? [];
              const standings = gs?.standings ?? computeStandings(g.teams, []);
              return (
                <GroupCard
                  key={g.group}
                  group={g.group}
                  standings={standings}
                  fixtures={g.matches}
                  matches={matches}
                  calendars={calendars}
                  tz={tz}
                  now={now}
                />
              );
            })}
          </div>
        </TabsContent>

        {/* ── Knockout bracket — converges on the centre Final ── */}
        <TabsContent value="bracket" className="pt-4">
          {bracket.length === 0 ? (
            <p className="text-sm text-muted-foreground">No knockout fixtures found yet.</p>
          ) : (
            <Bracket bracket={bracket} calendars={calendars} tz={tz} resolved={resolved} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GroupCard({
  group, standings, fixtures, matches, calendars, tz, now,
}: {
  group: string;
  standings: TeamStanding[];
  fixtures: { home: string; away: string; kickoff: string; location: string | null }[];
  matches: MatchScore[];
  calendars: CalendarType[];
  tz: string;
  now: number;
}) {
  return (
    <Card size="sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-bold">
            {group}
          </span>
          Group {group}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Standings table */}
        <div className="text-xs">
          <div className="grid grid-cols-[1.2rem_1fr_1.1rem_1.1rem_1.1rem_1.1rem_1.6rem_1.6rem] gap-x-1 px-1 py-1 font-semibold text-muted-foreground border-b border-border">
            <span>#</span><span>Team</span><span className="text-center">P</span>
            <span className="text-center">W</span><span className="text-center">D</span>
            <span className="text-center">L</span><span className="text-center">GD</span>
            <span className="text-center">Pts</span>
          </div>
          {standings.map((t) => (
            <div
              key={t.team}
              className={cn(
                "grid grid-cols-[1.2rem_1fr_1.1rem_1.1rem_1.1rem_1.1rem_1.6rem_1.6rem] gap-x-1 px-1 py-1 items-center border-b border-border/50 last:border-0",
                t.rank <= 2 && "bg-primary/5",
              )}
            >
              <span className="text-muted-foreground tabular-nums">{t.rank}</span>
              <span className="truncate font-medium">{t.team}</span>
              <span className="text-center tabular-nums">{t.p}</span>
              <span className="text-center tabular-nums">{t.w}</span>
              <span className="text-center tabular-nums">{t.d}</span>
              <span className="text-center tabular-nums">{t.l}</span>
              <InfoTip className="text-center tabular-nums" label={goalBreakdown(t.team, matches)}>{t.gd > 0 ? `+${t.gd}` : t.gd}</InfoTip>
              <InfoTip className="text-center font-bold tabular-nums" label={pointsBreakdown(t.team, matches)}>{t.pts}</InfoTip>
            </div>
          ))}
        </div>

        {/* Fixtures / results */}
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">Matches</p>
          {fixtures.map((f, i) => {
            const s = scoreFor(matches, f.home, f.away);
            const played = s != null && s.homeScore != null && s.awayScore != null;
            const homeWin = played && s!.homeScore! > s!.awayScore!;
            const awayWin = played && s!.awayScore! > s!.homeScore!;
            const draw = played && s!.homeScore! === s!.awayScore!;
            const t = new Date(f.kickoff).getTime();
            // Finished = kicked off in the past; soon = kicks off within 12 hours.
            const finished = now > 0 && t < now;
            const soon = now > 0 && t >= now && t < now + 12 * 3_600_000;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-1.5 text-xs rounded px-1 py-0.5",
                  finished && "bg-primary/5",
                  soon && "bg-amber-400/10 ring-1 ring-amber-400/50",
                )}
              >
                <span
                  className={cn(
                    "flex-1 text-right truncate inline-flex items-center justify-end gap-1",
                    homeWin ? "font-bold text-foreground" : awayWin ? "text-muted-foreground" : (finished || soon) && "font-medium",
                  )}
                >
                  {f.home}
                  {homeWin && <Trophy className="size-3 shrink-0 text-amber-400" />}
                  {draw && <span className="text-muted-foreground/60 text-[9px]">=</span>}
                </span>
                {played ? (
                  <span className="font-bold tabular-nums px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                    {s!.homeScore} - {s!.awayScore}
                  </span>
                ) : finished ? (
                  <span className="px-1 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold">FT</span>
                ) : (
                  <span className={cn("text-[10px] whitespace-nowrap inline-flex items-center gap-1", soon ? "text-amber-500 font-medium" : "text-muted-foreground")}>
                    {soon && <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />}
                    {fmtKickoff(f.kickoff, tz)}
                  </span>
                )}
                <span
                  className={cn(
                    "flex-1 truncate inline-flex items-center gap-1",
                    awayWin ? "font-bold text-foreground" : homeWin ? "text-muted-foreground" : (finished || soon) && "font-medium",
                  )}
                >
                  {draw && <span className="text-muted-foreground/60 text-[9px]">=</span>}
                  {awayWin && <Trophy className="size-3 shrink-0 text-amber-400" />}
                  {f.away}
                </span>
                <AddMatchButton
                  title={`${f.home} vs ${f.away}`}
                  startIso={f.kickoff}
                  location={f.location}
                  calendars={calendars}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/** One side of a bracket match: a resolved team (provisional = amber/italic,
 *  confirmed = solid + ✓) or the original placeholder when not yet derivable. */
function SlotName({ fallback, slot }: { fallback: string; slot?: ResolvedSlot }) {
  if (slot?.team) {
    return (
      <InfoTip
        className={cn(
          "inline-flex items-center gap-1 truncate",
          slot.confirmed ? "font-semibold text-foreground" : "italic text-amber-500",
        )}
        label={slot.title ?? `${slot.team} — ${slot.label}`}
      >
        {slot.confirmed && <CheckCircle2 className="size-2.5 shrink-0" />}
        {slot.team}
      </InfoTip>
    );
  }
  return (
    <InfoTip className="truncate text-muted-foreground" label={slot?.title ?? `${fallback} · unavailable now (decided by earlier matches)`}>
      {fallback}
    </InfoTip>
  );
}

function BracketMatch({
  match, calendars, tz, resolved,
}: {
  match: KnockoutMatch;
  calendars: CalendarType[];
  tz: string;
  resolved?: { home: ResolvedSlot; away: ResolvedSlot };
}) {
  return (
    <div className="relative rounded-md border border-border bg-card text-xs">
      {/* White connector stub pointing toward the centre (Final) */}
      {match.side === "left" && (
        <span className="pointer-events-none absolute top-1/2 -right-4 h-px w-4 -translate-y-1/2 bg-white/40" />
      )}
      {match.side === "right" && (
        <span className="pointer-events-none absolute top-1/2 -left-4 h-px w-4 -translate-y-1/2 bg-white/40" />
      )}

      <div className="absolute right-1 top-1">
        <AddMatchButton
          title={`${match.roundLabel}: ${resolved?.home?.team ?? match.home} vs ${resolved?.away?.team ?? match.away}`}
          startIso={match.kickoff}
          calendars={calendars}
        />
      </div>

      {/* Two team slots, clearly separated by a white divider */}
      <div className="divide-y divide-white/15">
        <div className="px-2.5 py-2 pr-8">
          <SlotName fallback={match.home} slot={resolved?.home} />
        </div>
        <div className="flex items-center gap-1 px-2.5 py-2 pr-8">
          <Goal className="size-2.5 shrink-0 text-muted-foreground" />
          <SlotName fallback={match.away} slot={resolved?.away} />
        </div>
      </div>
      <p className="border-t border-white/10 px-2.5 py-1 text-[9px] text-muted-foreground/60">
        {fmtKickoff(match.kickoff, tz)}
        {match.matchId != null && ` · M${match.matchId}`}
      </p>
    </div>
  );
}

/** Two-sided knockout bracket: left half flows inward, right half mirrors it,
 *  meeting at the centre Final — like a printed tournament bracket. */
function Bracket({
  bracket, calendars, tz, resolved,
}: {
  bracket: ReturnType<typeof buildBracket>;
  calendars: CalendarType[];
  tz: string;
  resolved: Record<string, { home: ResolvedSlot; away: ResolvedSlot }>;
}) {
  const rounds = bracket.filter((r) => r.round !== "Final" && r.round !== "ThirdPlace");
  const final = bracket.find((r) => r.round === "Final");
  const third = bracket.find((r) => r.round === "ThirdPlace");

  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  const clampZoom = (z: number) => Math.max(0.4, Math.min(1.6, Math.round(z * 100) / 100));

  // Measure the natural size and fit-to-width on mount / resize (show all first).
  useEffect(() => {
    const fit = () => {
      const c = contentRef.current, w = wrapRef.current;
      if (!c || !w) return;
      const natW = c.scrollWidth, natH = c.scrollHeight; // unaffected by transform
      setNat({ w: natW, h: natH });
      setZoom(clampZoom(Math.min(1, w.clientWidth / natW)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [bracket]);

  const fitToWidth = () => {
    const c = contentRef.current, w = wrapRef.current;
    if (!c || !w) return;
    setZoom(clampZoom(Math.min(1, w.clientWidth / c.scrollWidth)));
  };

  // Trackpad pinch-zoom (macOS): a pinch arrives as a wheel event with ctrlKey.
  // Attached non-passively so we can preventDefault and zoom instead of scroll.
  useEffect(() => {
    const w = wrapRef.current;
    if (!w) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // normal scroll/pan passes through
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.01));
    };
    w.addEventListener("wheel", onWheel, { passive: false });
    return () => w.removeEventListener("wheel", onWheel);
  }, []);

  // Click-and-drag to pan the bracket (skips drags that start on a button).
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPanDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const w = wrapRef.current;
    if (!w) return;
    pan.current = { x: e.clientX, y: e.clientY, left: w.scrollLeft, top: w.scrollTop };
    w.setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent) => {
    const w = wrapRef.current;
    if (!w || !pan.current) return;
    w.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
    w.scrollTop = pan.current.top - (e.clientY - pan.current.y);
  };
  const onPanUp = (e: React.PointerEvent) => {
    pan.current = null;
    try { wrapRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const column = (label: string, matches: KnockoutMatch[], key: string) => (
    <div key={key} className="flex w-48 shrink-0 flex-col gap-3">
      <p className="text-center text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="flex flex-1 flex-col justify-around gap-6">
        {matches.map((m) => <BracketMatch key={m.eventId} match={m} calendars={calendars} tz={tz} resolved={resolved[m.eventId]} />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Zoom controls — fits the whole bracket by default, enlarge/minimise here */}
      <div className="flex items-center justify-end gap-1">
        <Button size="icon-sm" variant="outline" onClick={() => setZoom((z) => clampZoom(z - 0.1))} aria-label="Zoom out" title="Minimise">
          <Minus className="size-3.5" />
        </Button>
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button size="icon-sm" variant="outline" onClick={() => setZoom((z) => clampZoom(z + 0.1))} aria-label="Zoom in" title="Enlarge">
          <Plus className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="outline" onClick={fitToWidth} aria-label="Fit to width" title="Fit all">
          <Maximize2 className="size-3.5" />
        </Button>
      </div>

      <div
        ref={wrapRef}
        className="overflow-auto cursor-grab touch-pan-x active:cursor-grabbing"
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanUp}
        onPointerCancel={onPanUp}
      >
        {/* Outer box collapses to the scaled size so 'fit' shows all with no dead space */}
        <div style={nat ? { width: nat.w * zoom, height: nat.h * zoom } : undefined}>
          <div
            ref={contentRef}
            className="flex min-w-max items-stretch gap-3"
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
          >
            {/* Left half: R32 → SF flowing toward the centre */}
            {rounds.map((r) => column(ROUND_LABELS_EN[r.round], r.matches.filter((m) => m.side === "left"), `L-${r.round}`))}

            {/* Centre: the Final (and third-place play-off below it) */}
            <div className="flex w-48 shrink-0 flex-col items-center justify-center gap-3 px-1">
              <p className="text-center text-sm font-semibold">🏆 Final</p>
              {final?.matches.map((m) => (
                <div key={m.eventId} className="w-full rounded-lg border-2 border-primary/60 bg-primary/5 p-1">
                  <BracketMatch match={m} calendars={calendars} tz={tz} resolved={resolved[m.eventId]} />
                </div>
              ))}
              {third && third.matches.length > 0 && (
                <div className="w-full space-y-1">
                  <p className="text-center text-[10px] uppercase tracking-wide text-muted-foreground/70">Third place</p>
                  {third.matches.map((m) => <BracketMatch key={m.eventId} match={m} calendars={calendars} tz={tz} resolved={resolved[m.eventId]} />)}
                </div>
              )}
            </div>

            {/* Right half: SF → R32 mirrored (rounds reversed so R32 sits on the far right) */}
            {[...rounds].reverse().map((r) => column(ROUND_LABELS_EN[r.round], r.matches.filter((m) => m.side === "right"), `R-${r.round}`))}
          </div>
        </div>
      </div>
    </div>
  );
}
