/**
 * Prompt for drafting a `VenueSeatMapConfig` (see ./types.ts) from a seating-plan image/PDF.
 * Lives in its own module (not inlined in the route) so it's independently versioned —
 * `DRAFT_PROMPT_VERSION` is part of the AI-scrape cache key (see
 * POST /api/venues/[id]/seatmap/draft), so bumping it invalidates every cached draft and
 * forces a fresh AI call the next time a plan is (re-)drafted.
 *
 * Bump this whenever the prompt text changes in any way that could change the model's output.
 */
export const DRAFT_PROMPT_VERSION = "2026-09-24.1";

import { kaiTakStadium } from "./venues/kai-tak";

/** The Kai Tak config serves as the prompt's worked example — trimmed to the levels array plus
 * the top-level scalar fields, since the full config (gates/asymmetries/unticketedLevels) is
 * more than the model needs to see the shape once. */
const EXAMPLE_CONFIG = JSON.stringify(
  {
    id: kaiTakStadium.id,
    name: kaiTakStadium.name,
    aliases: kaiTakStadium.aliases,
    bowlShape: kaiTakStadium.bowlShape,
    orientationConfidence: kaiTakStadium.orientationConfidence,
    levels: kaiTakStadium.levels,
    gates: kaiTakStadium.gates.slice(0, 2),
    asymmetries: kaiTakStadium.asymmetries,
    blockSuffixConfidence: kaiTakStadium.blockSuffixConfidence,
  },
  null,
  2
);

export interface DraftPromptVenue {
  id: string;
  name: string;
  aliases: string[];
}

/**
 * Builds the draft-extraction prompt for one venue's seating-plan image/PDF.
 * `planUrl` is echoed back into the required `seatingPlanSources` entry so the caller doesn't
 * have to guess whether the model actually used it as its source.
 */
export function buildDraftPrompt(venue: DraftPromptVenue, planUrl: string, notes?: string): string {
  return `You are drafting a procedural seat-map config for a venue from its official seating-plan image or PDF. The output is REVIEWED by a human before it's ever shown to anyone — accuracy and honesty about uncertainty matter far more than completeness. A missing block is fine; a confidently wrong one is not.

Return ONLY a JSON object matching this TypeScript shape (VenueSeatMapConfig):

interface VenueSeatMapConfig {
  id: string;                 // a short kebab-case slug, e.g. "asiaworld-expo-arena"
  name: string;                // the venue's official name
  aliases: string[];           // other names/spellings used for this venue — include the ones given below
  bowlShape: "rounded-rect";   // always this literal value
  capacityApprox?: { total?: number; concert?: number; confidence: "confirmed" | "unconfirmed" };
  orientationConfidence: "confirmed" | "unconfirmed"; // ALWAYS "unconfirmed" — see rules below
  levels: LevelConfig[];
  unticketedLevels?: { id: string; label: string; confidence: "confirmed" | "unconfirmed"; note: string }[];
  gates: { id: string; confidence: "confirmed" | "unconfirmed"; side?: "shortEndA"|"shortEndB"|"longSideA"|"longSideB"; note: string }[];
  asymmetries: { label: string; side?: "shortEndA"|"shortEndB"|"longSideA"|"longSideB"; confidence: "confirmed" | "unconfirmed" }[];
  blockSuffixConfidence: "confirmed" | "unconfirmed";
  layout?: "bowl-end-stage" | "bowl-centre-stage" | "theatre";
  seatingPlanSources: { url: string; label: string }[]; // REQUIRED — see rules below
}

interface LevelConfig {
  id: string;                  // kebab-case, e.g. "level-2", "floor"
  label: string;                // human label as printed on the plan, e.g. "Level 2", "Floor Standing"
  tier: number;                 // 0 = ground/floor, increasing outward/upward — ordinal, not measured
  radiusRange: [number, number]; // [inner, outer] fraction of overall bowl depth, 0 = pitch/stage edge, 1 = outer wall — a
                                  // RENDERING PROXY, not a measurement. Order levels by tier and give each a distinct,
                                  // non-overlapping band, e.g. floor [0.05,0.2], next tier [0.25,0.55], outer tier [0.6,0.95].
  blockNumberRanges: { min: number; max: number; positionConfidence: "confirmed" | "unconfirmed"; note?: string }[];
  blockLabelRanges?: { labels: string[]; positionConfidence: "confirmed" | "unconfirmed"; note?: string }[];
  kind?: "stand" | "floor";     // omit for "stand" (the default)
  zones?: string[];              // named standing zones (e.g. floor Zone A/B/C) — a completely separate scheme from blocks
}

## Layouts
- "bowl-end-stage" (default if omitted): stands on three sides of a floor, stage at one short end.
- "bowl-centre-stage": stands on all four sides, stage in the middle (四面台).
- "theatre": rows facing a proscenium/thrust stage — no bowl geometry, just note the layout.
Pick the one that matches what the plan actually shows. If genuinely unclear, omit \`layout\` (defaults to "bowl-end-stage").

## Level kind and block ordering
- A "stand" level's blocks run along the bowl's arc — list \`blockNumberRanges\`/\`blockLabelRanges\` entries in
  CLOCKWISE order starting from the stage (as printed on the plan). This ordering is what lets the renderer place
  blocks around the bowl correctly — getting it backwards silently mirrors the whole level.
- A "floor" level's blocks (or standing \`zones\`) are depth bands in FRONT of the stage — order them front-to-back
  (nearest the stage first).
- Numeric blocks (e.g. "201"-"240") go in \`blockNumberRanges\` as inclusive [min,max] pairs. Non-numeric blocks
  (letters, named boxes, "A"-"D") go in \`blockLabelRanges\` as an ordered \`labels\` array — never invent numbers for
  lettered blocks or vice versa.

## Confidence rules — read carefully, these are the most important rules in this prompt
- \`positionConfidence\` on a block range: "confirmed" ONLY when the plan unambiguously shows where this specific
  range sits around the bowl (or along the floor). If you can tell a block EXISTS and roughly which level/tier it's
  on, but not precisely where in the arc/depth order it falls relative to neighbors, mark it "unconfirmed" — do not
  upgrade a guess to "confirmed" just because you produced a number for it.
- \`orientationConfidence\` at the top level: ALWAYS "unconfirmed". A seating-plan image's compass/orientation is
  never confirmed from the image alone.
- Every \`confidence\`/\`positionConfidence\` field defaults to "unconfirmed" — only mark something "confirmed" when
  the plan is unambiguous about that specific fact.
- NEVER invent a block range, gate, level, or capacity number that isn't actually printed on the plan. If the plan
  doesn't show something (e.g. no visible gate labels), omit it rather than guessing — an empty \`gates: []\` is
  correct and expected when the plan has none.
- If a block's exact min/max isn't legible but a level clearly exists, you may still record the level with an empty
  \`blockNumberRanges: []\` rather than skipping the level entirely.

## Required
- \`seatingPlanSources\` MUST include exactly this entry (plus any other plan images also supplied): \`{ "url": ${JSON.stringify(planUrl)}, "label": "Official seating plan" }\`.
- \`aliases\` MUST include: ${JSON.stringify(venue.aliases.length > 0 ? venue.aliases : [venue.name])}.
- \`id\` and \`name\`: reuse ${JSON.stringify(venue.id)} and ${JSON.stringify(venue.name)} — do not invent different ones.
${notes ? `\n## Reviewer notes for this plan\n${notes}\n` : ""}
## Worked example (Kai Tak Stadium — for SHAPE reference only, do not copy its facts)
${EXAMPLE_CONFIG}

Now read the attached seating-plan image/PDF for "${venue.name}" and produce the JSON object described above. Return ONLY the JSON object, no prose, no markdown fences.`;
}
