/**
 * Built-in venue config registry + free-text venue-name matching. Deliberately conservative:
 * a venue with no config renders nothing (see the component), and this matcher never returns
 * a wrong config for the sake of returning *something*.
 */

import type { VenueSeatMapConfig } from "./types";
import { kaiTakStadium } from "./venues/kai-tak";

const REGISTRY: VenueSeatMapConfig[] = [kaiTakStadium];

/**
 * Matches a free-text venue name/address (as typically stored on an event's location field)
 * against the built-in registry. Only matches on a venue's full confirmed aliases
 * (case-insensitive substring) — never a bare landmark name. Kai Tak Cruise Terminal
 * (啟德郵輪碼頭) is a real, separate Hong Kong concert venue that happens to share the "Kai
 * Tak" landmark name with Kai Tak Stadium; matching on "Kai Tak" alone would render a
 * confidently wrong seat map for it, which is worse than rendering no map at all.
 */
export function matchVenueConfig(venueName: string | null | undefined): VenueSeatMapConfig | null {
  if (!venueName) return null;
  const normalized = venueName.toLowerCase();
  for (const venue of REGISTRY) {
    if (venue.aliases.some((alias) => normalized.includes(alias.toLowerCase()))) return venue;
  }
  return null;
}

export function getVenueSeatMapConfigById(id: string): VenueSeatMapConfig | null {
  return REGISTRY.find((venue) => venue.id === id) ?? null;
}

export function listVenueSeatMapConfigs(): readonly VenueSeatMapConfig[] {
  return REGISTRY;
}
