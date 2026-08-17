/**
 * Kai Tak Stadium (Hong Kong) venue seat-map config.
 *
 * Sourced from concordant HK media plus crowd-sourced seat-photo sites — see the project
 * brief for the full research summary. Every fact below that isn't independently
 * corroborated is marked `confidence: "unconfirmed"` rather than presented as settled; the
 * geometry resolver (geometry.ts) reads those markers and hedges accordingly instead of
 * fabricating precision the sources don't support.
 */

import type { VenueSeatMapConfig } from "../types";

export const kaiTakStadium: VenueSeatMapConfig = {
  id: "kai-tak-stadium",
  name: "Kai Tak Stadium",
  // Full, unambiguous aliases only — see registry.ts for why a bare "Kai Tak" must NOT
  // match here (Kai Tak Cruise Terminal / 啟德郵輪碼頭 is a real, separate HK concert venue).
  aliases: ["Kai Tak Stadium", "Kai Tak Sports Park", "啟德體育園", "啟德主場館"],
  bowlShape: "rounded-rect",
  capacityApprox: { total: 50000, concert: 35000, confidence: "confirmed" },
  // The source map's compass may be stylized — every `side` below is a RELATIVE label only.
  orientationConfidence: "unconfirmed",

  levels: [
    {
      id: "floor",
      label: "Floor / Ground (Standing)",
      tier: 0,
      radiusRange: [0.05, 0.2],
      blockNumberRanges: [],
      // Completely separate scheme from numbered blocks — do not conflate with Level 2/5.
      zones: ["Zone A", "Zone B", "Zone C"],
    },
    {
      id: "level-2",
      label: "Level 2",
      tier: 1,
      radiusRange: [0.25, 0.55],
      blockNumberRanges: [
        {
          min: 101,
          max: 110,
          // Confirmed as a Level 2 lower sub-section, but where it sits around the bowl
          // relative to 201-240 is not documented — no angle/marker position is guessed.
          positionConfidence: "unconfirmed",
          note: "Lower sub-section of Level 2; position along the bowl relative to 201-240 is unconfirmed.",
        },
        {
          min: 201,
          max: 240,
          // The internal arc position of this run IS reasonably well documented (that's how
          // 216-219 is known to be the best-facing centre) — see `wrap` below for the
          // separate, unconfirmed question of how the two ends of this run connect.
          positionConfidence: "confirmed",
        },
      ],
      wrap: {
        confirmed: false,
        note:
          "Level 5 confirms 501 and 540 sit adjacent at the stage seam; whether Level 2's " +
          "240/201 boundary closes the same way (or connects to the 101-110 bank) is unconfirmed.",
      },
      stageFacing: {
        best: [[216, 219]],
        mostOblique: [[203, 204], [230, 231]],
        closedForConcerts: [[233, 240]],
      },
      // No documented row-bank split for Level 2 — this is itself UNCONFIRMED (not
      // "confirmed no split"), which the resolver reflects via `confidence.rowBank`.
    },
    {
      id: "level-5",
      label: "Level 5",
      tier: 2,
      radiusRange: [0.6, 0.95],
      blockNumberRanges: [
        { min: 501, max: 540, positionConfidence: "confirmed" },
      ],
      wrap: {
        confirmed: true,
        note: "501 and 540 are reported adjacent at the stage seam.",
      },
      stageFacing: {
        best: [[518, 523]],
        mostOblique: [[506, 507], [534, 535]],
        closedForConcerts: [[501, 505], [536, 540]],
      },
      rowBankSplit: {
        lowerRows: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"],
        upperRows: [
          "AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ", "KK", "LL", "MM", "NN", "OO", "PP", "QQ",
        ],
        confidence: "confirmed",
      },
    },
  ],

  unticketedLevels: [
    {
      id: "level-3",
      label: "Level 3",
      confidence: "confirmed",
      note: "Hospitality suites — not numbered ticketed seating.",
    },
    {
      id: "level-4",
      label: "Level 4",
      confidence: "unconfirmed",
      note: "Likely no ticketed tier at all; not modeled as sold seating.",
    },
  ],

  // Gates B, D, E, F, G, H exist (no A or C), all at concourse/Main Level — gates are not
  // tier-specific. Gate-to-BLOCK mapping is unconfirmed (the gate data comes from a Sevens
  // map, not a concert map), so no gate below claims to serve any particular block.
  gates: [
    { id: "F", confidence: "confirmed", side: "longSideB", note: "General admission gate, on the long side opposite the glazed one. Block-to-gate mapping is unconfirmed." },
    { id: "B", confidence: "unconfirmed", note: "Concourse-level gate; position around the bowl is unconfirmed." },
    { id: "D", confidence: "unconfirmed", note: "Concourse-level gate; position around the bowl is unconfirmed." },
    { id: "E", confidence: "unconfirmed", note: "Concourse-level gate; position around the bowl is unconfirmed." },
    { id: "G", confidence: "unconfirmed", note: "Concourse-level gate; position around the bowl is unconfirmed." },
    { id: "H", confidence: "unconfirmed", note: "Concourse-level gate; position around the bowl is unconfirmed." },
  ],

  asymmetries: [
    // Distinct from Gate F's side by construction (sources describe them with different
    // compass words), but WHICH physical side is "A" vs "B" is arbitrary/unconfirmed.
    { label: "Glazed long side (harbour view)", side: "longSideA", confidence: "unconfirmed" },
    // No source ties this to either short end relative to the stage/Gate F/glazed side, so
    // it deliberately gets no `side` at all rather than an invented one.
    { label: "Hospitality-heavy short end", confidence: "unconfirmed" },
  ],

  blockSuffixConfidence: "unconfirmed",
};
