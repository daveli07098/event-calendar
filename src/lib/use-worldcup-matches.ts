"use client";

import { useEffect, useState } from "react";
import {
  isWorldCupEvent,
  parseGroupMatch,
  parseKnockoutMatch,
} from "@/lib/worldcup";
import type { EventType } from "@/types";

/** A normalized World Cup fixture, group-stage or knockout. */
export interface WorldCupFixture {
  eventId: string;
  home: string;
  away: string;
  kickoff: string; // ISO
  /** "A".."L" for group games, or an EN round label for knockouts. */
  stage: string;
  isKnockout: boolean;
}

const TOURNAMENT_START = "2026-06-01T00:00:00.000Z";
const TOURNAMENT_END = "2026-07-31T23:59:59.000Z";

function toFixture(e: EventType): WorldCupFixture | null {
  const g = parseGroupMatch(e);
  if (g) {
    return {
      eventId: g.eventId,
      home: g.home,
      away: g.away,
      kickoff: g.kickoff,
      stage: g.group,
      isKnockout: false,
    };
  }
  const k = parseKnockoutMatch(e);
  if (k) {
    return {
      eventId: k.eventId,
      home: k.home,
      away: k.away,
      kickoff: k.kickoff,
      stage: k.roundLabel,
      isKnockout: true,
    };
  }
  return null;
}

/**
 * Loads every World Cup fixture in the tournament window, kickoff-sorted.
 * Fetches once when `enabled` flips true; degrades to an empty list on error so
 * the banner simply hides its live strip rather than breaking.
 */
export function useWorldCupMatches(enabled: boolean): {
  matches: WorldCupFixture[];
  loaded: boolean;
} {
  const [matches, setMatches] = useState<WorldCupFixture[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    fetch(`/api/events?start=${TOURNAMENT_START}&end=${TOURNAMENT_END}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((json: unknown) => {
        if (cancelled) return;
        const events = Array.isArray(json)
          ? (json as EventType[]).filter(isWorldCupEvent)
          : [];
        const fixtures = events
          .map(toFixture)
          .filter((f): f is WorldCupFixture => f !== null)
          .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
        setMatches(fixtures);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loaded]);

  return { matches, loaded };
}
