/**
 * Row-depth ordering utilities, shared by the geometry resolver and available for reuse
 * elsewhere (e.g. a future AI-advice layer). Kept separate from geometry.ts because the row
 * ordering rule is general (any venue using A→Z→AA…QQ front-to-back), while geometry.ts is
 * about resolving a specific block within a specific venue config.
 *
 * See seat-parse.ts header point 8: real venues (Kai Tak confirmed) run row letters A
 * (front) → Z, then double to AA, BB, … QQ at the back — so `BB` sorts AFTER `Z`, not
 * lexicographically after `B`. Naive alphabetical sort of all rows together is wrong.
 */

import type { RowBankSplit } from "./types";

const SINGLE_LETTER_ROWS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)); // A..Z
// Doubled rows only go up to QQ (Q is the 17th letter) per the confirmed Kai Tak chart, not
// all the way to ZZ — do not extend this without a confirmed source.
const DOUBLE_LETTER_ROWS = Array.from({ length: 17 }, (_, i) => {
  const c = String.fromCharCode(65 + i);
  return c + c;
});

/** Default front-to-back row sequence for a level with no documented bank split: A..Z, then
 * AA..QQ further back still. */
export const DEFAULT_ROW_SEQUENCE: readonly string[] = [...SINGLE_LETTER_ROWS, ...DOUBLE_LETTER_ROWS];

/** Depth fraction (0 = frontmost, 1 = backmost) for a row using the default continuous
 * sequence. Returns `null` for a row not in the sequence — never a guessed position. */
export function defaultRowDepthFraction(row: string): number | null {
  const idx = DEFAULT_ROW_SEQUENCE.indexOf(row.toUpperCase());
  if (idx === -1) return null;
  return idx / (DEFAULT_ROW_SEQUENCE.length - 1);
}

// A banked level reserves this much of the [0,1] depth range for each bank, leaving a real
// gap in between to represent the walkway physically separating them.
const LOWER_BANK_MAX = 0.4;
const UPPER_BANK_MIN = 0.6;

/** Depth fraction for a level with a documented lower/upper row-bank split (Kai Tak Level 5:
 * rows A-M lower, AA-QQ upper, separated by a walkway). Every upper-bank row lands at or
 * beyond `UPPER_BANK_MIN`, so even the very first upper row (AA) is placed further back than
 * the very last lower row (M) — the walkway break is modelled explicitly, not implied by
 * index order alone. Returns `null` for a row in neither bank (e.g. "N" through "Z", which
 * legitimately don't exist in either Kai Tak Level 5 bank). */
export function bankedRowDepthFraction(row: string, split: RowBankSplit): number | null {
  const upper = row.toUpperCase();

  const lowerIdx = split.lowerRows.indexOf(upper);
  if (lowerIdx !== -1) {
    return (lowerIdx / Math.max(split.lowerRows.length - 1, 1)) * LOWER_BANK_MAX;
  }

  const upperIdx = split.upperRows.indexOf(upper);
  if (upperIdx !== -1) {
    return UPPER_BANK_MIN + (upperIdx / Math.max(split.upperRows.length - 1, 1)) * (1 - UPPER_BANK_MIN);
  }

  return null;
}

/** Depth fraction (0 = frontmost, 1 = backmost) for a row using a level's own documented
 * `LevelConfig.rowSequence` (see types.ts for the full precedence rule against
 * `rowBankSplit`) — e.g. Hong Kong Coliseum's stand (`["AA", "1", …, "20"]`) or
 * AsiaWorld-Expo Arena's balcony (A-Z skipping I/O). A row's depth is simply its index in the
 * sequence. Returns `null` for a row not in the sequence — never a guessed position, same
 * contract as `defaultRowDepthFraction`. */
export function sequenceRowDepthFraction(row: string, sequence: readonly string[]): number | null {
  const upper = row.toUpperCase();
  const idx = sequence.findIndex((r) => r.toUpperCase() === upper);
  if (idx === -1) return null;
  return idx / Math.max(sequence.length - 1, 1);
}

// Assumed row count for a numbered-row block, floor or stand (arena floors commonly run rows
// 1..~30; a numbered stand aisle is treated the same way once no documented scheme applies).
// Not a documented figure for any venue — only used to turn a numeric row into a coarse
// front/back position, and the resolver hedges whenever it's applied.
const ASSUMED_NUMERIC_ROW_COUNT = 30;

/** Depth fraction for a purely numeric row ("1" = front), clamped to [0,1] against
 * `ASSUMED_NUMERIC_ROW_COUNT`. Returns `null` for anything that isn't a positive integer row.
 * The resolver only falls back to this once no documented row scheme (`rowBankSplit` or
 * `rowSequence`) applies to the level — see geometry.ts. */
export function numericRowDepthFraction(row: string): number | null {
  if (!/^\d{1,3}$/.test(row)) return null;
  const n = Number(row);
  if (n < 1) return null;
  return Math.min(1, (n - 1) / (ASSUMED_NUMERIC_ROW_COUNT - 1));
}
