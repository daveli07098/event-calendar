import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cleanCompletion,
  hasOpenCode,
  openCodeChat,
  openCodeModels,
  resetOpenCodeStateForTests,
} from "@/lib/ai/opencode";
import pkg from "../../../package.json";

function ok(content: string, totalTokens = 42) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: totalTokens } }),
    { status: 200 },
  );
}

function bodyOf(init: unknown): Record<string, unknown> {
  return JSON.parse(String((init as RequestInit).body));
}

describe("opencode provider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENCODE_API_KEY", "oc-test-key");
    vi.stubEnv("OPENCODE_MODELS", "");
    vi.stubEnv("OPENCODE_BASE_URL", "");
    resetOpenCodeStateForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hasOpenCode treats an empty key as unset", () => {
    expect(hasOpenCode()).toBe(true);
    vi.stubEnv("OPENCODE_API_KEY", "");
    expect(hasOpenCode()).toBe(false);
  });

  it("returns null without calling fetch when no key is configured", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "");
    expect(await openCodeChat({ prompt: "hi", feature: "test" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the model cascade from OPENCODE_MODELS, with defaults", () => {
    expect(openCodeModels()).toEqual(["glm-5.3-flash", "minimax-m3.1-flash", "mimo-v2.6-flash"]);
    vi.stubEnv("OPENCODE_MODELS", " kimi-k3 , glm-5.3 ,");
    expect(openCodeModels()).toEqual(["kimi-k3", "glm-5.3"]);
  });

  it("sends Bearer auth, a stable session id and a non-generic User-Agent to the Go endpoint", async () => {
    fetchMock.mockResolvedValue(ok("hello"));
    const r = await openCodeChat({ prompt: "hi", feature: "scrape" });
    expect(r).toEqual({ text: "hello", model: "glm-5.3-flash", tokens: 42, provider: "opencode:glm-5.3-flash" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://opencode.ai/inference/go/openai/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer oc-test-key",
      "x-opencode-session": "event-calendar:scrape",
      "User-Agent": `event-calendar/${pkg.version}`,
    });
    expect(bodyOf(init)).toMatchObject({ model: "glm-5.3-flash", messages: [{ role: "user", content: "hi" }] });
  });

  it("honours OPENCODE_BASE_URL (e.g. Zen)", async () => {
    vi.stubEnv("OPENCODE_BASE_URL", "https://opencode.ai/inference/");
    fetchMock.mockResolvedValue(ok("x"));
    await openCodeChat({ prompt: "hi", feature: "t" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://opencode.ai/inference/openai/v1/chat/completions");
  });

  it("cascades to the next model on 429 and 5xx", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"message":"monthly limit reached"}}', { status: 429 }))
      .mockResolvedValueOnce(new Response("upstream down", { status: 502 }))
      .mockResolvedValueOnce(ok("third time lucky"));
    const r = await openCodeChat({ prompt: "hi", feature: "t" });
    expect(r?.model).toBe("mimo-v2.6-flash");
    expect(r?.text).toBe("third time lucky");
    expect(fetchMock.mock.calls.map(([, init]) => bodyOf(init).model)).toEqual([
      "glm-5.3-flash",
      "minimax-m3.1-flash",
      "mimo-v2.6-flash",
    ]);
  });

  it("cascades on network errors / timeouts", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("The operation was aborted due to timeout"))
      .mockResolvedValueOnce(ok("ok"));
    const r = await openCodeChat({ prompt: "hi", feature: "t" });
    expect(r?.model).toBe("minimax-m3.1-flash");
  });

  it("returns null when every model fails", async () => {
    fetchMock.mockImplementation(async () => new Response("busy", { status: 503 }));
    expect(await openCodeChat({ prompt: "hi", feature: "t" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops at once on a 401 (bad credential) and never logs the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response('{"error":{"type":"server_error","message":"Invalid credential"}}', { status: 401 }),
    );
    expect(await openCodeChat({ prompt: "hi", feature: "t" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("oc-test-key");
  });

  it("sends response_format in JSON mode and retries once without it when rejected", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"response_format is not supported"}}', { status: 400 }),
      )
      .mockResolvedValueOnce(ok('{"a":1}'));
    const r = await openCodeChat({ prompt: "json please", feature: "t", json: true });
    expect(r?.text).toBe('{"a":1}');
    expect(r?.model).toBe("glm-5.3-flash");
    expect(bodyOf(fetchMock.mock.calls[0]![1]).response_format).toEqual({ type: "json_object" });
    expect(bodyOf(fetchMock.mock.calls[1]![1]).response_format).toBeUndefined();

    // Remembered: the next JSON call to that model skips response_format up front.
    fetchMock.mockResolvedValueOnce(ok('{"b":2}'));
    await openCodeChat({ prompt: "again", feature: "t", json: true });
    expect(bodyOf(fetchMock.mock.calls[2]![1]).response_format).toBeUndefined();
  });

  it("does not retry a 400 unrelated to response_format on the same model", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"message":"context too long"}}', { status: 400 }))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const r = await openCodeChat({ prompt: "x", feature: "t", json: true });
    expect(r?.model).toBe("minimax-m3.1-flash");
    expect(bodyOf(fetchMock.mock.calls[1]![1]).response_format).toEqual({ type: "json_object" });
  });

  it("strips <think> blocks and code fences", async () => {
    fetchMock.mockResolvedValue(ok('<think>reasoning about {"x":0}</think>\n```json\n{"team1":"A"}\n```'));
    const r = await openCodeChat({ prompt: "x", feature: "t", json: true });
    expect(r?.text).toBe('{"team1":"A"}');
    expect(cleanCompletion("<think>never closed")).toBe("");
  });

  it("treats a JSON-mode answer with no object as a failure and tries the next model", async () => {
    fetchMock
      .mockResolvedValueOnce(ok("<think>only thoughts</think>"))
      .mockResolvedValueOnce(ok('{"ok":true}'));
    const r = await openCodeChat({ prompt: "x", feature: "t", json: true });
    expect(r?.model).toBe("minimax-m3.1-flash");
  });

  it("stops cascading once the caller's deadline is spent", async () => {
    fetchMock.mockResolvedValue(new Response("busy", { status: 503 }));
    const r = await openCodeChat({ prompt: "x", feature: "t", deadline: Date.now() + 500 });
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
