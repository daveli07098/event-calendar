/**
 * Shared AI extraction client — single home for the multi-provider cascade
 * (Gemini model family → Groq → GitHub Copilot) used by AI-powered features
 * (ticket scraping, discount scanning, …).
 *
 * All callers share GEMINI_API_KEY / GROQ_API_KEY / GITHUB_TOKEN env vars and
 * the per-user daily quota in src/lib/ai/quota.ts.
 *
 * Routing around regional blocks (e.g. Gemini geo-blocks Hong Kong with
 * HTTP 400 "User location is not supported"):
 *   • GEMINI_BASE_URL — point Gemini calls at a reverse proxy you run in a
 *     supported region (e.g. a Cloudflare Worker that forwards to
 *     generativelanguage.googleapis.com). Dependency-free, most reliable.
 *   • AI_PROXY_URL — route ALL provider calls through a forward http(s) proxy
 *     in a supported region. Falls back to HTTPS_PROXY / ALL_PROXY if set.
 */
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { geminiPool } from "./models";
import {
  availableCascade,
  isDailyQuotaError,
  markModelExhausted,
  recordModelCall,
} from "./model-quota";

/** Result of a JSON-mode AI call: parsed object plus usage metadata. */
export interface AiJsonResult {
  data: Record<string, unknown>;
  provider: string;
  tokensUsed: number | null;
}

// Gemini API base — override with GEMINI_BASE_URL to use a reverse proxy.
const GEMINI_BASE_URL = (
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
).replace(/\/+$/, "");

// Optional forward proxy for outbound AI provider calls. Resolved once.
let dispatcherResolved = false;
let aiProxyDispatcher: Dispatcher | undefined;
function getAiDispatcher(): Dispatcher | undefined {
  if (!dispatcherResolved) {
    dispatcherResolved = true;
    const url = (
      process.env.AI_PROXY_URL ||
      process.env.HTTPS_PROXY ||
      process.env.ALL_PROXY ||
      ""
    ).trim();
    if (url) {
      try {
        aiProxyDispatcher = new ProxyAgent(url);
        // Mask any credentials in the logged URL.
        console.log(`[ai] routing provider calls via proxy: ${url.replace(/\/\/[^@/]*@/, "//***@")}`);
      } catch (e) {
        console.error(`[ai] invalid AI_PROXY_URL: ${(e as Error).message}`);
      }
    }
  }
  return aiProxyDispatcher;
}

/**
 * fetch that routes through the configured AI proxy when one is set.
 *
 * When proxying we must use undici's OWN fetch (not Node's global fetch): a
 * dispatcher created by the standalone `undici` package is incompatible with
 * Node's built-in undici and throws "invalid onRequestStart method". With no
 * proxy we use the global fetch as usual.
 */
async function aiFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getAiDispatcher();
  if (!dispatcher) return fetch(url, init);
  return undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher,
  }) as unknown as Response;
}

// Model lists are derived from the single shared pool (src/lib/ai/models.ts) so
// the roster + quota knowledge lives in exactly one place. See ModelPool.
//   • GEMINI_MODELS  — full cascade, priority order (general JSON extraction).
//   • GROUNDED_MODELS — grounding-capable only, highest free-tier quota first
//     (Gemma excluded — it can't use the google_search tool).
// These are the STATIC rosters; cascade loops should prefer the RPD-aware
// availableCascade()/availableGrounded()/availableLite() from ./model-quota,
// which skip models whose free-tier daily quota is already spent.
export const GEMINI_MODELS = geminiPool.cascade();
export const GROUNDED_MODELS = geminiPool.grounded();

/** True when at least one AI provider is configured via env. */
export function hasAiProvider(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GITHUB_TOKEN || process.env.GROQ_API_KEY);
}

/**
 * Extract ALL top-level BALANCED {…} blocks from a string, tracking brace
 * depth while skipping string literals. Handles trailing junk after an object
 * (e.g. a stray extra "}" the model appends — seen from gemini-3.5-flash in
 * JSON mode) and preambles before it ("Here is the JSON: {…}").
 * Returns [] when no balanced object exists (e.g. truncated output).
 */
function extractBalancedJsonBlocks(s: string): string[] {
  const blocks: string[] = [];
  let i = 0;
  while ((i = s.indexOf("{", i)) !== -1) {
    const start = i;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (ch === "\\") i++; // skip escaped char
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break; // never closed — truncated tail
    blocks.push(s.slice(start, end + 1));
    i = end + 1;
  }
  return blocks;
}

/**
 * Lenient JSON parsing for LLM output: strips code fences and attempts to
 * salvage truncated responses by closing open braces.
 */
export function parseJsonLoose(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to recovery strategies below.
  }
  // Preamble or trailing junk around the object — parse balanced {…} blocks,
  // LAST first: reasoning-leak models (gemma-4-26b-a4b-it) echo the prompt's
  // schema as the FIRST block and emit the real answer at the end, so first-
  // block-wins would return the schema echo as data. (lastIndexOf("}") is NOT
  // safe either: a stray extra "}" after the object would be included and the
  // whole result silently dropped.)
  const blocks = extractBalancedJsonBlocks(cleaned);
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(blocks[i]);
    } catch {
      // Unparseable block (e.g. a pseudo-JSON schema echo) — try the previous.
    }
  }
  // Truncated response — drop a dangling partial member (`,"key":` or
  // `,"key":"unterminated…`), then close whatever string/braces remain open.
  // The old single `+ "}"` couldn't repair nested objects or mid-pair cuts.
  const start = cleaned.indexOf("{");
  if (start === -1) return {};
  const trimmed = cleaned
    .slice(start)
    .replace(/,\s*"(?:[^"\\]|\\.)*"?\s*(?::\s*(?:"(?:[^"\\]|\\.)*)?)?$/, "")
    .replace(/,\s*$/, "");
  // Track the open {/[ nesting so each level is closed with its own bracket
  // (a truncated saleDates array needs `}]}`, not `}}}`).
  const closers: string[] = [];
  let inString = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if (ch === "}" || ch === "]") closers.pop();
  }
  const salvaged = trimmed + (inString ? '"' : "") + closers.reverse().join("");
  try {
    return JSON.parse(salvaged);
  } catch {
    return {};
  }
}

/** Transient/provider-level failures that should fall through to the next provider. */
export function isTransientAiError(msg: string): boolean {
  return (
    msg.includes("400") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("404") ||
    msg.toLowerCase().includes("fetch failed") ||
    msg.toLowerCase().includes("socket") ||
    msg.toLowerCase().includes("econnrefused") ||
    msg.toLowerCase().includes("etimedout") ||
    msg.toLowerCase().includes("network")
  );
}

export async function callGeminiJson(
  prompt: string,
  model: string
): Promise<AiJsonResult> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const endpoint = `${GEMINI_BASE_URL}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    // temperature 0 → deterministic extraction. Without it Gemini defaults to a
    // high temperature and gives inconsistent results (e.g. a clear sale page
    // flipping between hasDiscount true/false across identical calls).
    // Thinking models burn hidden reasoning tokens out of maxOutputTokens — at
    // 2048 that left ~70 tokens of actual JSON (finishReason MAX_TOKENS) and the
    // salvaged fragment lost saleDates/venueRuns entirely. Disable thinking for
    // extraction and raise the cap so long window/run lists fit.
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 0,
      ...(geminiPool.spec(model)?.thinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000)); // wait before retry
    res = await aiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok || res.status !== 503) break; // success or non-retryable error
  }

  if (!res || !res.ok) {
    // Include the API's own message (e.g. "User location is not supported")
    // so cascade failures are diagnosable, not just status codes.
    let detail = "";
    try {
      const body = await res?.json();
      if (body?.error?.message) detail = ` — ${body.error.message}`;
    } catch {
      // Non-JSON error body — status code alone will have to do
    }
    // A per-DAY 429 means the model is dead until Pacific midnight — record it
    // so availableCascade() stops offering this model today.
    if (res?.status === 429 && isDailyQuotaError(detail)) await markModelExhausted(model);
    throw new Error(`Gemini API error: ${res?.status ?? "unknown"}${detail}`);
  }
  await recordModelCall(model); // count toward today's RPD budget
  const data = await res.json();
  const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const usage = data.usageMetadata as { totalTokenCount?: number } | undefined;
  return {
    data: parseJsonLoose(raw),
    provider: model,
    tokensUsed: usage?.totalTokenCount ?? null,
  };
}

/**
 * Gemini call WITH Google Search grounding — for prompts that need live, real
 * world facts the model can't know from training (e.g. current match scores).
 *
 * Differs from callGeminiJson:
 *   • adds `tools: [{ google_search: {} }]` so the model searches the web;
 *   • omits responseMimeType — forcing application/json is incompatible with the
 *     grounding tool, so we instruct JSON in the prompt and parse it loosely.
 * Reuses the same key, proxy/geo-bypass plumbing (aiFetch + GEMINI_BASE_URL) and
 * lenient parser as the rest of the cascade.
 */
export async function callGeminiGrounded(
  prompt: string,
  model: string,
  maxOutputTokens = 8192
): Promise<AiJsonResult> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const endpoint = `${GEMINI_BASE_URL}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens, temperature: 0 },
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    res = await aiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // Grounded calls can be slow; cap them so a hung request fails fast
      // instead of blocking the route for minutes.
      signal: AbortSignal.timeout(45_000),
    });
    if (res.ok || res.status !== 503) break;
  }

  if (!res || !res.ok) {
    let detail = "";
    try {
      const errBody = await res?.json();
      if (errBody?.error?.message) detail = ` — ${errBody.error.message}`;
    } catch {
      // Non-JSON error body — status code alone will have to do
    }
    if (res?.status === 429 && isDailyQuotaError(detail)) await markModelExhausted(model);
    throw new Error(`Gemini API error: ${res?.status ?? "unknown"}${detail}`);
  }
  await recordModelCall(model); // count toward today's RPD budget
  const data = await res.json();
  // Grounded answers can span multiple parts — concatenate the text parts.
  const parts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
  const raw = parts.map((p) => p.text ?? "").join("") || "{}";
  // Log a snippet so empty/odd grounded responses are diagnosable in server logs.
  console.log(`[ai] grounded(${model}) raw head: ${raw.slice(0, 400).replace(/\s+/g, " ")}`);
  const usage = data.usageMetadata as { totalTokenCount?: number } | undefined;
  return {
    data: parseJsonLoose(raw),
    provider: model,
    tokensUsed: usage?.totalTokenCount ?? null,
  };
}

export async function callOpenAICompatibleJson(
  prompt: string,
  endpoint: string,
  token: string,
  model: string,
  providerName: string,
  extraHeaders: Record<string, string> = {}
): Promise<AiJsonResult> {
  const res = await aiFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      // 4096: typical extraction JSON is ~600 tokens, but events with many
      // saleDates/venueRuns overflowed the old 2048 cap and got truncated.
      max_tokens: 4096,
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(`AI API error: ${res.status}`);
  const data = await res.json();
  const raw: string = data.choices?.[0]?.message?.content ?? "{}";
  const usage = data.usage as { total_tokens?: number } | undefined;
  return {
    data: parseJsonLoose(raw),
    provider: providerName,
    tokensUsed: usage?.total_tokens ?? null,
  };
}

/**
 * Exchange a GitHub OAuth token (gho_) for a short-lived Copilot API token.
 * The gho_ token alone is NOT accepted by api.githubcopilot.com.
 */
export async function getCopilotToken(githubToken: string): Promise<string> {
  const res = await aiFetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `token ${githubToken}`,
      "User-Agent": "GitHubCopilotChat/0.22.4",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Copilot token exchange failed: ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error("No token in Copilot token response");
  return data.token as string;
}

export async function callCopilotJson(prompt: string, githubToken: string): Promise<AiJsonResult> {
  const copilotToken = await getCopilotToken(githubToken);
  return callOpenAICompatibleJson(
    prompt,
    "https://api.githubcopilot.com/chat/completions",
    copilotToken,
    "gpt-4o",
    "github-copilot",
    {
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot-chat/0.22.4",
    }
  );
}

/**
 * Run a JSON-extraction prompt through the full provider cascade.
 * Tries each Gemini model in priority order, then Groq, then Copilot;
 * transient errors (quota, model unavailable, network) fall through to the
 * next provider. Throws the last error if every provider fails.
 */
export async function aiExtractJson(prompt: string): Promise<AiJsonResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  const providers: Array<() => Promise<AiJsonResult>> = [];
  if (geminiKey) {
    // RPD-aware ordering: models with remaining daily quota first, exhausted
    // ones skipped — no doomed 429 hop at the head of every cascade.
    for (const model of await availableCascade()) {
      providers.push(() => callGeminiJson(prompt, model));
    }
  }
  if (groqKey) {
    // llama-3.3-70b-versatile: current Groq production model with a 128k
    // context. The old llama3-8b-8192 is decommissioned AND its 8k total
    // context couldn't even fit a CJK-heavy 8000-char page (~10k tokens).
    providers.push(() =>
      callOpenAICompatibleJson(
        prompt,
        "https://api.groq.com/openai/v1/chat/completions",
        groqKey,
        "llama-3.3-70b-versatile",
        "groq-llama-3.3-70b"
      )
    );
  }
  if (githubToken) {
    providers.push(() => callCopilotJson(prompt, githubToken));
  }
  if (providers.length === 0) throw new Error("No AI provider configured");

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      return await provider();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      failures.push(err.message);
      // Log every provider attempt so the full fallback chain is visible in the
      // server console (region blocks, expired tokens, missing keys, etc.).
      console.warn(`[ai] provider failed (${failures.length}/${providers.length}): ${err.message}`);
      if (!isTransientAiError(err.message)) throw err;
      // transient — fall through to the next provider
    }
  }
  // Every provider failed — report the first error (usually the root cause,
  // e.g. a regional restriction) rather than just the last fallback's.
  const unique = [...new Set(failures)];
  throw new Error(unique.slice(0, 2).join(" | ") || "All AI providers failed");
}
