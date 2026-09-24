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
  VenueLayout,
  DistanceLabel,
  LevelConfig,
  SeatGeometryFacts,
  StagePosition,
  ViewingAngleBucket,
  VenueSeatMapConfig,
} from "./types";
import { bankedRowDepthFraction, defaultRowDepthFraction, numericRowDepthFraction, sequenceRowDepthFraction } from "./rows";

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

/** Shown instead of a position for a `"theatre"` layout — rows facing a proscenium aren't
 * projected yet, so the seat breakdown is all the UI gets (never a guessed spot). */
export const THEATRE_HEDGE = "Theatre layouts aren't projected yet — showing the seat breakdown only.";

const CENTRE_STAGE_HEDGE =
  "In-the-round staging: every stand faces the central stage, so the viewing angle is front-on for all stand seats — sightlines to screens and performers still vary by show.";
const FLOOR_PLACEMENT_HEDGE =
  "Floor blocks are placed as depth bands straight in front of the stage — the actual floor layout can vary by show.";
const GENERIC_ANGLE_HEDGE =
  "No documented stage-facing data for this level — the viewing angle is estimated from the block's position around the bowl.";

// A floor seat's distance-to-stage proxy: the back of the floor counts as this fraction of
// the way to "far" — a flat floor is closer to the stage than the upper stands behind it.
const FLOOR_DISTANCE_SPAN = 0.7;

/** The venue's layout, defaulting to end-stage for configs written before `layout` existed. */
export function layoutOf(config: VenueSeatMapConfig): VenueLayout {
  return config.layout ?? "bowl-end-stage";
}

export function isFloorLevel(level: LevelConfig): boolean {
  return level.kind === "floor";
}

/** Where a block sits within the config: its level, its 0-based position within its range
 * (`index` of `count` blocks, in the range's documented order), and that range's position
 * confidence. Numbered ranges are tried first, then label ranges (case-insensitive exact
 * match). `null` when the block isn't in any configured range — never a nearest guess. */
export interface BlockLocation {
  level: LevelConfig;
  numeric: number | null;
  suffix: string | null;
  index: number;
  count: number;
  positionConfidence: Confidence;
}

export function locateBlock(config: VenueSeatMapConfig, block: string): BlockLocation | null {
  const parsedBlock = parseBlockNumeric(block);
  if (parsedBlock) {
    const found = findLevelAndRange(config, parsedBlock.numeric);
    if (found) {
      return {
        level: found.level,
        numeric: parsedBlock.numeric,
        suffix: parsedBlock.suffix,
        index: parsedBlock.numeric - found.range.min,
        count: found.range.max - found.range.min + 1,
        positionConfidence: found.range.positionConfidence,
      };
    }
  }
  const wanted = block.trim().toUpperCase();
  if (!wanted) return null;
  for (const level of config.levels) {
    for (const range of level.blockLabelRanges ?? []) {
      const index = range.labels.findIndex((label) => label.trim().toUpperCase() === wanted);
      if (index !== -1) {
        return { level, numeric: null, suffix: null, index, count: range.labels.length, positionConfidence: range.positionConfidence };
      }
    }
  }
  return null;
}

/**
 * Theatre-only fallback for when there's no `block` match at all: seat-parse maps CJK/English
 * theatre-tier terms (堂座/Stalls, 樓座/Circle, …) onto `area`, never `block` (see seat-parse.ts
 * header point 10) — so a ticket like "堂座 F排 22號" has no `block` field to resolve against.
 * Two strategies, tried in order, NEVER used outside a `"theatre"` layout and NEVER producing a
 * position (the caller's `projectable` check already suppresses that for every theatre seat
 * regardless of how the level was found here):
 *  1. Match `area` against a level's own label or any of its `blockLabelRanges` labels,
 *     case-insensitively (Xiqu Centre Grand Theatre: area "Stalls" -> the "Stalls / 堂座" level).
 *  2. If there's neither a `block` nor an `area` to go on, but the config has exactly one level
 *     (East Kowloon Cultural Centre's single "Main" level) and the ticket at least carries a row
 *     or seat, resolve straight to that sole level — there's nowhere else it could be.
 * Returns `null` (never a guess) when neither strategy finds an unambiguous level.
 */
function locateTheatreLevel(
  config: VenueSeatMapConfig,
  fields: ParsedSeatFields,
): { level: LevelConfig; blockLabel: string; positionConfidence: Confidence } | null {
  const areaRaw = fields.area?.value;
  const areaValue = areaRaw?.trim().toUpperCase();
  if (areaRaw && areaValue) {
    for (const level of config.levels) {
      if (level.label.trim().toUpperCase() === areaValue) {
        return { level, blockLabel: areaRaw, positionConfidence: "unconfirmed" };
      }
      for (const range of level.blockLabelRanges ?? []) {
        const label = range.labels.find((l) => l.trim().toUpperCase() === areaValue);
        if (label) return { level, blockLabel: label, positionConfidence: range.positionConfidence };
      }
    }
  }

  if (!fields.block?.value && !fields.area?.value && (fields.row?.value || fields.seat?.value) && config.levels.length === 1) {
    const level = config.levels[0];
    const blockLabel = level.blockLabelRanges?.[0]?.labels[0] ?? level.label;
    return { level, blockLabel, positionConfidence: "unconfirmed" };
  }

  return null;
}

/** 0..1 position of a floor seat from the stage (0 = front edge of the frontmost block, 1 =
 * back of the backmost), from its block's front-to-back index plus its row depth. An unknown
 * row sits mid-block. */
export function floorPositionFraction(index: number, count: number, rowDepthFraction: number | null): number {
  return clamp01((index + (rowDepthFraction ?? 0.5)) / Math.max(count, 1));
}

/** Viewing-angle estimate for an end-stage stand level with no documented stage-facing data:
 * straight down the bowl from the stage (angleFraction ~0.5) is front-on, the stretch next
 * to the stage seam is side-on, oblique in between. */
function genericEndStageBucket(angleFraction: number): ViewingAngleBucket {
  const fromCentre = Math.abs(angleFraction - 0.5);
  if (fromCentre <= 0.15) return "front-on";
  if (fromCentre <= 0.35) return "oblique";
  return "side-on";
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
 * no block, or the block doesn't fall in any of the config's numbered or labelled ranges — by
 * design, never a guessed centre.
 *
 * Placement by layout (see `VenueLayout`):
 *  - end stage, stand level: `angleFraction` = the block's index along its range (0/1 at the
 *    stage seam, 0.5 opposite) — numbered and label blocks alike.
 *  - end stage, floor level: `angleFraction` = 0.5 (straight out from the stage); distance
 *    comes from the block's front-to-back index plus row depth (`floorPositionFraction`).
 *  - centre stage: stand blocks wrap all four sides (`angleFraction` = block centre along the
 *    full loop), distance is radial from the central stage, viewing angle front-on.
 *  - theatre: the block/level resolve, but no position (`angleFraction` null) + `THEATRE_HEDGE`.
 */
export function resolveSeatGeometry(
  config: VenueSeatMapConfig | null | undefined,
  fields: ParsedSeatFields | null | undefined,
  options: ResolveSeatGeometryOptions = {},
): SeatGeometryFacts | null {
  if (!config) return null;
  if (!fields) return null;

  const layout = layoutOf(config);

  let located: BlockLocation | null = fields.block?.value ? locateBlock(config, fields.block.value) : null;
  // The label ultimately reported as `block` in the returned facts — normally just the parsed
  // block string verbatim, but the theatre fallback below has no `block` field to echo, only
  // whatever it matched against (an `area` value or the venue's sole documented block label).
  let blockLabel: string | null = fields.block?.value ?? null;

  // Some venues print their blocks as "Section 10" (Macpherson Stadium), which the parser keeps
  // as `section`. With no `block` at all, try the section against the venue's own block list —
  // it only resolves when the venue actually documents a block with that exact label/number.
  if (!located && !fields.block?.value && fields.section?.value) {
    located = locateBlock(config, fields.section.value);
    if (located) blockLabel = fields.section.value;
  }

  if (!located && layout === "theatre") {
    const theatreMatch = locateTheatreLevel(config, fields);
    if (theatreMatch) {
      located = {
        level: theatreMatch.level,
        numeric: null,
        suffix: null,
        index: 0,
        count: 1,
        positionConfidence: theatreMatch.positionConfidence,
      };
      blockLabel = theatreMatch.blockLabel;
    }
  }

  if (!located || !blockLabel) return null;
  const { level } = located;
  const isFloor = isFloorLevel(level);

  const stagePosition = options.stagePosition ?? DEFAULT_STAGE_POSITION;
  const isDefaultStageLayout = stagePosition === DEFAULT_STAGE_POSITION;
  const hasStage = stagePosition !== "none";

  // Theatre layouts and in-the-round floors aren't projected: their block is known, but no
  // position is placed rather than borrowing the bowl model for a shape it doesn't fit.
  const projectable = layout !== "theatre" && !(layout === "bowl-centre-stage" && isFloor);
  const positionKnown = projectable && located.positionConfidence === "confirmed";
  let angleFraction: number | null = null;
  if (positionKnown) {
    if (isFloor) {
      angleFraction = 0.5; // straight out from the stage, facing it
    } else if (layout === "bowl-centre-stage") {
      angleFraction = (located.index + 0.5) / located.count; // full 4-sided loop, block centres
    } else {
      angleFraction = located.index / Math.max(located.count - 1, 1);
    }
  }

  const row = fields.row?.value ?? null;
  let usedNumericRow = false;
  let rowDepthFraction: number | null = null;
  if (row) {
    // Precedence when a level documents more than one row scheme (see `LevelConfig.rowSequence`
    // in types.ts for the full rule): `rowBankSplit` — a genuine walkway break between two named
    // banks — is tried first; `rowSequence` — one continuous documented front-to-back list — is
    // consulted next, only for a row that isn't in either bank. Only when NEITHER is documented
    // does the level fall back to the generic default A-Z/AA-QQ sequence; a level with its own
    // documented scheme never silently borrows the generic one for a row outside it.
    if (level.rowBankSplit) {
      rowDepthFraction = bankedRowDepthFraction(row, level.rowBankSplit);
    }
    if (rowDepthFraction === null && level.rowSequence) {
      rowDepthFraction = sequenceRowDepthFraction(row, level.rowSequence);
    }
    if (rowDepthFraction === null && !level.rowBankSplit && !level.rowSequence) {
      rowDepthFraction = defaultRowDepthFraction(row);
    }
    // Numeric-row approximation: previously floor-only. A stand level can have numeric rows
    // too (Hong Kong Coliseum's stand aisles run 1..~20) — see rows.ts's
    // `numericRowDepthFraction` doc comment. Only used as a last resort, and only when the
    // level has NO documented row scheme of its own (`rowBankSplit` or `rowSequence`) — a
    // documented scheme IS the level's known row set, so a row outside it is genuinely
    // unknown, not a candidate for a further coarse guess.
    if (rowDepthFraction === null && !level.rowBankSplit && !level.rowSequence) {
      rowDepthFraction = numericRowDepthFraction(row);
      usedNumericRow = rowDepthFraction !== null;
    }
  }

  let depthFraction: number;
  if (isFloor && positionKnown) {
    depthFraction = clamp01(floorPositionFraction(located.index, located.count, rowDepthFraction) * FLOOR_DISTANCE_SPAN);
  } else if (layout === "bowl-end-stage") {
    depthFraction = computeDepthFraction(level, rowDepthFraction, angleFraction, hasStage);
  } else {
    // Centre stage: every side is equally "in front", so only the radial position counts.
    depthFraction = tierRadialFraction(level, rowDepthFraction);
  }
  const distanceLabel = distanceLabelFor(depthFraction);

  let viewingAngle: ViewingAngleBucket | null = null;
  let isDocumentedBestFacing = false;
  let isDocumentedMostOblique = false;
  let isDocumentedClosedForConcerts = false;
  let usedGenericAngle = false;
  if (hasStage && isDefaultStageLayout && positionKnown && angleFraction !== null) {
    if (isFloor || layout === "bowl-centre-stage") {
      viewingAngle = "front-on";
    } else if (level.stageFacing && located.numeric !== null) {
      const classification = classifyViewingAngle(level, located.numeric);
      if (classification) {
        viewingAngle = classification.bucket;
        if (classification.exact) {
          isDocumentedBestFacing = classification.bucket === "front-on";
          isDocumentedMostOblique = classification.bucket === "side-on";
          isDocumentedClosedForConcerts = classification.bucket === "behind";
        }
      }
    } else if (!level.stageFacing) {
      viewingAngle = genericEndStageBucket(angleFraction);
      usedGenericAngle = true;
    }
  }

  const wrapConfidence: Confidence = level.wrap?.confirmed ? "confirmed" : "unconfirmed";
  const rowBankConfidence: Confidence = level.rowBankSplit?.confidence ?? "unconfirmed";

  const hedge: string[] = [];
  if (layout === "theatre") {
    hedge.push(THEATRE_HEDGE);
  } else if (!positionKnown) {
    hedge.push(
      isFloor
        ? `${level.label} block ${blockLabel}'s position on the floor is unconfirmed — showing the level only, not a precise spot.`
        : `${level.label} block ${blockLabel}'s position around the bowl is unconfirmed — showing the level only, not a precise spot.`,
    );
  }
  if (hasStage && !isDefaultStageLayout) {
    hedge.push("Viewing-angle and stage-facing notes assume the default concert stage layout; this event's stage position may differ.");
  }
  if (positionKnown && isFloor) hedge.push(FLOOR_PLACEMENT_HEDGE);
  if (positionKnown && !isFloor && layout === "bowl-centre-stage" && viewingAngle) hedge.push(CENTRE_STAGE_HEDGE);
  if (usedGenericAngle) hedge.push(GENERIC_ANGLE_HEDGE);
  if (level.blockNumberRanges.length > 0 && level.wrap && !level.wrap.confirmed) {
    hedge.push(level.wrap.note);
  }
  if (row && rowDepthFraction === null) {
    hedge.push(`Row ${row} isn't in ${level.label}'s documented row set — depth shown is an approximate block-level position only.`);
  }
  if (usedNumericRow) {
    hedge.push(`Row ${row}'s depth assumes a typical block of about 30 rows front-to-back — approximate only.`);
  }
  if (located.suffix && located.numeric !== null && config.blockSuffixConfidence === "unconfirmed") {
    hedge.push(`Block suffix "${located.suffix}" likely marks a stair/vomitory sub-division of block ${located.numeric} — its exact meaning is unconfirmed.`);
  }

  return {
    venueId: config.id,
    levelId: level.id,
    levelLabel: level.label,
    block: blockLabel,
    blockNumeric: located.numeric,
    blockSuffix: located.suffix,
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
      blockPosition: located.positionConfidence,
      wrap: wrapConfidence,
      rowBank: rowBankConfidence,
    },
    hedge,
  };
}
