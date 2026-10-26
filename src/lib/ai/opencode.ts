/**
 * OpenCode (Go / Zen) — OpenAI-compatible chat completions, tried FIRST by every
 * text-only AI feature; the Gemini cascade stays as the fallback (see
 * docs/ai-providers.md for the per-feature provider order).
 *
 * Env (read at call time so tests can stub them):
 *   • OPENCODE_API_KEY  — enables the provider; unset/empty = OpenCode skipped.
 *   • OPENCODE_MODELS   — comma list, cascade order (default DEFAULT_MODELS).
 *   • OPENCODE_BASE_URL — default https://opencode.ai/inference/go (Go plan);
 *     https://opencode.ai/inference selects Zen pay-as-you-go.
 *
 * Deliberately self-contained (global fetch, no imports from ./client) so
 * client.ts can import it without a module cycle. Returns raw text — callers
 * parse JSON with parseJsonLoose.
 */
import pkg from "../../../package.json";

const DEFAULT_BASE_URL = "https://opencode.ai/inference/go";
const DEFAULT_MODELS = ["glm-5.3-flash", "minimax-m3.1-flash", "mimo-v2.6-flash"];
// OpenCode's terms ask for a non-generic User-Agent identifying the client.
const USER_AGENT = `event-calendar/${pkg.version}`;
// Stop cascading when less than this is left before the caller's deadline —
// an attempt that short can't produce a useful completion.
const MIN_ATTEMPT_MS = 1_500;

// Models that rejected response_format once — skip sending it to them again
// for the life of this server instance (JSON-mode support is unconfirmed).
const noJsonMode = new Set<string>();

export interface OpenCodeChatOptions {
  prompt: string;
  system?: string;
  /** Request JSON output (response_format json_object; retried without it on a 400 that rejects it). */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Per-model attempt timeout. */
  timeoutMs?: number;
  /** Absolute epoch-ms deadline for the WHOLE cascade (shares a caller's time budget). */
  deadline?: number;
  /** Feature name → stable `x-opencode-session: event-calendar:<feature>`. */
  feature: string;
  /** Override the model cascade (defaults to openCodeModels()). */
  models?: string[];
}

export interface OpenCodeChatResult {
  /** Completion text with <think> blocks and code fences stripped. */
  text: string;
  model: string;
  tokens: number | null;
  /** Provider label for aiUsed/provider fields: `opencode:<model>`. */
  provider: string;
}

/** True when OPENCODE_API_KEY is set to a non-empty value. */
export function hasOpenCode(): boolean {
  return !!process.env.OPENCODE_API_KEY?.trim();
}

/** Model cascade from OPENCODE_MODELS (comma list), falling back to the defaults. */
export function openCodeModels(): string[] {
  const fromEnv = (process.env.OPENCODE_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_MODELS];
}

function chatEndpoint(): string {
  const base = (process.env.OPENCODE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}/openai/v1/chat/completions`;
}

/** Strip reasoning blocks (closed or dangling) and markdown code fences. */
export function cleanCompletion(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "") // unterminated reasoning (truncated) — nothing usable after it
    .replace(/```(?:json)?\s*\n?|```/gi, "")
    .trim();
}

type Attempt =
  | { ok: true; text: string; tokens: number | null }
  | { ok: false; status: number | null; detail: string };

async function attempt(
  model: string,
  opts: OpenCodeChatOptions,
  key: string,
  withJsonMode: boolean,
  timeoutMs: number
): Promise<Attempt> {
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: opts.prompt },
  ];
  try {
    const res = await fetch(chatEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "x-opencode-session": `event-calendar:${opts.feature}`,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0,
        ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, status: res.status, detail };
    }
    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage as { total_tokens?: number } | undefined;
    return { ok: true, text: cleanCompletion(raw), tokens: usage?.total_tokens ?? null };
  } catch (e) {
    return { ok: false, status: null, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run one chat prompt through the OpenCode model cascade. Any failure (429 /
 * 402 / 403 spend caps, 5xx, timeouts, other 4xx, empty output) moves on to
 * the next model; a 401 (bad/missing credential) stops at once since every
 * model would fail the same way. Returns null when OpenCode is unconfigured
 * or every model failed — callers then fall back to Gemini.
 */
export async function openCodeChat(opts: OpenCodeChatOptions): Promise<OpenCodeChatResult | null> {
  const key = process.env.OPENCODE_API_KEY?.trim();
  if (!key) return null;
  const perAttemptMs = opts.timeoutMs ?? 20_000;

  for (const model of opts.models ?? openCodeModels()) {
    let jsonMode = !!opts.json && !noJsonMode.has(model);
    for (let tries = 0; tries < 2; tries++) {
      const remaining = opts.deadline ? opts.deadline - Date.now() : perAttemptMs;
      if (remaining < MIN_ATTEMPT_MS) {
        console.warn(`[opencode] ${opts.feature}: time budget exhausted before ${model}`);
        return null;
      }
      const r = await attempt(model, opts, key, jsonMode, Math.min(perAttemptMs, remaining));
      if (r.ok) {
        // In JSON mode an answer with no object at all is as useless as an empty one.
        if (r.text && (!opts.json || r.text.includes("{"))) {
          return { text: r.text, model, tokens: r.tokens, provider: `opencode:${model}` };
        }
        console.warn(`[opencode] ${opts.feature}: ${model} returned no usable content`);
        break; // next model
      }
      const detail = r.detail.replace(/\s+/g, " ").slice(0, 200);
      // JSON mode unsupported by this model → retry the same model once without it.
      if (r.status === 400 && jsonMode && /response_format|json_object/i.test(r.detail)) {
        noJsonMode.add(model);
        jsonMode = false;
        console.warn(`[opencode] ${opts.feature}: ${model} rejected response_format — retrying without it`);
        continue;
      }
      console.warn(`[opencode] ${opts.feature}: ${model} failed (${r.status ?? "network"}): ${detail}`);
      if (r.status === 401) return null; // credential problem — every model would fail
      break; // next model
    }
  }
  return null;
}

/** Test hook: forget which models rejected response_format. */
export function resetOpenCodeStateForTests(): void {
  noJsonMode.clear();
}
