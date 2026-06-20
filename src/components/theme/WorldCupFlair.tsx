"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWorldCupMatches } from "@/lib/use-worldcup-matches";

/** A match counts as "live" for ~2h after kickoff (no scores needed). */
const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

// Cycling pennant colours — a friendly multi-nation palette.
const BUNTING_COLORS = [
  "#dc2626", "#fcd116", "#2563eb", "#16a34a",
  "#f97316", "#a855f7", "#06b6d4", "#ffffff",
];

/**
 * Decorative string of triangular pennants hung across the top while the World
 * Cup theme is active — a stadium/tournament flourish. Purely decorative
 * (aria-hidden); a thin strip that gently sways. Renders nothing otherwise.
 */
export function FlagBunting() {
  const { theme } = useTheme();
  if (theme.eventTheme !== "worldcup") return null;
  return (
    <div className="ec-bunting" aria-hidden="true">
      {Array.from({ length: 60 }).map((_, i) => (
        <span
          key={i}
          className="ec-bunting-flag"
          style={{
            borderTopColor: BUNTING_COLORS[i % BUNTING_COLORS.length],
            animationDelay: `${(i % 6) * 120}ms`,
          }}
        />
      ))}
    </div>
  );
}

function shortCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m >= 1440) return `${Math.floor(m / 1440)}d`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

/**
 * Turns the browser tab into a World Cup tab while the theme is active: swaps
 * the favicon to a ⚽ and sets the document title to the live match (or next
 * kickoff). Restores the original title/favicon when the theme is switched off
 * or the component unmounts. Renders nothing.
 */
export function WorldCupTabFlair() {
  const { theme } = useTheme();
  const active = theme.eventTheme === "worldcup";
  const { matches } = useWorldCupMatches(active);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const originalTitle = useRef<string | null>(null);
  const originalIcon = useRef<string | null>(null);

  // Refresh the label periodically so the live/next match stays current.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);

  // Swap the favicon while active; restore on cleanup.
  useEffect(() => {
    if (!active) return;
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (link) {
      originalIcon.current = link.getAttribute("href");
      link.setAttribute(
        "href",
        "data:image/svg+xml," +
          encodeURIComponent(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>",
          ),
      );
    }
    return () => {
      if (link && originalIcon.current !== null) link.setAttribute("href", originalIcon.current);
    };
  }, [active]);

  // Set the tab title to the current/next match; restore the original on cleanup.
  useEffect(() => {
    if (!active) return;
    if (originalTitle.current === null) originalTitle.current = document.title;

    const live = matches.find((m) => {
      const k = new Date(m.kickoff).getTime();
      return k <= nowMs && nowMs < k + LIVE_WINDOW_MS;
    });
    const next = matches.find((m) => new Date(m.kickoff).getTime() > nowMs);

    let label = "⚽ World Cup";
    if (live) label = `⚽ LIVE · ${live.home} vs ${live.away}`;
    else if (next) label = `⚽ ${next.home} vs ${next.away} · ${shortCountdown(new Date(next.kickoff).getTime() - nowMs)}`;
    document.title = label;

    return () => {
      if (originalTitle.current !== null) document.title = originalTitle.current;
    };
  }, [active, matches, nowMs]);

  return null;
}
