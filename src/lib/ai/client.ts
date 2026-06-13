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

// Gemini models in priority order — all share GEMINI_API_KEY.
// Models that returned 404 ("not found for API version v1beta") were removed —
// they don't exist on the generateContent endpoint and only wasted a hop.
export const GEMINI_MODELS = [
  "gemini-3.5-flash",       // Gemini 3.5 Flash      — 5 RPM  free
  "gemini-3.1-flash-lite",  // Gemini 3.1 Flash Lite — 15 RPM free
  "gemini-2.5-flash",       // Gemini 2.5 Flash      — 5 RPM  free (stable)
  "gemini-2.5-flash-lite",  // Gemini 2.5 Flash Lite — 10 RPM free (stable)
  "gemma-4-31b-it",         // Gemma 4 31B           — 15 RPM free
];

/** True when at least one AI provider is configured via env. */
export function hasAiProvider(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GITHUB_TOKEN || process.env.GROQ_API_KEY);
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
    const salvaged = cleaned.replace(/,\s*$/, "") + (cleaned.includes("{") ? "}" : "");
    try {
      return JSON.parse(salvaged);
    } catch {
      return {};
    }
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
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048 },
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
    throw new Error(`Gemini API error: ${res?.status ?? "unknown"}${detail}`);
  }
  const data = await res.json();
  const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
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
      max_tokens: 2048,
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
    for (const model of GEMINI_MODELS) {
      providers.push(() => callGeminiJson(prompt, model));
    }
  }
  if (groqKey) {
    providers.push(() =>
      callOpenAICompatibleJson(
        prompt,
        "https://api.groq.com/openai/v1/chat/completions",
        groqKey,
        "llama3-8b-8192",
        "groq-llama3"
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
