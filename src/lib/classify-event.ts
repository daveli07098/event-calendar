import { EVENT_CATEGORIES, type EventCategory } from "@/types";

const VALID_CATEGORIES = new Set<string>(EVENT_CATEGORIES);

const CATEGORY_PROMPT_LINES = `  concert    — live music, band show, K-pop concert, singer performance
  exhibition — art gallery, museum exhibition, art fair, design expo
  theatre    — play, musical, opera, ballet, circus, dance performance
  sports     — match, tournament, race, sporting event
  festival   — cultural festival, fair, carnival, parade, lantern festival
  anime      — anime/manga/IP event, character pop-up, cosplay event, doujin market
  popup      — brand pop-up store, limited-edition retail activation, product launch
  kuji       — ichiban kuji (一番くじ), one kuji, lottery-style merchandise raffle event
  crane      — crane game, UFO catcher, arcade prize merchandise (プライズ), claw machine collaboration
  comedy     — stand-up comedy show, improv night
  film       — film screening, movie premiere, film festival
  food       — food festival, wine tasting, dining event, craft beer event
  ticket     — ticket sale / presale reminder with no physical performance on that date
  other      — does not fit any above`;

const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.0-flash"];

async function callGemini(prompt: string, apiKey: string): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1024 },
          }),
          signal: AbortSignal.timeout(20000),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } catch {
      continue;
    }
  }
  return null;
}

function parseCategories(raw: string): Record<string, EventCategory> {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  const parsed: Record<string, string> = JSON.parse(cleaned);
  const result: Record<string, EventCategory> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (VALID_CATEGORIES.has(v)) result[k] = v as EventCategory;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Classify a batch of events (for the Classify tab — existing events in DB)
// ---------------------------------------------------------------------------
export async function classifyBatch(
  events: Array<{ id: string; title: string; description: string | null; location: string | null }>
): Promise<Record<string, EventCategory>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return {};

  const list = events
    .map((e, i) =>
      `${i}: "${e.title}"${e.location ? ` at ${e.location}` : ""}${e.description ? ` — ${e.description.slice(0, 120)}` : ""}`
    )
    .join("\n");

  const prompt = `Classify each event into exactly one category. Return ONLY a JSON object mapping the index (string key) to a category string.

Categories (choose the best fit):
${CATEGORY_PROMPT_LINES}

Events:
${list}

Return ONLY {"0":"concert","1":"exhibition",...} with no extra text.`;

  const raw = await callGemini(prompt, apiKey);
  if (!raw) return {};
  try {
    return parseCategories(raw);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Classify a single event (used by the scrape route as a fallback)
// ---------------------------------------------------------------------------
export async function classifySingleEvent(
  title: string,
  location: string | null,
  description: string | null
): Promise<EventCategory | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const eventLine = `"${title}"${location ? ` at ${location}` : ""}${description ? ` — ${description.slice(0, 200)}` : ""}`;

  const prompt = `Classify this event into exactly one category. Return ONLY a JSON object {"0":"<category>"}.

Categories (choose the best fit):
${CATEGORY_PROMPT_LINES}

Event:
0: ${eventLine}

Return ONLY {"0":"concert"} with no extra text.`;

  const raw = await callGemini(prompt, apiKey);
  if (!raw) return null;
  try {
    const parsed = parseCategories(raw);
    return parsed["0"] ?? null;
  } catch {
    return null;
  }
}
