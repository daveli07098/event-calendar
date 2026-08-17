/**
 * Deterministic parser for venue seat-location strings (e.g. "Gate F Level 2
 * Block 225 Row BB Seat 101"). Pure, synchronous, dependency-free — no AI
 * calls here; an AI extraction layer may sit ABOVE this module later for
 * inputs this can't handle, but this file only does regex-based structural
 * parsing.
 *
 * This is the foundation for an upcoming venue seat-map feature. The
 * visualisation design isn't decided yet, so this module is intentionally
 * presentation-agnostic: it only extracts structured fields from a raw
 * string and tells the caller how confident it is. It never throws — every
 * input, including empty strings and garbage, produces a `SeatParseResult`.
 *
 * ── Design decisions worth knowing before you touch this file ──────────
 *
 * 1. Level is NEVER inferred from the block number by default.
 *    An earlier draft of this module inferred the seating tier from a
 *    block's leading digit (block 225 → "Level 2", 519B → "Level 5"), on
 *    the assumption that the leading digit always tracks the tier. That
 *    assumption is WRONG even for the one venue it was checked against:
 *    Kai Tak Stadium's Level 2 contains BOTH blocks 101–110 AND blocks
 *    201–240 — a 1xx block is on Level 2, not "Level 1", and there is no
 *    formal Level 1 ticketed tier at all. Leading-digit-implies-level is
 *    therefore venue-specific, not a general fact, and baking it in as a
 *    default would silently fabricate wrong data for every venue that
 *    doesn't happen to number blocks the same way Kai Tak's 5xx blocks do.
 *    Instead, callers who have a confirmed per-venue block→level mapping
 *    can pass one in via `ParseSeatOptions.inferLevelFromBlock`. With no
 *    option supplied (the default), `level` is only ever populated when
 *    the input states it explicitly — never guessed.
 *
 * 2. Level inference is keyed off `block` only, never `section`.
 *    "Section 118" (generic ticketing-site naming) carries no tier
 *    convention at all; only venues that use the word "Block" (or its
 *    Chinese/Japanese equivalents 區/ブロック) have been observed encoding
 *    a tier in the number, and even then only via an explicit per-venue
 *    mapping per point 1.
 *
 * 3. Positional fields in a rigid delimited template count as "stated".
 *    `2/225/BB/101` has no keywords, but the template itself unambiguously
 *    assigns position 1 to level — so that level is recorded as `source:
 *    "stated"`, not `"inferred"`. "Inferred" is reserved for values this
 *    module *derived* rather than read off the string (currently: only a
 *    caller-supplied block→level mapping).
 *
 * 4. A numeric middle segment in the dash-compact template is rejected.
 *    `225-BB-101` (block-row-seat) is a real format, but a dash-delimited
 *    triple with a NUMERIC middle segment (e.g. `2026-08-18`) is
 *    indistinguishable from an ISO date — and this is an event calendar,
 *    where date-shaped strings are the single most likely garbage input.
 *    The dash template therefore requires the row segment to be alphabetic
 *    only. Numeric-row dash-compacts are deliberately unhandled as a
 *    result (see the "not handled" list at the bottom of this header).
 *
 * 5. Seat-like fragments embedded in unrelated prose ARE extracted.
 *    Real callers will often paste a full ticket-confirmation email or
 *    event description rather than a clean isolated seat string, e.g.
 *    "meet your usher near Gate F Level 2 Block 225 Row BB Seat 101 before
 *    doors open". This module scans for keyword+value pairs anywhere in
 *    the string rather than requiring the whole string to BE a seat
 *    descriptor, so that case still parses. The trade-off is a small
 *    residual false-positive surface for keyword-shaped English words
 *    ("row", "gate") appearing in truly unrelated prose; value shapes are
 *    kept short (row: 1–3 letters or digits; seat/block: digit-led) and a
 *    small stopword guard rejects a handful of common filler words (see
 *    `STOPWORDS`) to keep that surface small, but it is not exhaustive
 *    NLP-grade disambiguation.
 *    This applies even more readily to AREA names, which need no
 *    accompanying value at all (unlike gate/row/seat, which require a
 *    keyword+value pair) — "meet on the balcony" or "second floor of the
 *    venue" will confidently return `status: "parsed"` with just an `area`
 *    field. That's an intentional consequence of the same design decision,
 *    but callers building on top of this module (e.g. an AI extraction
 *    layer) should treat an area-only `parsed` result as weaker evidence
 *    than one that also has row+seat.
 *
 * 6. Chinese seat-number markers (號) and Japanese (番) are gated behind
 *    another CJK seating marker being present in the same string.
 *    號 is also how Hong Kong street addresses write a house number (e.g.
 *    彌敦道363號), and 番/番地 appears in Japanese addresses — a pasted
 *    event description that includes the venue's street address would
 *    otherwise yield a bogus `seat` field. A 號/番 match is only accepted
 *    when at least one other CJK seating marker (區/排/樓/層/階/列/ブロック)
 *    also appears in the string; all three of this module's Chinese/
 *    Japanese spec examples satisfy that, and a bare street address does
 *    not.
 *    NOTE: these classes match traditional-Chinese forms only (區/樓/層/號
 *    — correct for this app's Hong Kong userbase). Simplified-Chinese
 *    variants (区/楼/层/号) are NOT recognised for level/block/seat, so a
 *    simplified-script input is only ever partially parsed via whatever
 *    happens to share a character with the traditional set (排, "row", is
 *    identical in both scripts) — never a false `unparseable`, but not a
 *    full parse either. Flagged as future work rather than silently
 *    supported; see the "not handled" list below.
 *
 * 7. Bare unlabeled numbers (e.g. "12345") are never treated as a seat.
 *    Too ambiguous — could be a ticket ID, a price, a postcode. Only
 *    numbers inside a recognised keyword, delimiter template, or CJK
 *    marker context are accepted.
 *
 * 8. Row values are preserved verbatim, never normalised or reordered.
 *    Real venues (Kai Tak confirmed) run row letters A (front, nearest the
 *    pitch) → Z, then double to AA, BB, … QQ at the back — so `BB` is a
 *    deep/back row that sorts AFTER `Z`, not lexicographically after `B`.
 *    This module does not implement row depth/ordering (that's a
 *    presentation concern, out of scope here) — it just keeps the raw
 *    string intact so a future depth-aware utility has the real value to
 *    work with. Do not alphabetically sort raw row strings as a stand-in
 *    for physical depth; `AA` "coming after" `A` alphabetically happens to
 *    be correct, but naive lexicographic sort of all rows together is not
 *    (`BB` < `Z` lexicographically, but BB is physically further back).
 *
 * Formats NOT handled (deliberately, not oversights):
 *  - Numeric-row dash-compacts, e.g. `225-08-101` — indistinguishable from
 *    an ISO date fragment; see point 4.
 *  - Bare unlabeled numbers; see point 7.
 *  - Bare "GA" (with no "Pit"/"General Admission" wording) — only the two
 *    spec-confirmed phrasings ("General Admission", "GA Pit") are
 *    recognised; a two-letter standalone "GA" token is far too collision-
 *    prone against unrelated abbreviations to add speculatively.
 *  - Seat ranges/plurals, e.g. "Seats 101-105" — not in the brief, and a
 *    range is a fundamentally different data shape (a set, not a single
 *    seat) that this module's single-seat result type isn't designed to
 *    carry; left for a future dedicated range parser if needed.
 *  - Simplified-Chinese script variants (区/楼/层/号) — see point 6.
 *  - Full-width digits (２２５) or CJK numerals (二樓 / 二二五) — not present
 *    in any confirmed real example; flagged here as future work rather
 *    than guessed at.
 */

// ---- Public types ---------------------------------------------------------

export type SeatFieldSource = "stated" | "inferred";

/** A single parsed value plus whether it was read directly off the input
 * ("stated") or derived by this module ("inferred") — see header point 1. */
export interface SeatField<T = string> {
  value: T;
  source: SeatFieldSource;
}

/** Recorded when an explicit value and a derived one disagree. The explicit
 * value always wins in `fields`; this is only a surfaced warning. */
export interface SeatFieldConflict {
  field: "level";
  stated: number;
  impliedByBlock: number;
}

export interface ParsedSeatFields {
  gate?: SeatField<string>;
  level?: SeatField<number>;
  /** Stadium/arena block number, e.g. "225", "519B" — letter suffix preserved verbatim. */
  block?: SeatField<string>;
  /** Generic ticketing-site section number, e.g. "118" (Section/Sec/Sect). No level tie-in — see header point 2. */
  section?: SeatField<string>;
  /** Named area with no block/section number: theatre tiers (Stalls, Dress
   * Circle, Upper Circle, Balcony), arena floor (Floor A), or a standing/GA
   * category (Standing, General Admission, GA Pit). */
  area?: SeatField<string>;
  row?: SeatField<string>;
  seat?: SeatField<string>;
}

export interface ParseSeatOptions {
  /**
   * Optional per-venue mapping from a block number to its seating level.
   * Deliberately NOT built in by default — see module header point 1: Kai
   * Tak Stadium's own numbering breaks the "leading digit" assumption (both
   * 1xx AND 2xx blocks sit on Level 2; there is no Level 1 tier), so a
   * universal digit-based rule would be actively wrong for the one venue
   * this was checked against. Supply a confirmed per-venue mapping here;
   * return `null` for a block you don't have data for.
   */
  inferLevelFromBlock?: (block: string) => number | null;
}

export type SeatParseResult =
  | { status: "parsed"; raw: string; fields: ParsedSeatFields; conflicts: SeatFieldConflict[] }
  | { status: "partial"; raw: string; fields: ParsedSeatFields; conflicts: SeatFieldConflict[] }
  | { status: "unparseable"; raw: string };

// ---- Internal: field regexes -----------------------------------------------

// A handful of common short English filler words that can otherwise be
// swept up as a field value when a keyword like "row" or "gate" appears in
// unrelated prose (e.g. "please wait in a row until called"). Deliberately
// excludes "a"/"an": single-letter rows are extremely common in real seat
// data (front row is often literally "Row A") and must not be filtered.
const STOPWORDS = new Set([
  "of", "the", "is", "to", "and", "or", "in", "on", "at", "for", "with",
  "by", "are", "was", "your", "near", "before", "until",
]);

function applyStopwordGuard(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return STOPWORDS.has(value.toLowerCase()) ? undefined : value;
}

const GATE_RE = /\bgate\s*[:#]?\s*([A-Za-z0-9]{1,4})\b/i;
const LEVEL_RE = /\blevel\s*[:#]?\s*(\d{1,2})\b/i;
const BLOCK_RE = /\b(?:block|blk)\.?\s*[:#]?\s*(\d{1,4}[A-Za-z]?)\b/i;
const SECTION_RE = /\b(?:section|sect|sec)\.?\s*[:#]?\s*(\d{1,4}[A-Za-z]?)\b/i;

// Row values are kept short and shaped like real row labels (1–3 letters,
// e.g. "BB", or 1–3 digits, e.g. "12") — this is also what keeps "Row of
// chairs"-style prose from matching (a 4+ letter word can't fit the shape).
const ROW_VALUE = "(?:[A-Za-z]{1,3}|\\d{1,3})";
const ROW_RE = new RegExp(`\\brow\\s*[:#]?\\s*(${ROW_VALUE})\\b`, "i");
// Bare "R"/"S" abbreviations (e.g. "Blk 225 R BB S 101") are single common
// letters, so they're only attempted as a fallback once a block/section/area
// has already been found elsewhere in the string — see `scanGeneral`.
const ROW_ABBR_RE = new RegExp(`\\br\\.?\\s+(${ROW_VALUE})\\b`, "i");
const SEAT_RE = /\bseat\s*[:#]?\s*(\d{1,4}[A-Za-z]?)\b/i;
const SEAT_ABBR_RE = /\bs\.?\s+(\d{1,4}[A-Za-z]?)\b/i;

// Chinese: 樓/層 = level (floor), 區 = block, 排 = row, 號 = seat number.
// Japanese: 階 = level, ブロック = block, 列 = row, 番 = seat number.
const LEVEL_CJK_RE = /第?\s*(\d{1,2})\s*[樓層階]/;
const BLOCK_CJK_RE = /(\d{1,4}[A-Za-z]?)\s*(?:區|ブロック)/;
const ROW_CJK_RE = /([A-Za-z0-9]{1,3})\s*[排列]/;
// Gate for 號/番 seat markers — see header point 6 (address-number collision).
const CJK_SEATING_CONTEXT_RE = /[區排樓層階列]|ブロック/;
const SEAT_CJK_RE = /(\d{1,4})\s*[號番]/;

function extractCjkSeat(s: string): string | undefined {
  if (!CJK_SEATING_CONTEXT_RE.test(s)) return undefined;
  return s.match(SEAT_CJK_RE)?.[1];
}

interface AreaRule {
  re: RegExp;
  label: (m: RegExpMatchArray) => string;
}

// Order matters: more specific phrases ("Dress Circle", "GA Pit") must be
// checked before the shorter phrases they could otherwise be swallowed by.
const AREA_RULES: AreaRule[] = [
  { re: /\bdress\s+circle\b/i, label: () => "Dress Circle" },
  { re: /\bupper\s+circle\b/i, label: () => "Upper Circle" },
  { re: /\bga\s*pit\b/i, label: () => "GA Pit" },
  { re: /\bgeneral\s+admission\b/i, label: () => "General Admission" },
  { re: /\bstalls\b/i, label: () => "Stalls" },
  { re: /\bbalcony\b/i, label: () => "Balcony" },
  { re: /\bstanding\b/i, label: () => "Standing" },
  // Optional single-letter sub-label, e.g. "Floor A" — the single-char
  // class plus trailing \b means a multi-letter word right after "Floor"
  // (like "Floor Row 3") can't accidentally be captured as the sub-label.
  { re: /\bfloor\b(?:\s+([A-Za-z]))?\b/i, label: (m) => (m[1] ? `Floor ${m[1]}` : "Floor") },
];

function matchArea(s: string): string | undefined {
  for (const rule of AREA_RULES) {
    const m = s.match(rule.re);
    if (m) return rule.label(m);
  }
  return undefined;
}

// ---- Internal: extraction --------------------------------------------------

interface ExtractedRaw {
  gate?: string;
  level?: { value: number; source: "stated" };
  block?: string;
  section?: string;
  area?: string;
  row?: string;
  seat?: string;
}

function hasAnyField(f: ExtractedRaw): boolean {
  return !!(f.gate || f.level || f.block || f.section || f.area || f.row || f.seat);
}

/** Scans the whole string for keyword+value pairs anywhere within it — see
 * header point 5 for why this doesn't require the string to BE a clean
 * seat descriptor. */
function scanGeneral(s: string): ExtractedRaw {
  const out: ExtractedRaw = {};

  const gate = applyStopwordGuard(s.match(GATE_RE)?.[1]);
  if (gate) out.gate = gate;

  const levelValue = s.match(LEVEL_RE)?.[1] ?? s.match(LEVEL_CJK_RE)?.[1];
  if (levelValue) out.level = { value: Number(levelValue), source: "stated" };

  const block = s.match(BLOCK_RE)?.[1] ?? s.match(BLOCK_CJK_RE)?.[1];
  if (block) out.block = block;

  const section = s.match(SECTION_RE)?.[1];
  if (section) out.section = section;

  const area = matchArea(s);
  if (area) out.area = area;

  let row = applyStopwordGuard(s.match(ROW_RE)?.[1]) ?? s.match(ROW_CJK_RE)?.[1];
  if (!row && (out.block || out.section || out.area)) {
    row = applyStopwordGuard(s.match(ROW_ABBR_RE)?.[1]);
  }
  if (row) out.row = row;

  let seat = s.match(SEAT_RE)?.[1];
  if (!seat && out.row) {
    seat = s.match(SEAT_ABBR_RE)?.[1];
  }
  if (!seat) {
    seat = extractCjkSeat(s);
  }
  if (seat) out.seat = seat;

  return out;
}

/** `2/225/BB/101` — level/block/row/seat, purely positional (no keywords).
 * The level here counts as "stated" per header point 3. */
function tryCompactSlash(s: string): ExtractedRaw | null {
  const m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,4}[A-Za-z]?)\s*\/\s*([A-Za-z]{1,3}|\d{1,3})\s*\/\s*(\d{1,4}[A-Za-z]?)$/);
  if (!m) return null;
  return {
    level: { value: Number(m[1]), source: "stated" },
    block: m[2],
    row: m[3],
    seat: m[4],
  };
}

/** `225-BB-101` — block-row-seat. The row segment is restricted to letters
 * only: a numeric middle segment is indistinguishable from an ISO date
 * (`2026-08-18`) — see header point 4. No level segment exists in this
 * template, so level is left entirely unstated here. */
function tryCompactDash(s: string): ExtractedRaw | null {
  const m = s.match(/^(\d{1,4}[A-Za-z]?)\s*-\s*([A-Za-z]{1,3})\s*-\s*(\d{1,4}[A-Za-z]?)$/);
  if (!m) return null;
  return { block: m[1], row: m[2], seat: m[3] };
}

// ---- Internal: level finalisation -----------------------------------------

function finalizeLevel(
  level: { value: number; source: "stated" } | undefined,
  block: string | undefined,
  inferLevelFromBlock: ((block: string) => number | null) | undefined,
): { level?: SeatField<number>; conflicts: SeatFieldConflict[] } {
  const implied = block && inferLevelFromBlock ? inferLevelFromBlock(block) : null;

  if (level) {
    const conflicts: SeatFieldConflict[] = [];
    if (implied !== null && implied !== level.value) {
      // Explicit value wins — see header point 1 and the class doc on
      // `SeatFieldConflict`. We never silently pick the derived one.
      conflicts.push({ field: "level", stated: level.value, impliedByBlock: implied });
    }
    return { level, conflicts };
  }

  if (implied !== null) {
    return { level: { value: implied, source: "inferred" }, conflicts: [] };
  }

  return { level: undefined, conflicts: [] };
}

function wrap<T>(value: T | undefined): SeatField<T> | undefined {
  return value === undefined ? undefined : { value, source: "stated" };
}

// ---- Internal: confidence classification -----------------------------------

/**
 * "Parsed" = confidently complete for what the string appears to describe:
 * either a specific seat was pinned down (row + seat), or the string names
 * only an area with nothing further to extract (e.g. "Standing", "Upper
 * Circle" — those inputs don't promise a row/seat, so their absence isn't a
 * gap). Everything else that matched SOMETHING but not that — e.g. a block
 * with no row, or a row with no seat — is "partial", per the brief's own
 * example ("found a block but no row").
 */
function classify(fields: ParsedSeatFields): "parsed" | "partial" {
  const hasRow = !!fields.row;
  const hasSeat = !!fields.seat;
  const hasArea = !!fields.area;

  if (hasRow && hasSeat) return "parsed";
  if (hasArea && !hasRow && !hasSeat) return "parsed";
  return "partial";
}

// ---- Public API -------------------------------------------------------------

/**
 * Parse a raw venue seat-location string into structured fields. Never
 * throws — unparseable/garbage/empty input returns `{ status: "unparseable" }`
 * rather than a half-filled object or an exception. The original string is
 * always preserved on `raw` so callers can fall back to displaying it as-is.
 */
export function parseSeat(input: string, opts: ParseSeatOptions = {}): SeatParseResult {
  const raw = input;
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) return { status: "unparseable", raw };

  // Compact delimited templates tolerate incidental whitespace around their
  // delimiters and a single trailing punctuation mark (e.g. a stray period
  // at the end of a pasted line) without loosening the anchors that keep
  // them from misfiring inside prose.
  const compactCandidate = normalized.replace(/[.,;]+$/, "");
  const extracted =
    tryCompactSlash(compactCandidate) ?? tryCompactDash(compactCandidate) ?? scanGeneral(normalized);

  if (!hasAnyField(extracted)) return { status: "unparseable", raw };

  const { level, conflicts } = finalizeLevel(extracted.level, extracted.block, opts.inferLevelFromBlock);
  const fields: ParsedSeatFields = {
    gate: wrap(extracted.gate),
    level,
    block: wrap(extracted.block),
    section: wrap(extracted.section),
    area: wrap(extracted.area),
    row: wrap(extracted.row),
    seat: wrap(extracted.seat),
  };

  const status = classify(fields);
  return { status, raw, fields, conflicts };
}
