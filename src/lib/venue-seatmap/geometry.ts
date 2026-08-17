/**
 * Resolves a parsed seat + a venue config into plain-object geometry facts. Pure, synchronous,
 * no rendering concerns here (see perimeter.ts for the SVG-placement layer that consumes this).
 *
 * Hard requirement (see project brief): an unknown venue, an unknown block, or a block whose
 * arc position isn't documented must never produce a guessed position. `resolveSeatGeometry`
 * returns `null` for the first two, and leaves `angleFraction`/`viewingAngle` `null` for the
 * third rather than inventing a bucket for a range explicitly marked `positionConfidence:
 * "unconfirmed"`.
 */

import type { ParsedSeatFields } from "@/lib/seat-parse";
import type {
  BlockNumberRange,
  Confidence,
  DistanceLabel,
  LevelConfig,
  SeatGeometryFacts,
  StagePosition,
  ViewingAngleBucket,
  VenueSeatMapConfig,
} from "./types";
import { bankedRowDepthFraction, defaultRowDepthFraction } from "./rows";

/**
 * Default concert stage layout — the self-consistent reading of the sources (numbering seam
 * at the stage + block 520, the 501-540 range midpoint, being reported best-facing implies a
 * short-end stage; see the project brief for the full ambiguity discussion). This lives here,
 * as a resolver-level default, deliberately NOT inside any venue config — the same bowl also
 * hosts four-sided (四面台) shows and sports with no stage at all, so stage position must stay
 * a per-render parameter.
 */
export const DEFAULT_STAGE_POSITION: StagePosition = "shortEndA";

// Calibration heuristic: how many blocks away from a documented stage-facing range a block
// can be while still borrowing that range's bucket label. Chosen deliberately small (roughly
// a fifth of the ~40-block main tiers) so it stays "local" to the documented anchor rather
// than sprawling across the whole level. Must stay >= 5 for block 225 (Level 2) to resolve to
// "side-on" via its nearest documented anchor (230-231, 5 blocks away) rather than falling
// through to the "oblique" default — see venue-seatmap.test.ts.
const ANCHOR_PROXIMITY_BLOCKS = 8;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Splits a block string into its numeric part and optional trailing single-letter suffix
 * (e.g. "519B" -> {numeric:519, suffix:"B"}). Returns `null` for anything else — this module
 * never guesses at a malformed block string. */
function parseBlockNumeric(block: string): { numeric: number; suffix: string | null } | null {
  const m = block.match(/^(\d{1,4})([A-Za-z]?)$/);
  if (!m) return null;
  return { numeric: Number(m[1]), suffix: m[2] ? m[2].toUpperCase() : null };
}

function findLevelAndRange(
  config: VenueSeatMapConfig,
  numeric: number,
): { level: LevelConfig; range: BlockNumberRange } | null {
  for (const level of config.levels) {
    for (const range of level.blockNumberRanges) {
      if (numeric >= range.min && numeric <= range.max) return { level, range };
    }
  }
  return null;
}

function rangesContain(ranges: [number, number][] | undefined, n: number): boolean {
  return !!ranges?.some(([a, b]) => n >= a && n <= b);
}

/**
 * Classifies a block's viewing angle against a level's documented stage-facing facts (default
 * layout only). An exact match against a documented range wins outright; otherwise the
 * nearest documented range's bucket is borrowed if it's within `ANCHOR_PROXIMITY_BLOCKS`, and
 * "oblique" is the catch-all default for anything not close to any documented anchor.
 */
function classifyViewingAngle(
  level: LevelConfig,
  numeric: number,
): { bucket: ViewingAngleBucket; exact: boolean } | null {
  if (!level.stageFacing) return null;

  const anchors: { ranges: [number, number][]; bucket: ViewingAngleBucket }[] = [
    { ranges: level.stageFacing.best ?? [], bucket: "front-on" },
    { ranges: level.stageFacing.mostOblique ?? [], bucket: "side-on" },
    { ranges: level.stageFacing.closedForConcerts ?? [], bucket: "behind" },
  ];

  for (const anchor of anchors) {
    if (rangesContain(anchor.ranges, numeric)) return { bucket: anchor.bucket, exact: true };
  }

  let nearest: { bucket: ViewingAngleBucket; distance: number } | null = null;
  for (const anchor of anchors) {
    for (const [a, b] of anchor.ranges) {
      const distance = numeric < a ? a - numeric : numeric > b ? numeric - b : 0;
      if (!nearest || distance < nearest.distance) nearest = { bucket: anchor.bucket, distance };
    }
  }

  if (nearest && nearest.distance <= ANCHOR_PROXIMITY_BLOCKS) return { bucket: nearest.bucket, exact: false };
  return { bucket: "oblique", exact: false };
}

/** Radial position (0 = pitch edge, 1 = outer wall) within a level's band, given a row depth
 * fraction. An unknown row falls back to the middle of the level's band rather than either
 * extreme. */
function tierRadialFraction(level: LevelConfig, rowDepthFraction: number | null): number {
  const [inner, outer] = level.radiusRange;
  const rowFraction = rowDepthFraction ?? 0.5;
  return inner + rowFraction * (outer - inner);
}

/** How far "around the loop" a block is from the stage seam, expressed as a 0..1 contribution
 * to overall distance-to-stage: 0 right at the seam (adjacent to the stage), 1 directly
 * opposite it. Unconfirmed/unknown arc position contributes a neutral middle value rather
 * than an assumed near or far. */
function arcDistanceComponent(angleFraction: number | null): number {
  if (angleFraction === null) return 0.5;
  return 1 - 2 * Math.abs(angleFraction - 0.5);
}

function computeDepthFraction(
  level: LevelConfig,
  rowDepthFraction: number | null,
  angleFraction: number | null,
  hasStage: boolean,
): number {
  const radial = tierRadialFraction(level, rowDepthFraction);
  if (!hasStage) return radial;
  const arc = arcDistanceComponent(angleFraction);
  return clamp01(radial * 0.65 + arc * 0.35);
}

function distanceLabelFor(depthFraction: number): DistanceLabel {
  if (depthFraction <= 0.3) return "close";
  if (depthFraction <= 0.65) return "mid";
  return "far";
}

export interface ResolveSeatGeometryOptions {
  /** Defaults to `DEFAULT_STAGE_POSITION`. */
  stagePosition?: StagePosition;
}

/**
 * Resolves parsed seat fields against a venue config. Returns `null` when there's no config,
 * no block, or the block doesn't fall in any of the config's numbered ranges — by design,
 * never a guessed centre.
 */
export function resolveSeatGeometry(
  config: VenueSeatMapConfig | null | undefined,
  fields: ParsedSeatFields | null | undefined,
  options: ResolveSeatGeometryOptions = {},
): SeatGeometryFacts | null {
  if (!config) return null;
  if (!fields?.block?.value) return null;

  const parsedBlock = parseBlockNumeric(fields.block.value);
  if (!parsedBlock) return null;

  const found = findLevelAndRange(config, parsedBlock.numeric);
  if (!found) return null;
  const { level, range } = found;

  const stagePosition = options.stagePosition ?? DEFAULT_STAGE_POSITION;
  const isDefaultStageLayout = stagePosition === DEFAULT_STAGE_POSITION;
  const hasStage = stagePosition !== "none";

  const positionKnown = range.positionConfidence === "confirmed";
  const angleFraction = positionKnown
    ? (parsedBlock.numeric - range.min) / Math.max(range.max - range.min, 1)
    : null;

  const row = fields.row?.value ?? null;
  const rowDepthFraction = row
    ? level.rowBankSplit
      ? bankedRowDepthFraction(row, level.rowBankSplit)
      : defaultRowDepthFraction(row)
    : null;

  const depthFraction = computeDepthFraction(level, rowDepthFraction, angleFraction, hasStage);
  const distanceLabel = distanceLabelFor(depthFraction);

  let viewingAngle: ViewingAngleBucket | null = null;
  let isDocumentedBestFacing = false;
  let isDocumentedMostOblique = false;
  let isDocumentedClosedForConcerts = false;
  if (hasStage && isDefaultStageLayout && positionKnown) {
    const classification = classifyViewingAngle(level, parsedBlock.numeric);
    if (classification) {
      viewingAngle = classification.bucket;
      if (classification.exact) {
        isDocumentedBestFacing = classification.bucket === "front-on";
        isDocumentedMostOblique = classification.bucket === "side-on";
        isDocumentedClosedForConcerts = classification.bucket === "behind";
      }
    }
  }

  const wrapConfidence: Confidence = level.wrap?.confirmed ? "confirmed" : "unconfirmed";
  const rowBankConfidence: Confidence = level.rowBankSplit?.confidence ?? "unconfirmed";

  const hedge: string[] = [];
  if (!positionKnown) {
    hedge.push(
      `${level.label} block ${fields.block.value}'s position around the bowl is unconfirmed — showing the level only, not a precise spot.`,
    );
  }
  if (hasStage && !isDefaultStageLayout) {
    hedge.push("Viewing-angle and stage-facing notes assume the default concert stage layout; this event's stage position may differ.");
  }
  if (level.blockNumberRanges.length > 0 && level.wrap && !level.wrap.confirmed) {
    hedge.push(level.wrap.note);
  }
  if (row && rowDepthFraction === null) {
    hedge.push(`Row ${row} isn't in ${level.label}'s documented row set — depth shown is an approximate block-level position only.`);
  }
  if (parsedBlock.suffix && config.blockSuffixConfidence === "unconfirmed") {
    hedge.push(`Block suffix "${parsedBlock.suffix}" likely marks a stair/vomitory sub-division of block ${parsedBlock.numeric} — its exact meaning is unconfirmed.`);
  }

  return {
    venueId: config.id,
    levelId: level.id,
    levelLabel: level.label,
    block: fields.block.value,
    blockNumeric: parsedBlock.numeric,
    blockSuffix: parsedBlock.suffix,
    row,
    tier: level.tier,
    angleFraction,
    rowDepthFraction,
    depthFraction,
    distanceLabel,
    viewingAngle,
    isDocumentedBestFacing,
    isDocumentedMostOblique,
    isDocumentedClosedForConcerts,
    stagePosition,
    isDefaultStageLayout,
    confidence: {
      level: fields.level?.source ?? "unknown",
      blockPosition: range.positionConfidence,
      wrap: wrapConfidence,
      rowBank: rowBankConfidence,
    },
    hedge,
  };
}
