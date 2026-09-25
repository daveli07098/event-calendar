import { describe, it, expect } from "vitest";
import { GEMINI_POOL, ModelPool, geminiPool } from "@/lib/ai/models";

describe("GEMINI_POOL", () => {
  it("has unique ids", () => {
    const ids = GEMINI_POOL.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never re-adds a model documented as dead / excluded", () => {
    const excluded = [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-3.1-flash-live-preview",
      "gemini-3.5-live-translate-preview",
      "antigravity-preview-05-2026",
      "antigravity-preview-09-2026",
      "antigravity-preview-latest",
      "gemini-3.1-flash-lite-preview",
      "gemini-2.5-pro",
      "gemini-3.1-pro-preview",
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
      "gemini-pro-latest",
    ];
    const ids = new Set(GEMINI_POOL.map((s) => s.id));
    for (const id of excluded) expect(ids.has(id)).toBe(false);
  });

  it("gives every model positive rpm/rpd", () => {
    for (const spec of GEMINI_POOL) {
      expect(spec.rpm).toBeGreaterThan(0);
      expect(spec.rpd).toBeGreaterThan(0);
    }
  });

  it("never marks a Gemma model as grounding-capable", () => {
    for (const spec of GEMINI_POOL) {
      if (spec.id.startsWith("gemma-")) expect(spec.grounding).toBe(false);
    }
  });

  it("never marks a Gemini 3.x model as grounding-capable (free tier has zero grounding quota)", () => {
    for (const spec of GEMINI_POOL) {
      if (/^gemini-3\./.test(spec.id)) expect(spec.grounding).toBe(false);
    }
  });
});

describe("ModelPool", () => {
  it("cascade() returns every id in pool-declared order", () => {
    expect(new ModelPool(GEMINI_POOL).cascade()).toEqual(GEMINI_POOL.map((s) => s.id));
  });

  it("grounded() only returns grounding:true specs, highest RPM first (stable ties)", () => {
    const expected = GEMINI_POOL.filter((s) => s.grounding)
      .slice()
      .sort((a, b) => b.rpm - a.rpm)
      .map((s) => s.id);
    expect(new ModelPool(GEMINI_POOL).grounded()).toEqual(expected);
    // Grounding is a Gemini-2.5-only capability today — assert the derived
    // list matches the pool's grounding flags rather than hardcoding ids, so
    // this test survives the next roster change without editing by hand.
    for (const id of new ModelPool(GEMINI_POOL).grounded()) {
      expect(geminiPool.spec(id)?.grounding).toBe(true);
    }
  });

  it("lite() only returns lite:true specs, highest RPM first (stable ties)", () => {
    const expected = GEMINI_POOL.filter((s) => s.lite)
      .slice()
      .sort((a, b) => b.rpm - a.rpm)
      .map((s) => s.id);
    expect(new ModelPool(GEMINI_POOL).lite()).toEqual(expected);
  });

  it("keeps cascade-priority order for models tied on RPM", () => {
    // Regression guard for Array#sort stability: build a pool with two
    // grounding-capable specs sharing an RPM value and assert declaration
    // order is preserved rather than swapped.
    const tied = new ModelPool([
      { id: "a", rpm: 5, rpd: 10, grounding: true, lite: false, thinking: false },
      { id: "b", rpm: 5, rpd: 10, grounding: true, lite: false, thinking: false },
    ]);
    expect(tied.grounded()).toEqual(["a", "b"]);
  });

  it("spec()/has() look up by id", () => {
    const first = GEMINI_POOL[0];
    expect(geminiPool.has(first.id)).toBe(true);
    expect(geminiPool.spec(first.id)).toEqual(first);
    expect(geminiPool.has("not-a-real-model")).toBe(false);
    expect(geminiPool.spec("not-a-real-model")).toBeUndefined();
  });
});
