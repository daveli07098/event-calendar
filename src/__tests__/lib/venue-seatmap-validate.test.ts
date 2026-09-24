import { describe, it, expect } from "vitest";
import { validateSeatMapConfig } from "@/lib/venue-seatmap/validate";
import { kaiTakStadium } from "@/lib/venue-seatmap/venues/kai-tak";

describe("validateSeatMapConfig", () => {
  it("accepts the real Kai Tak config unchanged", () => {
    const result = validateSeatMapConfig(kaiTakStadium);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual(kaiTakStadium);
    }
  });

  it("strips unknown top-level keys", () => {
    const result = validateSeatMapConfig({ ...kaiTakStadium, extraJunk: "nope" } as unknown);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).not.toHaveProperty("extraJunk");
    }
  });

  it("strips unknown keys nested inside a level", () => {
    const withJunk = {
      ...kaiTakStadium,
      levels: kaiTakStadium.levels.map((l, i) => (i === 0 ? { ...l, bogus: 123 } : l)),
    };
    const result = validateSeatMapConfig(withJunk as unknown);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.levels[0]).not.toHaveProperty("bogus");
    }
  });

  it("rejects a non-object input", () => {
    expect(validateSeatMapConfig(null).ok).toBe(false);
    expect(validateSeatMapConfig("a string").ok).toBe(false);
    expect(validateSeatMapConfig([1, 2, 3]).ok).toBe(false);
    expect(validateSeatMapConfig(undefined).ok).toBe(false);
  });

  it("rejects missing required top-level fields with specific error messages", () => {
    const { id, ...withoutId } = kaiTakStadium;
    void id;
    const result = validateSeatMapConfig(withoutId as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("id"))).toBe(true);
    }
  });

  it("rejects a wrong bowlShape literal", () => {
    const result = validateSeatMapConfig({ ...kaiTakStadium, bowlShape: "oval" } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("bowlShape"))).toBe(true);
    }
  });

  it("rejects levels: [] (must be non-empty)", () => {
    const result = validateSeatMapConfig({ ...kaiTakStadium, levels: [] } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("levels"))).toBe(true);
    }
  });

  it("rejects more than 40 levels", () => {
    const oneLevel = kaiTakStadium.levels[0];
    const levels = Array.from({ length: 41 }, (_, i) => ({ ...oneLevel, id: `level-${i}` }));
    const result = validateSeatMapConfig({ ...kaiTakStadium, levels } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("levels"))).toBe(true);
    }
  });

  it("rejects a radiusRange outside 0..1", () => {
    const levels = kaiTakStadium.levels.map((l, i) => (i === 0 ? { ...l, radiusRange: [-0.1, 0.5] as [number, number] } : l));
    const result = validateSeatMapConfig({ ...kaiTakStadium, levels } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("radiusRange"))).toBe(true);
    }
  });

  it("rejects a radiusRange where inner > outer", () => {
    const levels = kaiTakStadium.levels.map((l, i) => (i === 0 ? { ...l, radiusRange: [0.8, 0.2] as [number, number] } : l));
    const result = validateSeatMapConfig({ ...kaiTakStadium, levels } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("radiusRange"))).toBe(true);
    }
  });

  it("rejects a blockNumberRange where min > max", () => {
    const levels = kaiTakStadium.levels.map((l, i) =>
      i === 0 ? { ...l, blockNumberRanges: [{ min: 300, max: 100, positionConfidence: "confirmed" as const }] } : l
    );
    const result = validateSeatMapConfig({ ...kaiTakStadium, levels } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("min") && e.includes("max"))).toBe(true);
    }
  });

  it("rejects an invalid Confidence value", () => {
    const result = validateSeatMapConfig({ ...kaiTakStadium, orientationConfidence: "very sure" } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("orientationConfidence"))).toBe(true);
    }
  });

  it("rejects an invalid BowlSide on a gate", () => {
    const gates = [{ ...kaiTakStadium.gates[0], side: "north" }];
    const result = validateSeatMapConfig({ ...kaiTakStadium, gates } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("gates[0].side"))).toBe(true);
    }
  });

  it("rejects an invalid layout value", () => {
    const result = validateSeatMapConfig({ ...kaiTakStadium, layout: "circus-tent" } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("layout"))).toBe(true);
    }
  });

  it("accepts a valid layout + plan + approxFloorM + seatingPlanSources", () => {
    const result = validateSeatMapConfig({
      ...kaiTakStadium,
      layout: "bowl-centre-stage",
      plan: { outer: { width: 100, height: 80 }, inner: { width: 60, height: 40 } },
      approxFloorM: { width: 68, length: 105 },
      seatingPlanSources: [{ url: "https://example.com/plan.pdf", label: "Official plan" }],
    } as unknown);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-empty string that exceeds the 200-char cap", () => {
    const longNote = "x".repeat(201);
    const gates = [{ ...kaiTakStadium.gates[0], note: longNote }];
    const result = validateSeatMapConfig({ ...kaiTakStadium, gates } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("gates[0].note"))).toBe(true);
    }
  });

  it("accepts a string right at the 200-char cap", () => {
    const noteAt200 = "x".repeat(200);
    const gates = [{ ...kaiTakStadium.gates[0], note: noteAt200 }];
    const result = validateSeatMapConfig({ ...kaiTakStadium, gates } as unknown);
    expect(result.ok).toBe(true);
  });

  it("rejects an empty string for a required field", () => {
    const result = validateSeatMapConfig({ ...kaiTakStadium, name: "   " } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("rejects more than 500 total label-like strings spread across multiple fields", () => {
    // Each individual array stays under the per-array cap (200) so only the shared
    // 500-label budget (summed across all three levels' zones) is what trips here.
    const bigZones = Array.from({ length: 180 }, (_, i) => `Zone ${i}`);
    const levels = kaiTakStadium.levels.map((l) => ({ ...l, zones: bigZones }));
    const result = validateSeatMapConfig({ ...kaiTakStadium, levels } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.toLowerCase().includes("label"))).toBe(true);
    }
  });

  it("rejects a blockLabelRanges entry with an empty labels array", () => {
    const levels = kaiTakStadium.levels.map((l, i) =>
      i === 0 ? { ...l, blockLabelRanges: [{ labels: [], positionConfidence: "confirmed" as const }] } : l
    );
    const result = validateSeatMapConfig({ ...kaiTakStadium, levels } as unknown);
    expect(result.ok).toBe(false);
  });

  it("collects multiple independent errors in one pass, not just the first", () => {
    const result = validateSeatMapConfig({
      ...kaiTakStadium,
      bowlShape: "oval",
      orientationConfidence: "nope",
      levels: [],
    } as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("rejects gates that isn't an array", () => {
    const result = validateSeatMapConfig({ ...kaiTakStadium, gates: "not-an-array" } as unknown);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-boolean wrap.confirmed", () => {
    const levels = kaiTakStadium.levels.map((l, i) =>
      i === 1 ? { ...l, wrap: { confirmed: "yes", note: "n" } } : l
    );
    const result = validateSeatMapConfig({ ...kaiTakStadium, levels } as unknown);
    expect(result.ok).toBe(false);
  });
});
