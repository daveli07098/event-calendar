"use client";

/**
 * Client-side access to the community seat-map directory (GET /api/venues/seatmaps).
 *
 * One module-scope promise is shared by every consumer — the venue directory's seat-map panels
 * and EventModal's projection — so the list is fetched at most once per page load until
 * something invalidates it (a save/remove in the panel). Failures resolve to an empty list:
 * seat maps are an enhancement, and a missing list must never break the modal or directory.
 */

import { useEffect, useState } from "react";
import type { VenueSeatMapListEntry } from "@/app/api/venues/seatmaps/route";
import type { VenueSeatMapConfig } from "./types";

export type { VenueSeatMapListEntry };

let cached: Promise<VenueSeatMapListEntry[]> | null = null;
let cacheError = false;
const listeners = new Set<() => void>();

async function fetchList(): Promise<VenueSeatMapListEntry[]> {
  cacheError = false;
  try {
    if (typeof fetch === "undefined") return [];
    const res = await fetch("/api/venues/seatmaps");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { venues?: VenueSeatMapListEntry[] };
    return Array.isArray(data?.venues) ? data.venues : [];
  } catch {
    cacheError = true;
    return [];
  }
}

/** The shared, cached seat-map list. Never rejects. */
export function loadVenueSeatMaps(): Promise<VenueSeatMapListEntry[]> {
  cached ??= fetchList();
  return cached;
}

/** Drops the cached list and tells every mounted hook to refetch. Call after a PUT/DELETE. */
export function invalidateVenueSeatMapsCache(): void {
  cached = null;
  for (const notify of listeners) notify();
}

/** Only approved configs are used for projection on events — drafts are unreviewed. */
export function approvedConfigsOf(entries: readonly VenueSeatMapListEntry[]): VenueSeatMapConfig[] {
  return entries.flatMap((e) => (e.status === "approved" && e.config ? [e.config] : []));
}

const EMPTY: VenueSeatMapListEntry[] = [];

export interface UseVenueSeatMapsResult {
  entries: VenueSeatMapListEntry[];
  approvedConfigs: VenueSeatMapConfig[];
  loading: boolean;
  /** True when the last fetch failed (entries is then empty). */
  error: boolean;
  /** True once the first load has resolved (success or failure) — stays true across refetches,
   * so consumers can gate on it without unmounting on every invalidation. */
  loaded: boolean;
}

/**
 * Loads the seat-map list once `enabled` is true (EventModal passes "a seat has been entered",
 * so a plain event edit never triggers the request).
 */
export function useVenueSeatMaps(enabled = true): UseVenueSeatMapsResult {
  const [entries, setEntries] = useState<VenueSeatMapListEntry[]>(EMPTY);
  const [approvedConfigs, setApprovedConfigs] = useState<VenueSeatMapConfig[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const bump = () => setGeneration((g) => g + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflecting the start of an async load
    setLoading(true);
    loadVenueSeatMaps().then((list) => {
      if (cancelled) return;
      setEntries(list);
      setApprovedConfigs(approvedConfigsOf(list));
      setError(cacheError);
      setLoading(false);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, generation]);

  return { entries, approvedConfigs, loading: enabled && loading, error, loaded };
}
