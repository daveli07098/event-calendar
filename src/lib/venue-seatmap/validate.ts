/**
 * Hand-written runtime validator for `VenueSeatMapConfig` (see ./types.ts) — no zod. This is
 * the ONLY gate between AI-drafted / user-submitted JSON and what gets written to
 * `EventVenue.seatMapConfig`, so it must be strict: wrong types, out-of-range numbers, and
 * unknown keys are all rejected or stripped rather than silently accepted.
 *
 * Design:
 *  - Every validated sub-object is rebuilt field-by-field from scratch (never `{ ...input }`),
 *    so unknown/extra keys never survive into the returned `config` — this is what "strips
 *    unknown keys" means here, not deleting keys from the input in place.
 *  - All errors for a given input are collected and returned together (not fail-fast) so a
 *    caller — or the seat-map review UI — can show every problem at once.
 *  - Size bounds exist purely to keep a bad AI response (or a hostile PUT body) from writing
 *    an unbounded blob: ≤ 40 levels, ≤ 500 total label-like strings (aliases + zone names +
 *    blockLabelRanges labels + row-bank row names, summed across the whole config), and
 *    descriptive strings (ids/labels/notes/rows/zones/aliases) capped at 200 chars. URLs
 *    (`seatingPlanSources[].url`) get a separate, larger cap — real Vercel Blob URLs can
 *    approach 150 chars on their own, and correctness there is checked via `new URL()`, not
 *    the 200-char descriptive-text bound.
 */
import type {
  AsymmetryFact,
  BlockLabelRange,
  BlockNumberRange,
  BowlSide,
  Confidence,
  GateInfo,
  LevelConfig,
  RowBankSplit,
  SeatingPlanSource,
  StageFacingFacts,
  UnticketedLevel,
  VenueLayout,
  VenueSeatMapConfig,
} from "./types";

export type ValidateSeatMapResult =
  | { ok: true; config: VenueSeatMapConfig }
  | { ok: false; errors: string[] };

// ---- Size bounds ------------------------------------------------------------

const MAX_STRING_LEN = 200;
const MAX_URL_LEN = 2000;
const MAX_LEVELS = 40;
const MAX_TOTAL_LABELS = 500;
// Modest per-array caps — not explicitly required, but keep every list-shaped field bounded
// too, not just levels/labels, so no single field can carry an unbounded array.
const MAX_ARRAY = 200;

const CONFIDENCE_VALUES: readonly Confidence[] = ["confirmed", "unconfirmed"];
const BOWL_SIDE_VALUES: readonly BowlSide[] = ["shortEndA", "shortEndB", "longSideA", "longSideB"];
const VENUE_LAYOUT_VALUES: readonly VenueLayout[] = ["bowl-end-stage", "bowl-centre-stage", "theatre"];
const LEVEL_KIND_VALUES = ["stand", "floor"] as const;

// ---- Generic primitives ------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface StringOpts {
  required?: boolean;
  maxLen?: number;
}

function validateString(
  v: unknown,
  path: string,
  errors: string[],
  opts: StringOpts = {}
): string | undefined {
  const maxLen = opts.maxLen ?? MAX_STRING_LEN;
  if (v === undefined || v === null) {
    if (opts.required) errors.push(`${path} is required`);
    return undefined;
  }
  if (typeof v !== "string") {
    errors.push(`${path} must be a string`);
    return undefined;
  }
  if (v.trim() === "") {
    errors.push(`${path} must not be empty`);
    return undefined;
  }
  if (v.length > maxLen) {
    errors.push(`${path} exceeds max length of ${maxLen} characters`);
    return undefined;
  }
  return v;
}

interface NumberOpts {
  required?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
}

function validateNumber(v: unknown, path: string, errors: string[], opts: NumberOpts = {}): number | undefined {
  if (v === undefined || v === null) {
    if (opts.required) errors.push(`${path} is required`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(`${path} must be a finite number`);
    return undefined;
  }
  if (opts.integer && !Number.isInteger(v)) {
    errors.push(`${path} must be an integer`);
    return undefined;
  }
  if (opts.min !== undefined && v < opts.min) {
    errors.push(`${path} must be >= ${opts.min}`);
    return undefined;
  }
  if (opts.max !== undefined && v > opts.max) {
    errors.push(`${path} must be <= ${opts.max}`);
    return undefined;
  }
  return v;
}

function validateBoolean(v: unknown, path: string, errors: string[], required = false): boolean | undefined {
  if (v === undefined || v === null) {
    if (required) errors.push(`${path} is required`);
    return undefined;
  }
  if (typeof v !== "boolean") {
    errors.push(`${path} must be a boolean`);
    return undefined;
  }
  return v;
}

function validateEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[],
  required = false
): T | undefined {
  if (v === undefined || v === null) {
    if (required) errors.push(`${path} is required`);
    return undefined;
  }
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}`);
    return undefined;
  }
  return v as T;
}

function validateConfidence(v: unknown, path: string, errors: string[], required = false): Confidence | undefined {
  return validateEnum(v, CONFIDENCE_VALUES, path, errors, required);
}

/** A tracker so caller-supplied "labels" arrays (aliases, zones, blockLabelRanges labels, row
 * names) count toward one shared cap across the whole config, not per-field. */
function makeLabelBudget(errors: string[]) {
  let total = 0;
  let reported = false;
  return {
    /** Adds `n` to the running total; pushes ONE error the first time the cap is exceeded. */
    add(n: number) {
      total += n;
      if (total > MAX_TOTAL_LABELS && !reported) {
        reported = true;
        errors.push(`total label-like strings (aliases, zones, block labels, rows) exceed ${MAX_TOTAL_LABELS}`);
      }
    },
  };
}

/** Validates a string[] where every entry is a required, bounded string. Returns undefined
 * (with errors pushed) if the value isn't an array or any entry fails. */
function validateStringArray(
  v: unknown,
  path: string,
  errors: string[],
  opts: { required?: boolean; maxLen?: number; maxItems?: number } = {}
): string[] | undefined {
  if (v === undefined || v === null) {
    if (opts.required) errors.push(`${path} is required`);
    return opts.required ? undefined : [];
  }
  if (!Array.isArray(v)) {
    errors.push(`${path} must be an array`);
    return undefined;
  }
  const maxItems = opts.maxItems ?? MAX_ARRAY;
  if (v.length > maxItems) {
    errors.push(`${path} has more than ${maxItems} entries`);
    return undefined;
  }
  const out: string[] = [];
  let ok = true;
  v.forEach((entry, i) => {
    const s = validateString(entry, `${path}[${i}]`, errors, { required: true, maxLen: opts.maxLen });
    if (s === undefined) ok = false;
    else out.push(s);
  });
  return ok ? out : undefined;
}

// ---- Sub-object validators ----------------------------------------------------

function validateBlockNumberRange(v: unknown, path: string, errors: string[]): BlockNumberRange | undefined {
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const min = validateNumber(v.min, `${path}.min`, errors, { required: true, integer: true });
  const max = validateNumber(v.max, `${path}.max`, errors, { required: true, integer: true });
  const positionConfidence = validateConfidence(v.positionConfidence, `${path}.positionConfidence`, errors, true);
  const note = validateString(v.note, `${path}.note`, errors);
  if (min === undefined || max === undefined || positionConfidence === undefined) return undefined;
  if (min > max) {
    errors.push(`${path}: min (${min}) must be <= max (${max})`);
    return undefined;
  }
  return { min, max, positionConfidence, ...(note !== undefined ? { note } : {}) };
}

function validateBlockLabelRange(
  v: unknown,
  path: string,
  errors: string[],
  budget: ReturnType<typeof makeLabelBudget>
): BlockLabelRange | undefined {
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const labels = validateStringArray(v.labels, `${path}.labels`, errors, { required: true });
  const positionConfidence = validateConfidence(v.positionConfidence, `${path}.positionConfidence`, errors, true);
  const note = validateString(v.note, `${path}.note`, errors);
  if (labels === undefined || positionConfidence === undefined) return undefined;
  if (labels.length === 0) {
    errors.push(`${path}.labels must not be empty`);
    return undefined;
  }
  budget.add(labels.length);
  return { labels, positionConfidence, ...(note !== undefined ? { note } : {}) };
}

function validateBlockRangePairs(v: unknown, path: string, errors: string[]): [number, number][] | undefined {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    errors.push(`${path} must be an array`);
    return undefined;
  }
  if (v.length > MAX_ARRAY) {
    errors.push(`${path} has more than ${MAX_ARRAY} entries`);
    return undefined;
  }
  const out: [number, number][] = [];
  let ok = true;
  v.forEach((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2) {
      errors.push(`${path}[${i}] must be a [min, max] pair`);
      ok = false;
      return;
    }
    const min = validateNumber(pair[0], `${path}[${i}][0]`, errors, { required: true, integer: true });
    const max = validateNumber(pair[1], `${path}[${i}][1]`, errors, { required: true, integer: true });
    if (min === undefined || max === undefined) {
      ok = false;
      return;
    }
    if (min > max) {
      errors.push(`${path}[${i}]: min (${min}) must be <= max (${max})`);
      ok = false;
      return;
    }
    out.push([min, max]);
  });
  return ok ? out : undefined;
}

function validateStageFacing(v: unknown, path: string, errors: string[]): StageFacingFacts | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const best = validateBlockRangePairs(v.best, `${path}.best`, errors);
  const mostOblique = validateBlockRangePairs(v.mostOblique, `${path}.mostOblique`, errors);
  const closedForConcerts = validateBlockRangePairs(v.closedForConcerts, `${path}.closedForConcerts`, errors);
  if (best === undefined || mostOblique === undefined || closedForConcerts === undefined) return undefined;
  const out: StageFacingFacts = {};
  if (v.best !== undefined) out.best = best;
  if (v.mostOblique !== undefined) out.mostOblique = mostOblique;
  if (v.closedForConcerts !== undefined) out.closedForConcerts = closedForConcerts;
  return out;
}

function validateRowBankSplit(
  v: unknown,
  path: string,
  errors: string[],
  budget: ReturnType<typeof makeLabelBudget>
): RowBankSplit | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const lowerRows = validateStringArray(v.lowerRows, `${path}.lowerRows`, errors, { required: true });
  const upperRows = validateStringArray(v.upperRows, `${path}.upperRows`, errors, { required: true });
  const confidence = validateConfidence(v.confidence, `${path}.confidence`, errors, true);
  if (lowerRows === undefined || upperRows === undefined || confidence === undefined) return undefined;
  budget.add(lowerRows.length + upperRows.length);
  return { lowerRows, upperRows, confidence };
}

function validateWrap(v: unknown, path: string, errors: string[]): { confirmed: boolean; note: string } | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const confirmed = validateBoolean(v.confirmed, `${path}.confirmed`, errors, true);
  const note = validateString(v.note, `${path}.note`, errors, { required: true });
  if (confirmed === undefined || note === undefined) return undefined;
  return { confirmed, note };
}

function validateLevel(
  v: unknown,
  path: string,
  errors: string[],
  budget: ReturnType<typeof makeLabelBudget>
): LevelConfig | undefined {
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const id = validateString(v.id, `${path}.id`, errors, { required: true });
  const label = validateString(v.label, `${path}.label`, errors, { required: true });
  const tier = validateNumber(v.tier, `${path}.tier`, errors, { required: true, integer: true, min: 0 });

  let radiusRange: [number, number] | undefined;
  if (!Array.isArray(v.radiusRange) || v.radiusRange.length !== 2) {
    errors.push(`${path}.radiusRange must be a [inner, outer] pair`);
  } else {
    const inner = validateNumber(v.radiusRange[0], `${path}.radiusRange[0]`, errors, { required: true, min: 0, max: 1 });
    const outer = validateNumber(v.radiusRange[1], `${path}.radiusRange[1]`, errors, { required: true, min: 0, max: 1 });
    if (inner !== undefined && outer !== undefined) {
      if (inner > outer) {
        errors.push(`${path}.radiusRange: inner (${inner}) must be <= outer (${outer})`);
      } else {
        radiusRange = [inner, outer];
      }
    }
  }

  const blockNumberRangesRaw = v.blockNumberRanges;
  let blockNumberRanges: BlockNumberRange[] | undefined;
  if (!Array.isArray(blockNumberRangesRaw)) {
    errors.push(`${path}.blockNumberRanges must be an array`);
  } else if (blockNumberRangesRaw.length > MAX_ARRAY) {
    errors.push(`${path}.blockNumberRanges has more than ${MAX_ARRAY} entries`);
  } else {
    const out: BlockNumberRange[] = [];
    let ok = true;
    blockNumberRangesRaw.forEach((r, i) => {
      const validated = validateBlockNumberRange(r, `${path}.blockNumberRanges[${i}]`, errors);
      if (validated === undefined) ok = false;
      else out.push(validated);
    });
    blockNumberRanges = ok ? out : undefined;
  }

  let blockLabelRanges: BlockLabelRange[] | undefined;
  if (v.blockLabelRanges !== undefined) {
    if (!Array.isArray(v.blockLabelRanges)) {
      errors.push(`${path}.blockLabelRanges must be an array`);
    } else if (v.blockLabelRanges.length > MAX_ARRAY) {
      errors.push(`${path}.blockLabelRanges has more than ${MAX_ARRAY} entries`);
    } else {
      const out: BlockLabelRange[] = [];
      let ok = true;
      v.blockLabelRanges.forEach((r, i) => {
        const validated = validateBlockLabelRange(r, `${path}.blockLabelRanges[${i}]`, errors, budget);
        if (validated === undefined) ok = false;
        else out.push(validated);
      });
      if (ok) blockLabelRanges = out;
    }
  }

  const kind = validateEnum(v.kind, LEVEL_KIND_VALUES, `${path}.kind`, errors, false);

  let zones: string[] | undefined;
  if (v.zones !== undefined) {
    zones = validateStringArray(v.zones, `${path}.zones`, errors);
    if (zones !== undefined) budget.add(zones.length);
  }

  const wrap = validateWrap(v.wrap, `${path}.wrap`, errors);
  const stageFacing = validateStageFacing(v.stageFacing, `${path}.stageFacing`, errors);
  const rowBankSplit = validateRowBankSplit(v.rowBankSplit, `${path}.rowBankSplit`, errors, budget);

  // Row names are short (e.g. "AA", "20") — a tighter per-entry cap than the 200-char default
  // used for descriptive text elsewhere, per the project brief for `LevelConfig.rowSequence`.
  let rowSequence: string[] | undefined;
  if (v.rowSequence !== undefined) {
    rowSequence = validateStringArray(v.rowSequence, `${path}.rowSequence`, errors, { maxLen: 16, maxItems: 200 });
    if (rowSequence !== undefined) budget.add(rowSequence.length);
  }

  if (
    id === undefined ||
    label === undefined ||
    tier === undefined ||
    radiusRange === undefined ||
    blockNumberRanges === undefined
  ) {
    return undefined;
  }

  return {
    id,
    label,
    tier,
    radiusRange,
    blockNumberRanges,
    ...(blockLabelRanges !== undefined ? { blockLabelRanges } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(zones !== undefined ? { zones } : {}),
    ...(wrap !== undefined ? { wrap } : {}),
    ...(stageFacing !== undefined ? { stageFacing } : {}),
    ...(rowBankSplit !== undefined ? { rowBankSplit } : {}),
    ...(rowSequence !== undefined ? { rowSequence } : {}),
  };
}

function validateUnticketedLevel(v: unknown, path: string, errors: string[]): UnticketedLevel | undefined {
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const id = validateString(v.id, `${path}.id`, errors, { required: true });
  const label = validateString(v.label, `${path}.label`, errors, { required: true });
  const confidence = validateConfidence(v.confidence, `${path}.confidence`, errors, true);
  const note = validateString(v.note, `${path}.note`, errors, { required: true });
  if (id === undefined || label === undefined || confidence === undefined || note === undefined) return undefined;
  return { id, label, confidence, note };
}

function validateGate(v: unknown, path: string, errors: string[]): GateInfo | undefined {
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const id = validateString(v.id, `${path}.id`, errors, { required: true });
  const confidence = validateConfidence(v.confidence, `${path}.confidence`, errors, true);
  const side = validateEnum(v.side, BOWL_SIDE_VALUES, `${path}.side`, errors, false);
  const note = validateString(v.note, `${path}.note`, errors, { required: true });
  if (id === undefined || confidence === undefined || note === undefined) return undefined;
  return { id, confidence, note, ...(side !== undefined ? { side } : {}) };
}

function validateAsymmetry(v: unknown, path: string, errors: string[]): AsymmetryFact | undefined {
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const label = validateString(v.label, `${path}.label`, errors, { required: true });
  const side = validateEnum(v.side, BOWL_SIDE_VALUES, `${path}.side`, errors, false);
  const confidence = validateConfidence(v.confidence, `${path}.confidence`, errors, true);
  if (label === undefined || confidence === undefined) return undefined;
  return { label, confidence, ...(side !== undefined ? { side } : {}) };
}

function validateSeatingPlanSource(v: unknown, path: string, errors: string[]): SeatingPlanSource | undefined {
  if (!isPlainObject(v)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const url = validateString(v.url, `${path}.url`, errors, { required: true, maxLen: MAX_URL_LEN });
  const label = validateString(v.label, `${path}.label`, errors, { required: true });
  if (url === undefined || label === undefined) return undefined;
  return { url, label };
}

// ---- Top-level validator -----------------------------------------------------

/**
 * Validates an unknown value as a `VenueSeatMapConfig`. On success, `config` is a freshly
 * constructed object containing only known, type-checked fields (unknown keys are dropped).
 * On failure, `errors` lists every problem found — never just the first.
 */
export function validateSeatMapConfig(input: unknown): ValidateSeatMapResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ["config must be a JSON object"] };
  }

  const budget = makeLabelBudget(errors);

  const id = validateString(input.id, "id", errors, { required: true });
  const name = validateString(input.name, "name", errors, { required: true });
  const aliases = validateStringArray(input.aliases, "aliases", errors, { required: true });
  if (aliases !== undefined) budget.add(aliases.length);

  if (input.bowlShape !== "rounded-rect") {
    errors.push('bowlShape must be "rounded-rect"');
  }

  let capacityApprox: VenueSeatMapConfig["capacityApprox"];
  if (input.capacityApprox !== undefined && input.capacityApprox !== null) {
    if (!isPlainObject(input.capacityApprox)) {
      errors.push("capacityApprox must be an object");
    } else {
      const total = validateNumber(input.capacityApprox.total, "capacityApprox.total", errors, { integer: true, min: 0 });
      const concert = validateNumber(input.capacityApprox.concert, "capacityApprox.concert", errors, { integer: true, min: 0 });
      const confidence = validateConfidence(input.capacityApprox.confidence, "capacityApprox.confidence", errors, true);
      if (confidence !== undefined) {
        capacityApprox = {
          confidence,
          ...(total !== undefined ? { total } : {}),
          ...(concert !== undefined ? { concert } : {}),
        };
      }
    }
  }

  const orientationConfidence = validateConfidence(input.orientationConfidence, "orientationConfidence", errors, true);

  let levels: LevelConfig[] | undefined;
  if (!Array.isArray(input.levels)) {
    errors.push("levels must be an array");
  } else if (input.levels.length === 0) {
    errors.push("levels must not be empty");
  } else if (input.levels.length > MAX_LEVELS) {
    errors.push(`levels has more than ${MAX_LEVELS} entries`);
  } else {
    const out: LevelConfig[] = [];
    let ok = true;
    input.levels.forEach((lvl, i) => {
      const validated = validateLevel(lvl, `levels[${i}]`, errors, budget);
      if (validated === undefined) ok = false;
      else out.push(validated);
    });
    levels = ok ? out : undefined;
  }

  let unticketedLevels: UnticketedLevel[] | undefined;
  if (input.unticketedLevels !== undefined) {
    if (!Array.isArray(input.unticketedLevels)) {
      errors.push("unticketedLevels must be an array");
    } else if (input.unticketedLevels.length > MAX_ARRAY) {
      errors.push(`unticketedLevels has more than ${MAX_ARRAY} entries`);
    } else {
      const out: UnticketedLevel[] = [];
      let ok = true;
      input.unticketedLevels.forEach((lvl, i) => {
        const validated = validateUnticketedLevel(lvl, `unticketedLevels[${i}]`, errors);
        if (validated === undefined) ok = false;
        else out.push(validated);
      });
      if (ok) unticketedLevels = out;
    }
  }

  let gates: GateInfo[] | undefined;
  if (!Array.isArray(input.gates)) {
    errors.push("gates must be an array");
  } else if (input.gates.length > MAX_ARRAY) {
    errors.push(`gates has more than ${MAX_ARRAY} entries`);
  } else {
    const out: GateInfo[] = [];
    let ok = true;
    input.gates.forEach((g, i) => {
      const validated = validateGate(g, `gates[${i}]`, errors);
      if (validated === undefined) ok = false;
      else out.push(validated);
    });
    gates = ok ? out : undefined;
  }

  let asymmetries: AsymmetryFact[] | undefined;
  if (!Array.isArray(input.asymmetries)) {
    errors.push("asymmetries must be an array");
  } else if (input.asymmetries.length > MAX_ARRAY) {
    errors.push(`asymmetries has more than ${MAX_ARRAY} entries`);
  } else {
    const out: AsymmetryFact[] = [];
    let ok = true;
    input.asymmetries.forEach((a, i) => {
      const validated = validateAsymmetry(a, `asymmetries[${i}]`, errors);
      if (validated === undefined) ok = false;
      else out.push(validated);
    });
    asymmetries = ok ? out : undefined;
  }

  const blockSuffixConfidence = validateConfidence(input.blockSuffixConfidence, "blockSuffixConfidence", errors, true);

  const layout = validateEnum(input.layout, VENUE_LAYOUT_VALUES, "layout", errors, false);

  let plan: VenueSeatMapConfig["plan"];
  if (input.plan !== undefined && input.plan !== null) {
    if (!isPlainObject(input.plan) || !isPlainObject(input.plan.outer) || !isPlainObject(input.plan.inner)) {
      errors.push("plan must be { outer: {width,height}, inner: {width,height} }");
    } else {
      const outerW = validateNumber(input.plan.outer.width, "plan.outer.width", errors, { required: true, min: 0 });
      const outerH = validateNumber(input.plan.outer.height, "plan.outer.height", errors, { required: true, min: 0 });
      const innerW = validateNumber(input.plan.inner.width, "plan.inner.width", errors, { required: true, min: 0 });
      const innerH = validateNumber(input.plan.inner.height, "plan.inner.height", errors, { required: true, min: 0 });
      if (outerW !== undefined && outerH !== undefined && innerW !== undefined && innerH !== undefined) {
        plan = { outer: { width: outerW, height: outerH }, inner: { width: innerW, height: innerH } };
      }
    }
  }

  let approxFloorM: VenueSeatMapConfig["approxFloorM"];
  if (input.approxFloorM !== undefined && input.approxFloorM !== null) {
    if (!isPlainObject(input.approxFloorM)) {
      errors.push("approxFloorM must be an object");
    } else {
      const width = validateNumber(input.approxFloorM.width, "approxFloorM.width", errors, { required: true, min: 0 });
      const length = validateNumber(input.approxFloorM.length, "approxFloorM.length", errors, { required: true, min: 0 });
      if (width !== undefined && length !== undefined) approxFloorM = { width, length };
    }
  }

  let seatingPlanSources: SeatingPlanSource[] | undefined;
  if (input.seatingPlanSources !== undefined) {
    if (!Array.isArray(input.seatingPlanSources)) {
      errors.push("seatingPlanSources must be an array");
    } else if (input.seatingPlanSources.length > MAX_ARRAY) {
      errors.push(`seatingPlanSources has more than ${MAX_ARRAY} entries`);
    } else {
      const out: SeatingPlanSource[] = [];
      let ok = true;
      input.seatingPlanSources.forEach((s, i) => {
        const validated = validateSeatingPlanSource(s, `seatingPlanSources[${i}]`, errors);
        if (validated === undefined) ok = false;
        else out.push(validated);
      });
      if (ok) seatingPlanSources = out;
    }
  }

  if (
    errors.length > 0 ||
    id === undefined ||
    name === undefined ||
    aliases === undefined ||
    orientationConfidence === undefined ||
    levels === undefined ||
    gates === undefined ||
    asymmetries === undefined ||
    blockSuffixConfidence === undefined
  ) {
    return { ok: false, errors: errors.length > 0 ? errors : ["invalid config"] };
  }

  const config: VenueSeatMapConfig = {
    id,
    name,
    aliases,
    bowlShape: "rounded-rect",
    orientationConfidence,
    levels,
    gates,
    asymmetries,
    blockSuffixConfidence,
    ...(capacityApprox !== undefined ? { capacityApprox } : {}),
    ...(unticketedLevels !== undefined ? { unticketedLevels } : {}),
    ...(layout !== undefined ? { layout } : {}),
    ...(plan !== undefined ? { plan } : {}),
    ...(approxFloorM !== undefined ? { approxFloorM } : {}),
    ...(seatingPlanSources !== undefined ? { seatingPlanSources } : {}),
  };

  return { ok: true, config };
}
