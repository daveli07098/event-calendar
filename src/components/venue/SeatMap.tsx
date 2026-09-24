"use client";

import type { SeatParseResult } from "@/lib/seat-parse";
import type { LevelConfig, StagePosition, VenueSeatMapConfig, ViewingAngleBucket } from "@/lib/venue-seatmap/types";
import { DEFAULT_STAGE_POSITION, isFloorLevel, layoutOf, locateBlock, resolveSeatGeometry, THEATRE_HEDGE } from "@/lib/venue-seatmap/geometry";
import { configForVenue } from "@/lib/venue-seatmap/registry";
import { bandPath, floorBandRect, perimeterKindFor, planRectsFor, ringPath, seatPlanPoint } from "@/lib/venue-seatmap/perimeter";
import { hasConfirmedRange } from "@/lib/venue-seatmap/bowl3d";

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
  /** An explicit venue config (e.g. one drafted from an uploaded seating plan). When given it
   * is used instead of matching `venue` by name; `venue` stays the fallback. */
  config?: VenueSeatMapConfig | null;
  /** Defaults to the venue's documented default concert layout — see geometry.ts. Pass the
   * real value for an event known to use a different configuration (four-sided, sports). */
  stagePosition?: StagePosition;
  className?: string;
}

const VIEWBOX_PAD = 24;

const VIEWING_ANGLE_LABEL: Record<ViewingAngleBucket, string> = {
  "front-on": "front-on",
  oblique: "oblique",
  "side-on": "side-on",
  behind: "behind the performance area",
};

function toAbs(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x + VIEWBOX_PAD, y: p.y + VIEWBOX_PAD };
}

/** A floor-kind level's blocks in front-to-back order (confirmed ranges only), each with its
 * own range's size so `floorBandRect` stacks them the same way bowl3d.ts does. */
function floorBlocksOf(level: LevelConfig): { label: string; index: number; count: number }[] {
  const ranges: string[][] = [
    ...level.blockNumberRanges
      .filter((r) => r.positionConfidence === "confirmed")
      .map((r) => Array.from({ length: r.max - r.min + 1 }, (_, i) => String(r.min + i))),
    ...(level.blockLabelRanges ?? []).filter((r) => r.positionConfidence === "confirmed").map((r) => r.labels),
  ];
  return ranges.flatMap((labels) => labels.map((label, index) => ({ label, index, count: labels.length })));
}

export function SeatMap({ venue, seat, config, stagePosition, className }: SeatMapProps) {
  if (!seat || seat.status === "unparseable") return null;

  const venueConfig = configForVenue(venue, config);
  if (!venueConfig) {
    return (
      <p className={`text-xs text-muted-foreground/70 ${className ?? ""}`} data-testid="seat-map-empty">
        No seat map available for this venue yet.
      </p>
    );
  }

  // Theatre layouts aren't projected (see geometry.ts) — a short muted note, never a bowl.
  if (layoutOf(venueConfig) === "theatre") {
    return (
      <p className={`text-xs text-muted-foreground/70 ${className ?? ""}`} data-testid="seat-map-theatre">
        {venueConfig.name}: {THEATRE_HEDGE}
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

  const { outer: OUTER, inner: INNER } = planRectsFor(venueConfig); // INNER = pitch / floor boundary
  const perimeterKind = perimeterKindFor(venueConfig);
  const isCentreStage = layoutOf(venueConfig) === "bowl-centre-stage";
  const VIEW_W = OUTER.width + VIEWBOX_PAD * 2;
  const VIEW_H = OUTER.height + VIEWBOX_PAD * 2;

  const isDefaultLayout = geometry.isDefaultStageLayout;
  const markerLocal = seatPlanPoint(venueConfig, geometry);
  const marker = markerLocal ? toAbs(markerLocal) : null;
  const seatLocation = locateBlock(venueConfig, geometry.block);
  // End stage: an 8-unit strip at the open short end. Centre stage: a compact square in the
  // middle of the floor.
  const stageRect = isCentreStage
    ? (() => {
        const side = Math.min(INNER.width, INNER.height) * 0.28;
        return { x: VIEWBOX_PAD + (OUTER.width - side) / 2, y: VIEWBOX_PAD + (OUTER.height - side) / 2, width: side, height: side };
      })()
    : { x: VIEWBOX_PAD + (OUTER.width - OUTER.width * 0.32) / 2, y: VIEWBOX_PAD + OUTER.height - 6, width: OUTER.width * 0.32, height: 8 };
  // Level bands span the U with a small gap at the stage seam, or (centre stage) a closed ring.
  const levelBandPath = (depthInner: number, depthOuter: number) =>
    perimeterKind === "four-sided"
      ? ringPath(depthInner, depthOuter, INNER, OUTER)
      : bandPath(0.02, 0.98, depthInner, depthOuter, INNER, OUTER);

  const angleLabel = geometry.viewingAngle ? VIEWING_ANGLE_LABEL[geometry.viewingAngle] : null;
  const distancePhrase = { close: "close to", mid: "a moderate distance from", far: "far from" }[geometry.distanceLabel];

  return (
    <div className={className} data-testid="seat-map">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full max-w-xs" role="img" aria-label={`Approximate seat map for ${venueConfig.name}, ${geometry.levelLabel} block ${geometry.block}`}>
        {/* Bowl wall */}
        <rect x={VIEWBOX_PAD} y={VIEWBOX_PAD} width={OUTER.width} height={OUTER.height} rx={18} className="fill-muted/40 stroke-border" strokeWidth={1.5} />

        {/* Level bands */}
        {venueConfig.levels.map((level) => {
          // Floor levels are drawn as blocks on the floor below; a stand level with no known
          // arc position for its blocks has nothing safe to draw as a band.
          if (isFloorLevel(level) || !hasConfirmedRange(level)) return null;
          const [depthInner, depthOuter] = level.radiusRange;
          const isMatchedLevel = level.id === geometry.levelId;
          return (
            <path
              key={level.id}
              // bandPath generates coordinates in local (unpadded) bowl space — translate the
              // whole path via a group transform rather than re-stringifying its points.
              d={levelBandPath(depthInner, depthOuter)}
              fillRule="evenodd"
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

        {/* Floor blocks — end stage only: depth bands straight out from the stage, block 0
            nearest it (see perimeter.ts's floorBandRect). */}
        {!isCentreStage &&
          venueConfig.levels.filter(isFloorLevel).flatMap((level) =>
            floorBlocksOf(level).map(({ label, index, count }) => {
              const rect = floorBandRect(index, count, INNER, OUTER);
              const isSeatBlock =
                !!seatLocation && seatLocation.level.id === level.id && seatLocation.index === index && seatLocation.count === count;
              return (
                <g key={`${level.id}-${label}`} data-testid="seat-map-floor-block">
                  <rect
                    x={VIEWBOX_PAD + rect.x + 2}
                    y={VIEWBOX_PAD + rect.y + 1}
                    width={Math.max(rect.width - 4, 0)}
                    height={Math.max(rect.height - 2, 0)}
                    rx={3}
                    className={isSeatBlock ? "fill-primary/30 stroke-primary/60" : "fill-emerald-600/15 stroke-emerald-700/40"}
                    strokeWidth={1}
                  />
                  <text
                    // Left-aligned so the seat marker (on the centre line) never covers it.
                    x={VIEWBOX_PAD + rect.x + 8}
                    y={VIEWBOX_PAD + rect.y + rect.height / 2}
                    textAnchor="start"
                    dominantBaseline="central"
                    fontSize={Math.min(rect.height * 0.5, 14)}
                    className="fill-muted-foreground"
                  >
                    {label}
                  </text>
                </g>
              );
            }),
          )}

        {/* Stage (default layout only — see geometry.ts on why other stage positions aren't geometrically rendered) */}
        {isDefaultLayout && (
          <rect x={stageRect.x} y={stageRect.y} width={stageRect.width} height={stageRect.height} rx={2} className="fill-amber-500/80" data-testid="seat-map-stage" />
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
