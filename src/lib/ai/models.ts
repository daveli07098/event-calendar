/**
 * Single source of truth for the shared Gemini free-tier model pool.
 *
 * Every AI feature (ticket scraping, discount scanning, event classification,
 * World Cup score grounding) used to hard-code its own near-identical model
 * array. They drifted — one kept a model whose free tier went to limit 0, one
 * lacked the newest flash, the grounded list omitted Gemma-incompatible flags.
 *
 * Now all of them derive their list from this one pool via `geminiPool`, so the
 * roster + quota knowledge lives in exactly one place.
 *
 * All models share GEMINI_API_KEY. Free-tier RPM is from Google AI Studio rate
 * limits (2026-05) and is approximate — used only to order fallbacks so a
 * low-quota model that 429s falls through to a higher-quota one.
 */

/** Capability / quota metadata for one Gemini free-tier model. */
export interface GeminiModelSpec {
  id: string;
  /** Approx free-tier requests/min. Higher = more resilient to 429 storms. */
  rpm: number;
  /**
   * Approx free-tier requests/DAY (AI Studio dashboard, 2026-07). This is the
   * quota we actually exhaust in practice: calls are small (~3k tokens) and
   * spread out, so RPM/TPM never spike — but 20-ish daily requests on the
   * flagship flash models run out fast. Tracked in AiModelUsage (see
   * src/lib/ai/model-quota.ts) so the cascade can start from a model with
   * remaining daily quota instead of burning a 429 on an exhausted one.
   */
  rpd: number;
  /** Supports the google_search grounding tool (Gemma models do NOT). */
  grounding: boolean;
  /** Lightweight/cheap variant — preferred for high-volume, low-stakes tasks. */
  lite: boolean;
  /**
   * Thinking model family (accepts `thinkingConfig`). Thinking burns hidden
   * reasoning tokens out of maxOutputTokens — a 2048 cap can leave ~70 tokens
   * for the actual JSON (finishReason MAX_TOKENS), truncating extractions.
   * Deterministic JSON extraction disables it via thinkingBudget: 0.
   */
  thinking: boolean;
}

/**
 * The pool, in hand-tuned cascade priority (strongest / most-available first).
 *
 * Deliberately excludes `gemini-2.0-flash`: its free tier is now limit 0, so it
 * always 429s — a dead hop that only slows every cascade down.
 *
 * Also deliberately excludes models whose idle free-tier quota looks tempting
 * on the AI Studio dashboard but that CANNOT serve this cascade (verified by
 * live calls, 2026-07-20). Do not re-add:
 *   • gemini-3.1-flash-live-preview / gemini-3.5-live-translate-preview — only
 *     support bidiGenerateContent (realtime WebSocket Live API); HTTP
 *     generateContent rejects them.
 *   • antigravity-preview-05-2026 — ListModels advertises generateContent, but
 *     real calls 400 with "This model only supports Interactions API" (and
 *     "JSON mode is not enabled") — it's the Antigravity agent quota bucket.
 */
export const GEMINI_POOL: readonly GeminiModelSpec[] = [
  { id: "gemini-3.5-flash",           rpm: 5,  rpd: 20,    grounding: true,  lite: false, thinking: true  },
  { id: "gemini-3.1-flash-lite",      rpm: 15, rpd: 50,    grounding: true,  lite: true,  thinking: true  },
  { id: "gemini-2.5-flash",           rpm: 5,  rpd: 20,    grounding: true,  lite: false, thinking: true  },
  { id: "gemini-2.5-flash-lite",      rpm: 10, rpd: 20,    grounding: true,  lite: true,  thinking: true  },
  { id: "gemma-4-31b-it",             rpm: 15, rpd: 14400, grounding: false, lite: false, thinking: false },
  // NOTE: "gemma-4-26b-it" does not exist — ListModels says the real id is
  // gemma-4-26b-a4b-it; the old id 404'd on every call (dead cascade hop).
  { id: "gemma-4-26b-a4b-it",         rpm: 15, rpd: 14400, grounding: false, lite: false, thinking: false },
];

/**
 * Helper around a Gemini model pool: one place to derive the ordered model
 * lists each feature needs, instead of copy-pasting hardcoded arrays.
 *
 * Selections that fall back on 429 are ordered highest-quota-first so a busy
 * low-RPM model hands off to a high-RPM one rather than failing the whole call.
 */
export class ModelPool {
  constructor(private readonly specs: readonly GeminiModelSpec[]) {}

  /** Full cascade in priority order — general JSON extraction / scraping. */
  cascade(): string[] {
    return this.specs.map((s) => s.id);
  }

  /** Grounding-capable models, highest free-tier quota first (live-fact lookups). */
  grounded(): string[] {
    return this.byQuota((s) => s.grounding);
  }

  /** Lightweight models, highest quota first — cheap, high-volume tasks. */
  lite(): string[] {
    return this.byQuota((s) => s.lite);
  }

  /** Metadata for a model id, if it belongs to the pool. */
  spec(id: string): GeminiModelSpec | undefined {
    return this.specs.find((s) => s.id === id);
  }

  /** True when the pool contains this model id. */
  has(id: string): boolean {
    return this.specs.some((s) => s.id === id);
  }

  // Filtered, then sorted by descending RPM. Array#sort is stable, so models on
  // equal quota keep their cascade-priority order.
  private byQuota(pred: (s: GeminiModelSpec) => boolean): string[] {
    return this.specs
      .filter(pred)
      .slice()
      .sort((a, b) => b.rpm - a.rpm)
      .map((s) => s.id);
  }
}

/** The shared pool instance every feature should use. */
export const geminiPool = new ModelPool(GEMINI_POOL);
