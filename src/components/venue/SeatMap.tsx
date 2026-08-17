"use client";

import type { SeatParseResult } from "@/lib/seat-parse";
import type { StagePosition, ViewingAngleBucket } from "@/lib/venue-seatmap/types";
import { DEFAULT_STAGE_POSITION, resolveSeatGeometry } from "@/lib/venue-seatmap/geometry";
import { matchVenueConfig } from "@/lib/venue-seatmap/registry";
import { bandPath, pointAtDepth, type RectSize } from "@/lib/venue-seatmap/perimeter";

/**
 * Procedural 2D-SVG venue seat map. Consumes an already-parsed seat (from `parseSeat`, see
 * seat-parse.ts) plus a free-text venue name, and renders a plan-view bowl driven by the
 * matched venue's config (see src/lib/venue-seatmap). No top-level side effects and a single
 * named export, so this is safe to load via `next/dynamic`:
 *
 *   const SeatMap = dynamic(() => import("@/components/venue/SeatMap").then((m) => m.SeatMap));
 *
 * Graceful degradation is load-bearing here, not an afterthought: an unmatched venue, or a
 * seat with no resolvable block, renders a small muted hint — never a generic bowl with a
 * guessed marker.
 */
export interface SeatMapProps {
  /** Free-text venue name/address as stored on the event (e.g. its `location` field). */
  venue: string | null | undefined;
  /** Already-parsed seat, e.g. EventModal's `seatParseResult`. */
  seat: SeatParseResult | null | undefined;
  /** Defaults to the venue's documented default concert layout — see geometry.ts. Pass the
   * real value for an event known to use a different configuration (four-sided, sports). */
  stagePosition?: StagePosition;
  className?: string;
}

const OUTER: RectSize = { width: 220, height: 260 };
const INNER: RectSize = { width: 100, height: 150 }; // pitch boundary
const VIEWBOX_PAD = 24;
const VIEW_W = OUTER.width + VIEWBOX_PAD * 2;
const VIEW_H = OUTER.height + VIEWBOX_PAD * 2;

const VIEWING_ANGLE_LABEL: Record<ViewingAngleBucket, string> = {
  "front-on": "front-on",
  oblique: "oblique",
  "side-on": "side-on",
  behind: "behind the performance area",
};

function toAbs(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x + VIEWBOX_PAD, y: p.y + VIEWBOX_PAD };
}

export function SeatMap({ venue, seat, stagePosition, className }: SeatMapProps) {
  if (!seat || seat.status === "unparseable") return null;

  const venueConfig = matchVenueConfig(venue);
  if (!venueConfig) {
    return (
      <p className={`text-xs text-muted-foreground/70 ${className ?? ""}`} data-testid="seat-map-empty">
        No seat map available for this venue yet.
      </p>
    );
  }

  const geometry = resolveSeatGeometry(venueConfig, seat.fields, { stagePosition });
  if (!geometry) {
    return (
      <p className={`text-xs text-muted-foreground/70 ${className ?? ""}`} data-testid="seat-map-empty">
        {venueConfig.name}: no block number to map for this seat yet.
      </p>
    );
  }

  const isDefaultLayout = geometry.isDefaultStageLayout;
  const marker = geometry.angleFraction !== null
    ? toAbs(pointAtDepth(geometry.angleFraction, geometry.depthFraction, INNER, OUTER))
    : null;
  const stageWidth = OUTER.width * 0.32;
  const stageX = VIEWBOX_PAD + (OUTER.width - stageWidth) / 2;
  const stageY = VIEWBOX_PAD + OUTER.height - 6;

  const angleLabel = geometry.viewingAngle ? VIEWING_ANGLE_LABEL[geometry.viewingAngle] : null;
  const distancePhrase = { close: "close to", mid: "a moderate distance from", far: "far from" }[geometry.distanceLabel];

  return (
    <div className={className} data-testid="seat-map">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full max-w-xs" role="img" aria-label={`Approximate seat map for ${venueConfig.name}, ${geometry.levelLabel} block ${geometry.block}`}>
        {/* Bowl wall */}
        <rect x={VIEWBOX_PAD} y={VIEWBOX_PAD} width={OUTER.width} height={OUTER.height} rx={18} className="fill-muted/40 stroke-border" strokeWidth={1.5} />

        {/* Level bands */}
        {venueConfig.levels.map((level) => {
          const confirmedRange = level.blockNumberRanges.find((r) => r.positionConfidence === "confirmed");
          if (!confirmedRange) return null; // no known arc position for this level's blocks — nothing safe to draw as a band
          const [depthInner, depthOuter] = level.radiusRange;
          const isMatchedLevel = level.id === geometry.levelId;
          return (
            <path
              key={level.id}
              // bandPath generates coordinates in local (unpadded) bowl space — translate the
              // whole path via a group transform rather than re-stringifying its points.
              d={bandPath(0.02, 0.98, depthInner, depthOuter, INNER, OUTER)}
              transform={`translate(${VIEWBOX_PAD} ${VIEWBOX_PAD})`}
              className={isMatchedLevel ? "fill-primary/10 stroke-primary/40" : "fill-transparent stroke-border/70"}
              strokeWidth={1}
            />
          );
        })}

        {/* Pitch / floor */}
        <rect
          x={VIEWBOX_PAD + (OUTER.width - INNER.width) / 2}
          y={VIEWBOX_PAD + (OUTER.height - INNER.height) / 2}
          width={INNER.width}
          height={INNER.height}
          rx={10}
          className="fill-emerald-600/25 stroke-emerald-700/40"
          strokeWidth={1}
        />

        {/* Stage (default layout only — see geometry.ts on why other stage positions aren't geometrically rendered) */}
        {isDefaultLayout && (
          <rect x={stageX} y={stageY} width={stageWidth} height={8} rx={2} className="fill-amber-500/80" />
        )}

        {/* Approximate seat marker — position derives from the block's arc position and the
            row's depth within it; see geometry.ts for how depthFraction is composed. */}
        {marker && (
          <circle cx={marker.x} cy={marker.y} r={5} className="fill-primary stroke-background" strokeWidth={1.5} />
        )}
      </svg>

      <p className="text-xs text-muted-foreground mt-1">
        <span className="font-medium text-foreground">{geometry.levelLabel}</span>
        {" · Block "}
        {geometry.block}
        {geometry.row ? ` · Row ${geometry.row}` : ""}
        {" — approximately "}
        {distancePhrase} the stage
        {angleLabel ? `, ${angleLabel}${geometry.isDocumentedBestFacing || geometry.isDocumentedMostOblique || geometry.isDocumentedClosedForConcerts ? "" : " (approximate)"}` : ""}
        {"."}
      </p>
      {geometry.isDocumentedClosedForConcerts && (
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
          Reported unopened for concerts — this block may not be sold for this event.
        </p>
      )}
      {geometry.hedge.length > 0 && (
        <ul className="text-[11px] text-muted-foreground/70 mt-1 space-y-0.5">
          {geometry.hedge.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground/60 mt-1 italic">
        Approximate, block-level position only — not a verified seat plan.
      </p>
    </div>
  );
}

export { DEFAULT_STAGE_POSITION };
