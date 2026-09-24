/**
 * Hand-drafted `VenueSeatMapConfig`s for a batch of Hong Kong venues, sourced from each
 * venue's official (or best-available) seating-plan image/PDF plus a small amount of
 * corroborating media coverage — see the individual `note`/hedge fields and the comments
 * below for exactly what each fact rests on.
 *
 * Follows the same honesty contract as `src/lib/venue-seatmap/venues/kai-tak.ts`: nothing
 * here is upgraded to `confidence: "confirmed"` beyond what the source plan itself shows
 * unambiguously. `orientationConfidence` is always `"unconfirmed"` (a plan image's compass is
 * never confirmed from the image alone — see `draft-prompt.ts`'s drafting rules, which this
 * file follows by hand rather than via the AI drafting flow).
 *
 * This file is data only — no registration, no DB writes. `VENUE_SEATMAP_DRAFTS` is meant to
 * be fed through `validateSeatMapConfig` (see ../../src/lib/venue-seatmap/validate.ts) and
 * written to `EventVenue.seatMapConfig` by a separate review/import step, not by this file.
 *
 * `NOT_FOUND_VENUES` records venues that were deliberately NOT drafted, and why — so a future
 * pass doesn't re-attempt (or silently skip) the same dead end without context.
 */
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";

export interface VenueSeatMapDraft {
  /** Exact `EventVenue.name` in the DB this draft is intended for. */
  venueName: string;
  /** The seating-plan image/PDF this draft was read from. */
  planUrl: string;
  config: VenueSeatMapConfig;
}

export interface NotFoundVenue {
  venueName: string;
  reason: string;
  tried: string[];
}

// ---- 1. AsiaWorld-Expo Arena (Hall 1) -----------------------------------------------

const AWE_PLAN_IMAGE_URL = "https://i0.wp.com/blog.hktvmall.com/wp-content/uploads/2025/10/image-17.png";
const AWE_PLAN_PAGE_URL = "https://blog.hktvmall.com/hktvmore-lifestyle/asiaexpo-seatingplan-and-traffic/";

/**
 * AsiaWorld-Expo Arena (Hall 1), end-stage bowl: a flat floor (blocks A-D, front to back) plus
 * one wraparound "Arena Balcony" stand (blocks 1-17, clockwise from one stage end to the
 * other). The balcony's row lettering (A-Z skipping I/O) is reported at only moderate
 * confidence by the source and isn't independently corroborated — modeled via the balcony
 * level's `rowSequence`, but still only an approximation on top of an already-unconfirmed
 * scheme. The floor's own row scheme isn't documented at all, so its rows are left on the
 * generic numeric-row fallback rather than folded into the same (unrelated) lettered sequence.
 * Capacity isn't documented beyond "this is an arena hall" — no `capacityApprox` is recorded
 * rather than guessing a number.
 */
export const asiaWorldExpoArena: VenueSeatMapConfig = {
  id: "asiaworld-expo-arena",
  name: "亞洲國際博覽館 ARENA",
  // Full, unambiguous aliases only — never a bare "AWE"/"Hall" that could collide with AWE's
  // other halls/exhibition venues (see NOT_FOUND_VENUES below for several of those).
  aliases: ["AsiaWorld-Expo Arena", "AsiaWorld-Arena", "亞洲國際博覽館 ARENA", "亞博 Arena", "博覽館Arena"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "bowl-end-stage",
  // A long, narrow hall (short stage end) so the balcony's block 9 — reported as the far-wall
  // block dead-centre opposite the stage — actually lands on the far edge of the 3-sided
  // perimeter, with 8/10 near its corners either side, matching the plan's description.
  plan: { outer: { width: 140, height: 260 }, inner: { width: 80, height: 150 } },
  approxFloorM: { width: 35, length: 65 },
  levels: [
    {
      id: "floor",
      label: "Floor",
      tier: 0,
      kind: "floor",
      radiusRange: [0.05, 0.2],
      blockNumberRanges: [],
      blockLabelRanges: [
        {
          labels: ["A", "B", "C", "D"],
          positionConfidence: "confirmed",
          note: "A nearest the stage, D furthest — confirmed directly from the plan.",
        },
      ],
    },
    {
      id: "arena-balcony",
      label: "Arena Balcony",
      tier: 1,
      radiusRange: [0.25, 0.95],
      blockNumberRanges: [
        {
          min: 1,
          max: 17,
          positionConfidence: "confirmed",
          note:
            "Wraparound U: 1 at one stage end, 2-7 along that side, 8 near corner, 9 far wall " +
            "(opposite the stage), 10 far corner, 11-16 back along the other side, 17 at the other end.",
        },
      ],
      // Row lettering A-Z skipping I/O is reported at only moderate confidence by the source
      // and isn't corroborated elsewhere — see the venue-level doc comment above. Modeled via
      // `rowSequence` now that the data model supports a per-level custom row order; still only
      // as reliable as that moderate-confidence source, so any row-level depth here should be
      // treated as an approximation. (The Floor level's rows aren't documented at all — left on
      // the generic numeric-row fallback rather than guessed into a sequence.)
      rowSequence: "ABCDEFGHJKLMNPQRSTUVWXYZ".split(""),
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
  seatingPlanSources: [
    { url: AWE_PLAN_IMAGE_URL, label: "Seating plan image" },
    { url: AWE_PLAN_PAGE_URL, label: "Source article (HKTVmall blog, seating plan + traffic)" },
  ],
};

// ---- 2. Hong Kong Coliseum (紅館) ----------------------------------------------------

const COLISEUM_PLAN_URL = "https://www.lcsd.gov.hk/en/hkc/common/form/hkc_center_stage.pdf";

/**
 * Hong Kong Coliseum, modelled here in its four-sided (四面台) centre-stage configuration —
 * the default per the official plan cited below. NOTE: the venue also runs end-stage (三面台
 * or 單面台, with a fifth "Brown" gate) configurations for some shows; those are a different
 * seating layout entirely and are NOT modeled by this config (a per-event override would be
 * needed to represent one).
 *
 * One stand level: aisles ("段") 40-79 wrap clockwise around all four sides, grouped by gate —
 * Red 40-49, Blue 50-59, Green 60-69, Yellow 70-79. The overall ordering/grouping is confirmed
 * by the official plan; the exact corner cut points between groups are only approximate on
 * that same plan, hence the caveat on the range's `note` rather than a separate `positionConfidence`.
 *
 * Floor seating exists but its block/zone layout varies per show (temporary flooring over the
 * arena surface) — modeled as a floor level with no fixed blocks, per the project brief.
 */
export const hongKongColiseum: VenueSeatMapConfig = {
  id: "hong-kong-coliseum",
  name: "香港體育館 (紅館)",
  aliases: ["Hong Kong Coliseum", "香港體育館", "紅館"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "bowl-centre-stage",
  // Near-square bowl — the official plan describes a near-square four-sided hall; a square
  // rect also makes the four 10-aisle gate groups land symmetrically on the four sides.
  plan: { outer: { width: 190, height: 190 }, inner: { width: 90, height: 90 } },
  approxFloorM: { width: 45, length: 45 },
  // 12,500 max (with floor seating added for concerts) / 10,246 fixed seats — both confirmed
  // by the official plan; `total` records the max since that's the field this type supports,
  // the 10,246-fixed distinction is preserved here in this comment rather than invented into a
  // field that doesn't exist for it.
  capacityApprox: { total: 12500, confidence: "confirmed" },
  levels: [
    {
      id: "floor",
      label: "Floor (temporary, varies per show)",
      tier: 0,
      kind: "floor",
      radiusRange: [0, 0.2],
      blockNumberRanges: [],
      // No fixed floor blocks/zones are documented — floor seating (with letter rows) exists
      // but its layout is rebuilt per show. `zones` is used here purely to carry that caveat
      // as a human-readable note, since `LevelConfig` has no other free-text field for a level
      // with no blocks at all.
      zones: ["Configuration varies per show — no fixed floor blocks/zones are documented"],
    },
    {
      id: "stand",
      label: "Stand",
      tier: 1,
      radiusRange: [0.3, 0.95],
      blockNumberRanges: [
        {
          min: 40,
          max: 79,
          positionConfidence: "confirmed",
          note:
            "Aisles run 40-79 clockwise around all four sides, grouped by gate: Red 40-49, Blue 50-59, " +
            "Green 60-69, Yellow 70-79. Group order is confirmed; exact corner cut points are approximate.",
        },
      ],
      // Numeric rows (~1-20, plus an "AA" front row on some aisles) aren't independently
      // corroborated for exact row count — modeled via `rowSequence` (front row "AA" then 1-20)
      // now that the data model supports a documented row order on a stand level directly,
      // rather than misusing `rowBankSplit`'s "lower" bank as a workaround.
      rowSequence: ["AA", ...Array.from({ length: 20 }, (_, i) => String(i + 1))],
    },
  ],
  // Gate-to-aisle-group mapping is confirmed by the official plan; a fifth "Brown" gate exists
  // only for some end-stage configurations (not this default four-sided one).
  gates: [
    { id: "Red", confidence: "confirmed", note: "Serves aisles 40-49." },
    { id: "Blue", confidence: "confirmed", note: "Serves aisles 50-59." },
    { id: "Green", confidence: "confirmed", note: "Serves aisles 60-69." },
    { id: "Yellow", confidence: "confirmed", note: "Serves aisles 70-79." },
    {
      id: "Brown",
      confidence: "unconfirmed",
      note: "Only present in some end-stage (三面台/單面台) configurations, not this default four-sided layout.",
    },
  ],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
  seatingPlanSources: [{ url: COLISEUM_PLAN_URL, label: "Official four-sided (四面台) stage seating plan (LCSD)" }],
};

// ---- 3. Macpherson Stadium (麥花臣場館) -----------------------------------------------

const MACPHERSON_PLAN_URL =
  "https://www.macstadiumhkpa.com/_files/ugd/f8a63f_692ab97cb30f43d4bae6da4fe86e5a5f.pdf";

/**
 * Macpherson Stadium (Mong Kok), in its three-sided (三面台) end-stage concert configuration:
 * sections 3-7 (the stage-side stand) are closed for this config, leaving 8-12 and 1-2 selling.
 * Total capacity of 1352 is confirmed FOR THIS CONFIG ONLY (532 floor + the open stand blocks).
 *
 * Plan proportions: the stage sits on a LONG side (sections 3-7, five sections, face it; 10-12,
 * three sections, are the far long side opposite; 8-9 and 1-2, two each, are the short ends) —
 * a wide, shallower rect than a typical end-stage bowl, chosen so blocks 10-12 land on the far
 * edge of the 3-sided perimeter and 8/9/1/2 land on the near sides, matching the plan.
 */
export const macphersonStadium: VenueSeatMapConfig = {
  id: "macpherson-stadium",
  name: "麥花臣場館",
  aliases: ["Macpherson Stadium", "麥花臣場館", "麥花臣室內場館"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "bowl-end-stage",
  plan: { outer: { width: 190, height: 130 }, inner: { width: 100, height: 60 } },
  approxFloorM: { width: 28, length: 20 },
  capacityApprox: { total: 1352, confidence: "confirmed" },
  levels: [
    {
      id: "floor",
      label: "Floor",
      tier: 0,
      kind: "floor",
      radiusRange: [0, 0.15],
      blockNumberRanges: [],
      blockLabelRanges: [
        { labels: ["Floor"], positionConfidence: "confirmed", note: "532 floor seats, modeled as a single front-to-back block." },
      ],
      // Rows are double letters ONLY (AA nearest the stage, through SS at the back) — no
      // single-letter rows at all, unlike the default A-Z-then-AA-QQ sequence this schema
      // otherwise assumes. Modeled via `rowSequence` (AA->SS in order) now that the data model
      // supports a documented per-level row order directly, spanning the full [0, 1] depth
      // range front-to-back (rather than the compressed [0, 0.4] the old `rowBankSplit`
      // workaround produced as a side effect of misusing its "lower bank" for this).
      rowSequence: [
        "AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ",
        "KK", "LL", "MM", "NN", "OO", "PP", "QQ", "RR", "SS",
      ],
    },
    {
      id: "stands",
      label: "Stands",
      tier: 1,
      radiusRange: [0.25, 0.9],
      blockNumberRanges: [],
      blockLabelRanges: [
        {
          labels: ["8", "9", "10", "11", "12", "1", "2"],
          positionConfidence: "confirmed",
          note:
            "Arc from one stage seam to the other: 8,9 (Red, one long side), 10,11,12 (Yellow, far end), " +
            "1,2 (Blue, other side). Sections 3-7 (stage side) are closed for this end-stage config.",
        },
      ],
      // Stand rows A-H (the "Blue" side, sections 1-2, also has row I) use the default A-Z
      // sequence, which already covers A-I correctly (I is the 9th letter) — no bank split
      // needed.
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
  seatingPlanSources: [{ url: MACPHERSON_PLAN_URL, label: "Official three-sided (三面台) stage seating plan PDF" }],
};

// ---- 4. Xiqu Centre Grand Theatre (西九文化區 戲曲中心 大劇院) ------------------------

const XIQU_GRAND_THEATRE_PLAN_URL = "https://webmedia.westkowloon.hk/documents/xc_gt_seatplan_en_202308_a.pdf";

/**
 * Xiqu Centre Grand Theatre — a `"theatre"` layout (rows facing a proscenium stage; not
 * projected onto the bowl model, see `THEATRE_HEDGE` in geometry.ts). Each level is modeled as
 * a single named block (Stalls/Circle) since the plan describes seat rows within one
 * contiguous seating area per level, plus the two named boxes as a label range of their own.
 * `radiusRange`/`tier` are set to sensible, ordered values per level even though a theatre
 * layout is never actually projected — they still (lightly) affect the depth-fraction proxy
 * via each level's row depth.
 */
export const xiquCentreGrandTheatre: VenueSeatMapConfig = {
  id: "xiqu-centre-grand-theatre",
  name: "西九文化區 戲曲中心 大劇院",
  // Deliberately never a bare "Xiqu Centre" — the Xiqu Centre also has the separate Tea House
  // Theatre; a bare landmark alias risks matching the wrong venue.
  aliases: ["Xiqu Centre Grand Theatre", "西九文化區 戲曲中心 大劇院", "戲曲中心大劇院"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "theatre",
  capacityApprox: { total: 1075, confidence: "confirmed" },
  levels: [
    {
      id: "stalls",
      label: "Stalls / 堂座",
      tier: 0,
      kind: "floor",
      radiusRange: [0, 0.5],
      blockNumberRanges: [],
      blockLabelRanges: [{ labels: ["Stalls"], positionConfidence: "confirmed", note: "749 seats." }],
      // Rows AA, BB, CC (front, premium) then A..W skipping I/O — the DOUBLE letters come
      // FIRST here (opposite of Kai Tak's convention where doubles are further back), so the
      // default A-Z-then-AA-QQ sequence would misplace them. Modeled via `rowBankSplit`: the
      // "lower" bank (AA/BB/CC) sits at the front, the "upper" bank (A..W, skipping I/O) at
      // the back, separated by the walkway the split mechanism assumes.
      rowBankSplit: {
        lowerRows: ["AA", "BB", "CC"],
        upperRows: "ABCDEFGHJKLMNPQRSTUVW".split(""),
        confidence: "confirmed",
      },
    },
    {
      id: "circle",
      label: "Circle / 樓座",
      tier: 1,
      radiusRange: [0.55, 0.85],
      blockNumberRanges: [],
      blockLabelRanges: [{ labels: ["Circle"], positionConfidence: "confirmed", note: "326 seats." }],
      // Rows AA (front) then A..J skipping I — same front-doubles convention as Stalls above.
      rowBankSplit: {
        lowerRows: ["AA"],
        upperRows: "ABCDEFGHJ".split(""),
        confidence: "confirmed",
      },
    },
    {
      id: "boxes",
      label: "Boxes",
      tier: 2,
      radiusRange: [0.87, 0.95],
      blockNumberRanges: [],
      blockLabelRanges: [{ labels: ["Box 1", "Box 2"], positionConfidence: "confirmed" }],
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
  seatingPlanSources: [{ url: XIQU_GRAND_THEATRE_PLAN_URL, label: "Official Xiqu Centre Grand Theatre seat plan" }],
};

// ---- 5. East Kowloon Cultural Centre, The Theatre (東九文化中心 劇場) -----------------

const EKCC_THEATRE_PLAN_URL = "https://www.ekcc.hk/documents/venue_detail/hiring/the-theatre/index/SeatsPlan-T2.pdf";

/**
 * East Kowloon Cultural Centre, The Theatre — a small (536-seat), single-level thrust/horseshoe
 * `"theatre"` layout: rows A-G form the front block facing the stage, rows H, J, K, L are
 * mirrored side wings. WHICH physical side (left/right) each wing row is on is determined, per
 * the source, by the seat NUMBER range within the row — this schema has no seat-number field
 * (only block + row), so that left/right distinction genuinely can't be represented here and is
 * simply not modeled, rather than guessed.
 */
export const ekccTheTheatre: VenueSeatMapConfig = {
  id: "ekcc-the-theatre",
  name: "東九文化中心 劇場",
  // Deliberately never a bare "East Kowloon Cultural Centre" alone — the centre has other
  // ticketed spaces besides The Theatre.
  aliases: ["East Kowloon Cultural Centre The Theatre", "東九文化中心 劇場", "東九文化中心劇場"],
  bowlShape: "rounded-rect",
  orientationConfidence: "unconfirmed",
  layout: "theatre",
  capacityApprox: { total: 536, confidence: "confirmed" },
  levels: [
    {
      id: "seating",
      label: "The Theatre (single level, thrust/horseshoe)",
      tier: 0,
      kind: "floor",
      radiusRange: [0, 0.9],
      blockNumberRanges: [],
      blockLabelRanges: [{ labels: ["Main"], positionConfidence: "confirmed" }],
      // Rows A-G (front block) then H, J, K, L (side wings, I skipped) — the default A-Z
      // sequence already places these in the right front-to-back order with no bank split
      // needed. The wings' left/right mirroring (see doc comment above) isn't represented.
    },
  ],
  gates: [],
  asymmetries: [],
  blockSuffixConfidence: "unconfirmed",
  seatingPlanSources: [{ url: EKCC_THEATRE_PLAN_URL, label: "Official EKCC The Theatre seat plan (T2)" }],
};

// ---- Drafts export ------------------------------------------------------------------

export const VENUE_SEATMAP_DRAFTS: VenueSeatMapDraft[] = [
  { venueName: "亞洲國際博覽館 ARENA", planUrl: AWE_PLAN_IMAGE_URL, config: asiaWorldExpoArena },
  { venueName: "香港體育館 (紅館)", planUrl: COLISEUM_PLAN_URL, config: hongKongColiseum },
  { venueName: "麥花臣場館", planUrl: MACPHERSON_PLAN_URL, config: macphersonStadium },
  { venueName: "西九文化區 戲曲中心 大劇院", planUrl: XIQU_GRAND_THEATRE_PLAN_URL, config: xiquCentreGrandTheatre },
  { venueName: "東九文化中心 劇場", planUrl: EKCC_THEATRE_PLAN_URL, config: ekccTheTheatre },
];

// ---- Venues deliberately NOT drafted -------------------------------------------------

export const NOT_FOUND_VENUES: NotFoundVenue[] = [
  {
    venueName: "啟德體藝館 Kai Tak Arena",
    reason:
      "No official seating plan found. The arena's seating is ~80% retractable, so capacity and layout " +
      "vary per event — only per-event charts exist, not a fixed venue-level plan.",
    tried: ["weekendhk", "hk01", "tickethk", "kaitaksportspark.com.hk (single-page app, no crawlable seat plan)"],
  },
  {
    venueName: "AXA 安盛創夢館",
    reason:
      "A flat multi-purpose hall — each promoter builds its own per-event layout with computer-assigned " +
      "seats. No fixed official seating plan exists to draft from.",
    tried: ["official venue website", "ticketing platform seat charts"],
  },
  {
    venueName: "PORTAL",
    reason: "Standing-only livehouse — general admission floor, no seat map exists.",
    tried: ["official venue/social media pages", "ticketing platform listings"],
  },
  {
    venueName: "TIDES",
    reason: "Standing-only livehouse — general admission floor, no seat map exists.",
    tried: ["official venue/social media pages", "ticketing platform listings"],
  },
  {
    venueName: "MOM Livehouse",
    reason: "Standing-only livehouse — general admission floor, no seat map exists.",
    tried: ["official venue/social media pages", "ticketing platform listings"],
  },
  {
    venueName: "茶豆 Chamame Live House",
    reason: "Standing-only livehouse — general admission floor, no seat map exists.",
    tried: ["official venue/social media pages", "ticketing platform listings"],
  },
  {
    venueName: "亞洲國際博覽館 10號館",
    reason:
      "Exhibition hall with no fixed seating — used for trade shows/flat-floor events. Any seating for a " +
      "specific event is temporary and isn't documented as a venue-level plan.",
    tried: ["AsiaWorld-Expo official hall pages", "ticketing platform seat charts"],
  },
  {
    venueName: "亞洲國際博覽館 10號展館",
    reason:
      "Exhibition hall with no fixed seating — used for trade shows/flat-floor events. Any seating for a " +
      "specific event is temporary and isn't documented as a venue-level plan.",
    tried: ["AsiaWorld-Expo official hall pages", "ticketing platform seat charts"],
  },
  {
    venueName: "亞洲國際博覽館 Runway 11",
    reason:
      "Exhibition hall with no fixed seating — used for trade shows/flat-floor events. Any seating for a " +
      "specific event is temporary and isn't documented as a venue-level plan.",
    tried: ["AsiaWorld-Expo official hall pages", "ticketing platform seat charts"],
  },
  {
    venueName: "亞洲國際博覽館 5號館",
    reason:
      "Exhibition hall with no fixed seating — used for trade shows/flat-floor events. Any seating for a " +
      "specific event is temporary and isn't documented as a venue-level plan.",
    tried: ["AsiaWorld-Expo official hall pages", "ticketing platform seat charts"],
  },
  {
    venueName: "地點待定",
    reason: "Placeholder venue name (location to be determined) — there's no real venue to research yet.",
    tried: [],
  },
];
