import { describe, it, expect } from "vitest";
import { parseSeat } from "@/lib/seat-parse";
import { resolveSeatGeometry } from "@/lib/venue-seatmap/geometry";
import { matchVenueConfig } from "@/lib/venue-seatmap/registry";
import { defaultRowDepthFraction } from "@/lib/venue-seatmap/rows";
import { kaiTakStadium } from "@/lib/venue-seatmap/venues/kai-tak";

function fieldsFor(raw: string) {
  const result = parseSeat(raw);
  if (result.status === "unparseable") throw new Error(`expected ${raw} to parse`);
  return result.fields;
}

describe("venue-seatmap geometry", () => {
  it("resolves block 225 (Level 2) to a position", () => {
    const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 2 Block 225 Row M Seat 1"));
    expect(geometry).not.toBeNull();
    expect(geometry?.levelId).toBe("level-2");
    expect(geometry?.blockNumeric).toBe(225);
    expect(geometry?.angleFraction).not.toBeNull();
  });

  it("resolves block 519B (Level 5) to a position, with the suffix preserved", () => {
    const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 5 Block 519B Row M Seat 1"));
    expect(geometry).not.toBeNull();
    expect(geometry?.levelId).toBe("level-5");
    expect(geometry?.blockNumeric).toBe(519);
    expect(geometry?.blockSuffix).toBe("B");
    expect(geometry?.block).toBe("519B");
  });

  it("places 519B in the documented best-facing range while 225 is side-on", () => {
    const geom225 = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 2 Block 225 Row M Seat 1"));
    const geom519b = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 5 Block 519B Row M Seat 1"));

    expect(geom519b?.isDocumentedBestFacing).toBe(true);
    expect(geom519b?.viewingAngle).toBe("front-on");

    expect(geom225?.viewingAngle).toBe("side-on");
    expect(geom225?.isDocumentedBestFacing).toBe(false);
  });

  it("places row BB further back than row M on Level 5, given the bank break", () => {
    const rowM = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 5 Block 519 Row M Seat 1"));
    const rowBB = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 5 Block 519 Row BB Seat 1"));

    expect(rowM?.rowDepthFraction).not.toBeNull();
    expect(rowBB?.rowDepthFraction).not.toBeNull();
    expect(rowBB!.rowDepthFraction!).toBeGreaterThan(rowM!.rowDepthFraction!);
    // BB is only the 2nd upper-bank row, yet must still land behind every lower-bank row —
    // the walkway break, not index order alone, is what puts it further back.
    expect(rowBB!.depthFraction).toBeGreaterThan(rowM!.depthFraction);
  });

  it("orders row AA after row Z on a level with no documented bank split (Level 2)", () => {
    const rowZ = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 2 Block 225 Row Z Seat 1"));
    const rowAA = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 2 Block 225 Row AA Seat 1"));

    expect(rowZ?.rowDepthFraction).not.toBeNull();
    expect(rowAA?.rowDepthFraction).not.toBeNull();
    expect(rowAA!.rowDepthFraction!).toBeGreaterThan(rowZ!.rowDepthFraction!);
  });

  it("also orders AA after Z via the shared row-depth utility directly", () => {
    expect(defaultRowDepthFraction("AA")!).toBeGreaterThan(defaultRowDepthFraction("Z")!);
  });

  it("maps a 1xx block to Level 2, without guessing its arc position", () => {
    const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 2 Block 105 Row A Seat 1"));
    expect(geometry).not.toBeNull();
    expect(geometry?.levelId).toBe("level-2");
    // The 101-110 sub-section's position relative to 201-240 is documented as unconfirmed —
    // no angle/viewing-angle should be fabricated for it.
    expect(geometry?.angleFraction).toBeNull();
    expect(geometry?.viewingAngle).toBeNull();
    expect(geometry?.confidence.blockPosition).toBe("unconfirmed");
  });

  it("yields no geometry for an unknown venue", () => {
    const geometry = resolveSeatGeometry(null, fieldsFor("Level 2 Block 225 Row M Seat 1"));
    expect(geometry).toBeNull();
  });

  it("yields no geometry for an unknown block, rather than a guessed centre", () => {
    const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 2 Block 999 Row M Seat 1"));
    expect(geometry).toBeNull();
  });

  it("yields no geometry when there is no block at all (e.g. an area-only seat)", () => {
    const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor("Standing"));
    expect(geometry).toBeNull();
  });

  it("suppresses documented stage-facing annotations for a non-default stage position", () => {
    const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 5 Block 519B Row M Seat 1"), {
      stagePosition: "four-sided",
    });
    expect(geometry).not.toBeNull();
    expect(geometry?.viewingAngle).toBeNull();
    expect(geometry?.isDocumentedBestFacing).toBe(false);
    expect(geometry?.isDefaultStageLayout).toBe(false);
    // Position/tier facts remain — only stage-relative annotations are suppressed.
    expect(geometry?.angleFraction).not.toBeNull();
  });

  it("produces no viewing angle when there is no stage at all", () => {
    const geometry = resolveSeatGeometry(kaiTakStadium, fieldsFor("Level 5 Block 519B Row M Seat 1"), {
      stagePosition: "none",
    });
    expect(geometry?.viewingAngle).toBeNull();
  });
});

describe("venue-seatmap registry matching", () => {
  it("matches a full Kai Tak Stadium alias", () => {
    expect(matchVenueConfig("Kai Tak Stadium")?.id).toBe("kai-tak-stadium");
    expect(matchVenueConfig("Kai Tak Sports Park, Kowloon")?.id).toBe("kai-tak-stadium");
  });

  it("does not match a bare landmark name that could refer to a different venue", () => {
    // Kai Tak Cruise Terminal is a real, separate Hong Kong venue that shares the "Kai Tak"
    // landmark name — matching on the bare name would render a confidently wrong map for it.
    expect(matchVenueConfig("Kai Tak Cruise Terminal")).toBeNull();
    expect(matchVenueConfig("Kai Tak")).toBeNull();
  });

  it("returns null for an unrelated venue name", () => {
    expect(matchVenueConfig("Hong Kong Coliseum")).toBeNull();
    expect(matchVenueConfig(null)).toBeNull();
    expect(matchVenueConfig(undefined)).toBeNull();
  });
});
