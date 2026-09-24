/**
 * Built-in venue config registry + free-text venue-name matching. Deliberately conservative:
 * a venue with no config renders nothing (see the component), and this matcher never returns
 * a wrong config for the sake of returning *something*.
 */

import type { VenueSeatMapConfig } from "./types";
import { kaiTakStadium } from "./venues/kai-tak";

const REGISTRY: VenueSeatMapConfig[] = [kaiTakStadium];

function matchIn(normalized: string, configs: readonly VenueSeatMapConfig[]): VenueSeatMapConfig | null {
  for (const venue of configs) {
    if (venue.aliases.some((alias) => alias.trim() !== "" && normalized.includes(alias.toLowerCase()))) return venue;
  }
  return null;
}

/**
 * Matches a free-text venue name/address (as typically stored on an event's location field)
 * against the built-in registry. Only matches on a venue's full confirmed aliases
 * (case-insensitive substring) — never a bare landmark name. Kai Tak Cruise Terminal
 * (啟德郵輪碼頭) is a real, separate Hong Kong concert venue that happens to share the "Kai
 * Tak" landmark name with Kai Tak Stadium; matching on "Kai Tak" alone would render a
 * confidently wrong seat map for it, which is worse than rendering no map at all.
 *
 * `extra` holds runtime configs (e.g. drafted from an uploaded seating plan and loaded from
 * the DB). The static registry is always tried first — so a runtime config can never shadow
 * Kai Tak — then `extra` by the same alias rule, falling back to each extra config's `name`
 * (a drafted config may carry few aliases). Empty aliases/names never match.
 */
export function matchVenueConfig(
  venueName: string | null | undefined,
  extra?: readonly VenueSeatMapConfig[] | null,
): VenueSeatMapConfig | null {
  if (!venueName) return null;
  const normalized = venueName.toLowerCase();
  const builtIn = matchIn(normalized, REGISTRY);
  if (builtIn) return builtIn;
  if (!extra?.length) return null;
  return (
    matchIn(normalized, extra) ??
    extra.find((venue) => venue.name.trim() !== "" && normalized.includes(venue.name.trim().toLowerCase())) ??
    null
  );
}

/** The config a seat-map component should render: an explicitly supplied one wins (e.g. a
 * venue record's own drafted config), else name matching via `matchVenueConfig`. */
export function configForVenue(
  venueName: string | null | undefined,
  explicit?: VenueSeatMapConfig | null,
  extra?: readonly VenueSeatMapConfig[] | null,
): VenueSeatMapConfig | null {
  return explicit ?? matchVenueConfig(venueName, extra);
}

export function getVenueSeatMapConfigById(id: string): VenueSeatMapConfig | null {
  return REGISTRY.find((venue) => venue.id === id) ?? null;
}

export function listVenueSeatMapConfigs(): readonly VenueSeatMapConfig[] {
  return REGISTRY;
}
