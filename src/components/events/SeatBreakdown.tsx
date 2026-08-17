"use client";

import type { ParsedSeatFields, SeatParseResult } from "@/lib/seat-parse";

/**
 * Live "breakdown chip" shown under the Seat input in EventModal — parses
 * on every keystroke (the parser is synchronous, so this is cheap) and is
 * status-aware:
 *  - "parsed"      -> full structured breakdown, e.g. "Gate F · Level 2 ·
 *                      Block 225 · Row BB · Seat 101".
 *  - "partial"     -> whatever fields were found, visibly flagged as
 *                      incomplete rather than presented as a finished parse.
 *  - "unparseable" -> the raw text, plainly, with no fabricated structure.
 * Any field whose `source` is "inferred" (only possible once a caller opts
 * into `inferLevelFromBlock`, which EventModal deliberately does not — see
 * seat-parse.ts header point 1) is rendered muted with a trailing "?" so a
 * guess is never mistaken for something read off the ticket. Conflicts (an
 * explicit value disagreeing with a derived one) are surfaced, never
 * silently resolved.
 */
export function SeatBreakdown({ result }: { result: SeatParseResult }) {
  if (result.status === "unparseable") {
    return (
      <p className="text-xs text-muted-foreground/70" data-testid="seat-breakdown">
        Not recognized — showing as entered: <span className="italic">{result.raw}</span>
      </p>
    );
  }

  const entries = fieldEntries(result.fields);

  return (
    <div className="text-xs" data-testid="seat-breakdown">
      <p className={result.status === "partial" ? "text-amber-500/90" : "text-muted-foreground"}>
        {result.status === "partial" && <span className="font-medium">Partial — </span>}
        {entries.map((entry, i) => (
          <span key={entry.key}>
            <span
              className={entry.inferred ? "italic text-muted-foreground/70" : ""}
              title={entry.inferred ? "Inferred, not stated on the ticket" : undefined}
            >
              {entry.text}
              {entry.inferred ? "?" : ""}
            </span>
            {i < entries.length - 1 ? " · " : ""}
          </span>
        ))}
      </p>
      {result.conflicts.length > 0 && (
        <p className="text-destructive mt-0.5">
          {result.conflicts.map((c, i) => (
            <span key={i}>
              Ticket says Level {c.stated} but Block {result.fields.block?.value ?? "?"} implies Level {c.impliedByBlock}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function fieldEntries(fields: ParsedSeatFields): Array<{ key: string; text: string; inferred: boolean }> {
  const entries: Array<{ key: string; text: string; inferred: boolean }> = [];
  const push = (key: string, label: string, field?: { value: string | number; source: "stated" | "inferred" }) => {
    if (!field) return;
    entries.push({
      key,
      text: label ? `${label} ${field.value}` : String(field.value),
      inferred: field.source === "inferred",
    });
  };
  push("gate", "Gate", fields.gate);
  push("level", "Level", fields.level);
  push("block", "Block", fields.block);
  push("section", "Section", fields.section);
  push("area", "", fields.area);
  push("row", "Row", fields.row);
  push("seat", "Seat", fields.seat);
  return entries;
}
