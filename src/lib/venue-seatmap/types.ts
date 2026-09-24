/**
 * Types for the procedural, 2D-SVG venue seat-map feature.
 *
 * Design summary (see project brief / docs/venue-seatmap.md for the full rationale):
 *  - Precision is deliberately block-level. Row letters give approximate depth *within* a
 *    block, never an exact seat position.
 *  - Every fact sourced from research (rather than official documentation) carries an
 *    explicit `Confidence` marker. Nothing here silently upgrades an "unconfirmed" fact to
 *    a confident one — the UI is expected to hedge wherever this data hedges.
 *  - A venue with no config, or a block that doesn't fall in any configured range, must
 *    resolve to `null` geometry — never a guessed position. A confidently wrong marker is
 *    worse than no map.
 *  - Stage position is a per-render *parameter* (see `StagePosition` + the resolver's
 *    `stagePosition` option), never baked into the venue config: the same bowl can host an
 *    end-stage concert, a four-sided (四面台) show, or sports with no stage at all.
 */

// ---- Confidence -------------------------------------------------------------

/** "confirmed" = corroborated by concordant sources for this venue. "unconfirmed" = reported
 * by at least one source but not independently verified — must be hedged in the UI, never
 * presented as settled fact. */
export type Confidence = "confirmed" | "unconfirmed";

// ---- Stage / bowl geometry ---------------------------------------------------

/**
 * Where the stage sits for a specific event's render. `"shortEndA"` is the resolver's
 * default (see `DEFAULT_STAGE_POSITION` in geometry.ts) — the self-consistent reading of
 * the sources for Kai Tak's typical end-stage concert layout — but callers with a
 * differently-configured show should pass the real value. Only `"shortEndA"` currently
 * carries documented stage-facing annotations (best/most-oblique/closed-for-concerts); any
 * other value suppresses those annotations rather than fabricating equivalents.
 * `"none"` means no stage at all (e.g. a sports fixture) — no viewing-angle or
 * distance-to-stage characterisation is produced.
 */
export type StagePosition = "shortEndA" | "shortEndB" | "longSideA" | "longSideB" | "four-sided" | "none";

/** A named side of the rounded-rectangle bowl, used only for RELATIVE placement (e.g. "Gate
 * F's long side is not the glazed one"). Never implies an absolute compass bearing — see
 * `VenueSeatMapConfig.orientationConfidence`. */
export type BowlSide = "shortEndA" | "shortEndB" | "longSideA" | "longSideB";

export type ViewingAngleBucket = "front-on" | "oblique" | "side-on" | "behind";
export type DistanceLabel = "close" | "mid" | "far";

// ---- Venue config -------------------------------------------------------------

export interface BlockNumberRange {
  /** Inclusive numeric bounds, e.g. Kai Tak Level 2's main tier is {min:201,max:240}. */
  min: number;
  max: number;
  /**
   * Whether THIS range's position along its level's numbering arc is known well enough to
   * place it (and thus compute an `angleFraction`/viewing angle). This is independent of
   * whether the level/block ASSIGNMENT itself is confirmed — Kai Tak's 101-110 sub-section
   * is confidently on Level 2, but where it sits around the bowl relative to 201-240 is
   * unconfirmed, so it gets a level+tier but no angle or marker position.
   */
  positionConfidence: Confidence;
  note?: string;
}

/** Documented stage-facing quality for the DEFAULT concert stage layout only (`"shortEndA"`).
 * Ranges are `[min, max]` inclusive block-number pairs. */
/** Lettered or otherwise non-numeric blocks (AsiaWorld-Expo Arena floor blocks A-D, a
 * theatre's named boxes), listed in physical order: along the level's arc for a `"stand"`
 * level, front (nearest the stage) to back for a `"floor"` level. */
export interface BlockLabelRange {
  labels: string[];
  positionConfidence: Confidence;
  note?: string;
}

export interface StageFacingFacts {
  best?: [number, number][];
  mostOblique?: [number, number][];
  closedForConcerts?: [number, number][];
}

/** A documented row-depth split into two banks separated by a walkway (Kai Tak Level 5: rows
 * A-M lower, AA-QQ upper). Any upper-bank row is placed further back than every lower-bank
 * row, regardless of its own index within the upper bank — the walkway is a real break, not
 * just another step in a shared A→Z→AA→QQ sequence. */
export interface RowBankSplit {
  lowerRows: string[];
  upperRows: string[];
  confidence: Confidence;
}

export interface LevelConfig {
  id: string;
  label: string;
  /** Ordinal distance-from-pitch tier (0 = ground/floor, increasing outward/upward). Drives
   * both the rendered radial band and the distance-to-stage estimate. */
  tier: number;
  /** [inner, outer] fraction of overall bowl depth (0 = pitch edge, 1 = outer wall). A
   * rendering/estimate proxy, NOT a measured dimension — Kai Tak's actual bowl dimensions
   * aren't part of the verified research and are not invented here. */
  radiusRange: [number, number];
  /** Numbered-block ranges belonging to this level. Empty for a level with no numbered
   * blocks (e.g. the floor's Zone A/B/C standing areas — see `zones`). Kai Tak's Level 2
   * famously needs TWO ranges (101-110 AND 201-240); do not assume one range per level. */
  blockNumberRanges: BlockNumberRange[];
  /** Non-numeric blocks for this level (see `BlockLabelRange`). Optional; a level may mix
   * both schemes. */
  blockLabelRanges?: BlockLabelRange[];
  /** `"stand"` (default): blocks run along the bowl's arc. `"floor"`: a flat floor whose
   * blocks are depth bands in front of the stage, ordered front to back. */
  kind?: "stand" | "floor";
  /** Named standing zones using a completely separate scheme from numbered blocks (e.g.
   * floor Zone A/B/C). Do not conflate with `blockNumberRanges`. */
  zones?: string[];
  /** Whether this level's block numbering is confirmed to fully wrap the bowl with the seam
   * at the stage (e.g. Level 5's 501/540 adjacency). Only meaningful when
   * `blockNumberRanges` is non-empty. */
  wrap?: { confirmed: boolean; note: string };
  stageFacing?: StageFacingFacts;
  rowBankSplit?: RowBankSplit;
  /**
   * Optional documented front→back row order for this level, e.g. AsiaWorld-Expo Arena's
   * balcony (A-Z skipping I/O), Macpherson Stadium's floor (AA→SS, double letters only), or
   * Hong Kong Coliseum's stand (`["AA", "1", …, "20"]`, a front premium row plus numbered
   * rows). A row's depth is simply its index in this list — front is index 0, back is the
   * last index — which is also how it differs from `rowBankSplit`: a `rowSequence` is ONE
   * continuous documented order, while a `rowBankSplit` is two banks with a real walkway gap
   * between them. A row not present in `rowSequence` is genuinely undocumented for this level
   * (the resolver falls through to the "not in documented row set" hedge, never the generic
   * default A-Z/AA-QQ sequence — that generic sequence is only used when a level documents NO
   * row scheme of its own at all).
   *
   * Precedence when a level has both: `rowBankSplit` is tried first (it models a real physical
   * break a plain sequence can't), and `rowSequence` is consulted only as a fallback for a row
   * that isn't in either bank — e.g. two lettered banks plus a numbered overflow row outside
   * both. A level should rarely need both in practice; document why in a comment when it does.
   */
  rowSequence?: string[];
}

/** A level that exists physically but sells no numbered seating (Kai Tak Level 3 hospitality
 * suites), or whose existence as a ticketed tier is itself unconfirmed (Level 4). */
export interface UnticketedLevel {
  id: string;
  label: string;
  confidence: Confidence;
  note: string;
}

export interface GateInfo {
  id: string;
  confidence: Confidence;
  /** Only set when a source ties this gate to a specific relative side; otherwise omitted
   * rather than guessed. Gate-to-BLOCK mapping is never claimed here (see `note`). */
  side?: BowlSide;
  note: string;
}

/** A documented physical asymmetry of the bowl (e.g. one glazed long side). `side` is only
 * set when a relative placement is actually supported by the sources — never invented to
 * fill in a rendering slot. */
export interface AsymmetryFact {
  label: string;
  side?: BowlSide;
  confidence: Confidence;
}

/**
 * How the venue is laid out, which decides whether and how it can be projected:
 *  - `"bowl-end-stage"` (default): stands on three sides of a floor, stage at one short end
 *    (Kai Tak Stadium, AsiaWorld-Expo Arena).
 *  - `"bowl-centre-stage"`: stands on all four sides, stage in the middle (紅館 四面台).
 *  - `"theatre"`: rows facing a proscenium/thrust stage. Not projected yet; the UI shows the
 *    seating-plan image and the parsed seat instead of a guessed position.
 */
export type VenueLayout = "bowl-end-stage" | "bowl-centre-stage" | "theatre";

/** A seating-plan image or PDF the config was drafted from, kept so a reviewer can check. */
export interface SeatingPlanSource {
  url: string;
  label: string;
}

export interface VenueSeatMapConfig {
  id: string;
  name: string;
  /** Full, unambiguous aliases only — matching must never collide with a distinct nearby
   * venue (see registry.ts for why bare landmark names like "Kai Tak" alone are rejected). */
  aliases: string[];
  bowlShape: "rounded-rect";
  capacityApprox?: { total?: number; concert?: number; confidence: Confidence };
  /** Absolute compass bearing is unconfirmed (the source map's compass may be stylized) —
   * every `BowlSide` in this config is a relative label only, never a geographic claim. */
  orientationConfidence: Confidence;
  levels: LevelConfig[];
  unticketedLevels?: UnticketedLevel[];
  gates: GateInfo[];
  asymmetries: AsymmetryFact[];
  /** Confidence in what block-letter suffixes (e.g. "519B") actually mean (probably a
   * stair/vomitory split) — the suffix itself is always preserved verbatim regardless. */
  blockSuffixConfidence: Confidence;
  /** Defaults to `"bowl-end-stage"` when omitted (every config written before this field). */
  layout?: VenueLayout;
  /** 2D plan-space rects for this venue's proportions; defaults to `PLAN_OUTER`/`PLAN_INNER`
   * in perimeter.ts (Kai Tak's stadium proportions). Unitless drawing units. */
  plan?: { outer: { width: number; height: number }; inner: { width: number; height: number } };
  /** Approximate real-world floor size in metres, for the 3D view's scale. Always an
   * estimate; defaults to the stadium pitch in `APPROXIMATE_BOWL` when omitted. */
  approxFloorM?: { width: number; length: number };
  seatingPlanSources?: SeatingPlanSource[];
}

// ---- Resolved geometry ---------------------------------------------------------

/**
 * Plain-object geometry facts for one resolved seat, exported from the lib layer so a later
 * AI-advice feature can ground its reasoning in real numbers instead of inventing them.
 * Every field that depends on an unconfirmed assumption is nullable and paired with an
 * explicit confidence marker below, rather than silently defaulting to a guess.
 */
export interface SeatGeometryFacts {
  venueId: string;
  levelId: string;
  levelLabel: string;
  /** Verbatim block string including any letter suffix, e.g. "519B". */
  block: string;
  /** Numeric part of a numbered block ("519B" -> 519); `null` for a label block ("A"). */
  blockNumeric: number | null;
  blockSuffix: string | null;
  row: string | null;
  /** Ordinal distance-from-pitch tier, copied from the matched `LevelConfig.tier`. */
  tier: number;
  /** 0..1 position along the level's numbering arc (0/1 = at the stage seam, 0.5 = directly
   * opposite it). `null` when the block's range has `positionConfidence: "unconfirmed"` —
   * no angle is computed rather than guessed. */
  angleFraction: number | null;
  /** 0..1 depth of this row within its block/bank alone (not the overall bowl). `null` when
   * no row was supplied, or the supplied row isn't in this level's known row set. */
  rowDepthFraction: number | null;
  /** 0..1 overall approximate distance-to-stage proxy, combining tier, row depth, and (when
   * a stage exists) along-arc position. Always a rendering/estimate proxy — never presented
   * as a measured distance. */
  depthFraction: number;
  distanceLabel: DistanceLabel;
  /** `null` when there's no stage (`stagePosition: "none"`), the block's arc position is
   * unconfirmed, or `stagePosition` isn't the documented default layout — never guessed. */
  viewingAngle: ViewingAngleBucket | null;
  /** True only for an EXACT match against the venue config's documented ranges (and only
   * under the default stage layout) — not for a nearby/interpolated block. */
  isDocumentedBestFacing: boolean;
  isDocumentedMostOblique: boolean;
  isDocumentedClosedForConcerts: boolean;
  stagePosition: StagePosition;
  isDefaultStageLayout: boolean;
  confidence: {
    /** Whether the seat's `level` was stated outright, inferred, or unavailable — mirrors
     * `SeatField.source` from seat-parse.ts, `"unknown"` when no level field was present. */
    level: "stated" | "inferred" | "unknown";
    blockPosition: Confidence;
    wrap: Confidence;
    rowBank: Confidence;
  };
  /** Human-readable caveats worth surfacing in the UI, generated from whichever assumptions
   * above were unconfirmed for this particular seat. */
  hedge: string[];
}
