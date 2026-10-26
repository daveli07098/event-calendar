# AI providers

Every text-only AI feature tries **OpenCode** first and falls back to **Gemini** (then Groq /
GitHub Copilot where the feature already had them). With `OPENCODE_API_KEY` unset, behaviour is
exactly the pre-OpenCode Gemini cascade.

Code: `src/lib/ai/opencode.ts` (`hasOpenCode()`, `openCodeModels()`, `openCodeChat()`),
`src/lib/ai/client.ts` (shared JSON cascade), `src/lib/ai/models.ts` (Gemini free-tier pool).

## Provider order per feature

| Feature | Code | Order | OpenCode time budget |
|---|---|---|---|
| Ticket scrape extraction | `api/tickets/scrape` | OpenCode → Gemini pool → Groq → Copilot | 12 s/model, stops 12 s before the 40 s cascade budget |
| Scrape description (keyword-soup pages) | `api/tickets/scrape` `generateDescription` | OpenCode → Gemini lite models | 10 s/model, 15 s total |
| Duplicate-title similarity | `api/tickets/scrape` | OpenCode → Gemini lite models → exact-title match | 8 s/model, 10 s total |
| Category classify (scrape fallback + Classify tab) | `lib/classify-event.ts` | OpenCode → Gemini lite models | 20 s/model, 30 s total |
| Discount scan | `api/discounts/scan` → `aiExtractJson` | OpenCode → Gemini pool → Groq → Copilot | 25 s/model, 45 s total |
| World Cup team names (Wikipedia text in prompt) | `api/events/worldcup-sync` | OpenCode → Gemini grounded-pool models | 25 s/model, 40 s total |
| World Cup **score refresh** (Google Search grounding) | `lib/worldcup-refresh.ts` | Gemini only | — (OpenCode has no web search) |
| Seat-map draft from image/PDF | `api/venues/[id]/seatmap/draft` | Gemini → Copilot (images only) | — (OpenCode vision unconfirmed) |

Scrape route: every AI call (OpenCode and the Gemini fallbacks) is capped at 52 s after the
request started (`REQUEST_AI_BUDGET_MS`, inside `maxDuration = 60`). Description and similarity
are skipped entirely when < 4 s remain, keeping the page/meta description and exact-title
duplicate matching.

Seat-map drafts need `GEMINI_API_KEY` or `GITHUB_TOKEN` (`hasVisionProvider()`); an
OpenCode-only deploy gets an actionable 503 with no quota spent.

The provider label returned to the UI (`aiUsed`, scrape-cache `provider`, discount `provider`)
is `opencode:<model>` for OpenCode results, the bare Gemini model id otherwise.

Gemini details: `src/lib/ai/models.ts` holds the free-tier-only pool (checked 2026-10-26 with
ListModels + a ping per model). Scrape route: `maxDuration = 60`, 12 s per Gemini attempt, 40 s
cascade budget shared with OpenCode.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `OPENCODE_API_KEY` | no | Enables OpenCode as the primary provider. Unset/empty = skipped. |
| `OPENCODE_MODELS` | no | Comma list, cascade order. Default `glm-5.3-flash,minimax-m3.1-flash,mimo-v2.6-flash`. |
| `OPENCODE_BASE_URL` | no | Default `https://opencode.ai/inference/go` (Go plan). `https://opencode.ai/inference` = Zen pay-as-you-go. The client appends `/openai/v1/chat/completions`. |
| `GEMINI_API_KEY` | recommended | Fallback for every text feature, and the **only** provider for World Cup score grounding and image/PDF seat-map drafts. |
| `GROQ_API_KEY`, `GITHUB_TOKEN` | no | Later fallbacks for scrape extraction / discount scan; Copilot also handles image drafts. |

Any one of `OPENCODE_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` / `GITHUB_TOKEN` turns AI
features on (`hasAiProvider()`); score refresh still refuses to run without `GEMINI_API_KEY`.

## How OpenCode calls behave

- `POST <base>/openai/v1/chat/completions`, headers `Authorization: Bearer <key>`,
  `x-opencode-session: event-calendar:<feature>` (required — missing = 400 `MissingSessionID`;
  one stable id per feature: `scrape`, `describe`, `duplicates`, `classify`, `discounts`,
  `extract`, `worldcup-sync`), `User-Agent: event-calendar/<package.json version>`.
- JSON features send `response_format: {type: "json_object"}`; a 400 that mentions
  `response_format` retries the same model once without it, and that model is remembered as
  non-JSON-mode for the life of the server instance. Prompts always ask for JSON as well.
- `<think>…</think>` blocks and code fences are stripped; JSON is parsed with `parseJsonLoose`.
  Small calls use ≥1024 max tokens because reasoning models spend tokens on in-band thinking.
- Any failure — 429/402/403 spend caps, 5xx, timeouts, other 4xx, empty output, no JSON object in
  JSON mode — moves to the next model. A **401** (missing/invalid credential) stops OpenCode at
  once. When every model fails, the feature falls back to Gemini. Failures are logged as
  `[opencode] <feature>: <model> failed (<status>): <body head>`; the key is never logged.

## Changing models

Set `OPENCODE_MODELS` (no deploy needed beyond the env change). Chat-endpoint models seen
2026-10-27: `glm-5.3-flash`, `minimax-m3.1-flash`, `mimo-v2.6-flash`, `deepseek-v4.1-flash`
(needs a console privacy setting), `glm-5.3`, `kimi-k3`. **Never** use `muse-spark-*` (its traffic
is used for training). Each model has its own monthly dollar cap; when one is exhausted the API
errors and the cascade moves on, so list cheap flash models first.

## Terms caveat

OpenCode **Go** is "designed for coding agents" and its traffic is monitored; a web backend
calling it is a grey area. The safer fit for this app is **Zen** pay-as-you-go:
`OPENCODE_BASE_URL=https://opencode.ai/inference` with a Zen key (verify the Zen model ids before
switching). Either way the terms ask for a non-generic User-Agent and stable session ids, which
the client sends.
