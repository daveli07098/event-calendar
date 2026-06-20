"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWorldCupMatches, type WorldCupFixture } from "@/lib/use-worldcup-matches";
import { getTeamFlag } from "@/lib/team-flags";

/** A match is considered "live" for ~2h after kickoff (no scores needed). */
const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

function sameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Short, human countdown: "3d 4h", "4h 12m", or "12m 30s". */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${secs}s`;
}

function teamWithFlag(name: string): string {
  const flag = getTeamFlag(name);
  return flag ? `${flag} ${name}` : name;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white/95 backdrop-blur-sm md:text-xs">
      {children}
    </span>
  );
}

/**
 * Live match-day strip rendered inside the World Cup banner: a "LIVE now" or
 * "next kickoff" countdown, how many matches are on today, and — when the user
 * has chosen a team — that team's next fixture. Self-contained and best-effort:
 * if fixtures can't load it renders nothing, leaving the base banner intact.
 */
export function WorldCupBannerExtras() {
  const { theme } = useTheme();
  const { matches, loaded } = useWorldCupMatches(true);
  const favourite = theme.favouriteTeam ?? null;

  // Tick once a second so the countdown stays live without re-fetching.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!loaded || matches.length === 0) return null;

  const now = new Date(nowMs);
  const live = matches.find((m) => {
    const k = new Date(m.kickoff).getTime();
    return k <= nowMs && nowMs < k + LIVE_WINDOW_MS;
  });
  const next = matches.find((m) => new Date(m.kickoff).getTime() > nowMs);
  const todayCount = matches.filter((m) => sameLocalDay(m.kickoff, now)).length;

  // The user's team: live if playing now, else its next fixture.
  let favFixture: WorldCupFixture | undefined;
  let favLive = false;
  if (favourite) {
    favLive =
      !!live && (live.home === favourite || live.away === favourite);
    favFixture =
      matches.find(
        (m) =>
          (m.home === favourite || m.away === favourite) &&
          new Date(m.kickoff).getTime() + LIVE_WINDOW_MS > nowMs,
      );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {live ? (
        <Chip>
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
          </span>
          LIVE · {teamWithFlag(live.home)} vs {teamWithFlag(live.away)}
        </Chip>
      ) : next ? (
        <Chip>
          ⏱ Next · {getTeamFlag(next.home) || ""}
          {getTeamFlag(next.home) ? " " : ""}vs {getTeamFlag(next.away) || ""}
          {getTeamFlag(next.away) ? " " : ""}in {formatCountdown(new Date(next.kickoff).getTime() - nowMs)}
        </Chip>
      ) : null}

      {todayCount > 0 && <Chip>📅 {todayCount} today</Chip>}

      {favourite && favFixture && (
        <Chip>
          {teamWithFlag(favourite)} ·{" "}
          {favLive
            ? "playing now"
            : `in ${formatCountdown(new Date(favFixture.kickoff).getTime() - nowMs)}`}
        </Chip>
      )}
    </div>
  );
}
