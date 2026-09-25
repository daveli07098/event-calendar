import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { geminiPool } from "@/lib/ai/models";
import {
  availableGrounded,
  isDailyQuotaError,
  markModelExhausted,
  recordModelCall,
} from "@/lib/ai/model-quota";

const WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage";
const geminiEndpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

interface TeamResult {
  team1: string | null;
  team2: string | null;
}

async function fetchWikipediaText(): Promise<string> {
  const res = await fetch(WIKIPEDIA_URL, {
    headers: { "User-Agent": "EventCalendarBot/1.0 (educational project)" },
    next: { revalidate: 3600 }, // cache for 1 hour
  });
  if (!res.ok) throw new Error(`Wikipedia fetch failed: ${res.status}`);
  const html = await res.text();
  // Strip HTML tags and collapse whitespace for a reasonably small text blob
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 30000); // cap to avoid Gemini token limits
}

async function resolveTeamsFromGemini(
  matchId: number,
  pageText: string,
): Promise<TeamResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const prompt = `You are a sports data assistant. Below is extracted text from a Wikipedia article about the 2026 FIFA World Cup knockout stage.

Find the two teams that are playing in Match ${matchId} (also written as "Match ${matchId}", "Game ${matchId}", or "M${matchId}").

Return ONLY a raw JSON object with no markdown fences:
{"team1": "Country Name", "team2": "Country Name"}

If the teams are not yet determined (the match hasn't happened yet or the bracket isn't filled), return:
{"team1": null, "team2": null}

Wikipedia text:
${pageText}`;

  // Grounding-capable models only (only Gemini 2.5 still has free-tier Google
  // Search grounding — see the pool's comment) — try each in RPD headroom
  // order, same 429 fall-through + quota-recording pattern as scrape/route.ts.
  let lastError: Error | null = null;
  for (const model of await availableGrounded()) {
    try {
      const res = await fetch(geminiEndpoint(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          ...(geminiPool.spec(model)?.thinking
            ? { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }
            : {}),
        }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const errBody = await res.json();
          if (errBody?.error?.message) detail = ` — ${errBody.error.message}`;
        } catch {
          // Non-JSON error body — status code alone will have to do
        }
        if (res.status === 429 && isDailyQuotaError(detail)) await markModelExhausted(model);
        lastError = new Error(`Gemini API error: ${res.status}${detail}`);
        continue; // try next grounded model
      }
      await recordModelCall(model); // count toward today's RPD budget
      const json = await res.json();
      const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*"team1"[\s\S]*"team2"[\s\S]*\}/);
      if (!jsonMatch) {
        lastError = new Error("Gemini did not return valid JSON");
        continue;
      }
      return JSON.parse(jsonMatch[0]) as TeamResult;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("No Gemini grounded model available");
}

// Replace the team name portion inside the event title while keeping round prefix
function buildUpdatedTitle(currentTitle: string, team1: string, team2: string): string {
  // Title format: "32強 | <team1> vs <team2>"
  const pipeIdx = currentTitle.indexOf("|");
  if (pipeIdx === -1) return `${currentTitle.split(" | ")[0]} | ${team1} vs ${team2}`;
  const prefix = currentTitle.slice(0, pipeIdx + 1).trim();
  return `${prefix} ${team1} vs ${team2}`;
}

// Replace placeholder team names in the description body
function buildUpdatedDescription(
  currentDescription: string,
  team1: string,
  team2: string,
): string {
  // The second line of the description is "<team1> vs <team2>"
  const lines = currentDescription.split("\n");
  // Find and replace the "X vs Y" line (second line)
  if (lines.length >= 2) {
    lines[1] = `${team1} vs ${team2}`;
  }
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let eventId: string;
  try {
    const body = await req.json();
    eventId = body.eventId;
    if (!eventId || typeof eventId !== "string") throw new Error("missing eventId");
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // 1. Fetch the event and verify ownership
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { calendar: { select: { userId: true } } },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.calendar.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Extract World Cup Match ID from description
  const matchIdStr = event.description?.match(/World Cup Match ID:\s*(\d+)/)?.[1];
  if (!matchIdStr) {
    return NextResponse.json({ error: "Event has no World Cup Match ID in description" }, { status: 422 });
  }
  const matchId = parseInt(matchIdStr, 10);

  // 3. Fetch Wikipedia and ask Gemini for real team names
  let teams: TeamResult;
  try {
    const pageText = await fetchWikipediaText();
    teams = await resolveTeamsFromGemini(matchId, pageText);
  } catch (err) {
    console.error("[worldcup-sync] external fetch/AI error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "External lookup failed" },
      { status: 502 },
    );
  }

  if (!teams.team1 || !teams.team2) {
    return NextResponse.json({
      success: false,
      message: "Teams not yet determined — group stage may still be in progress.",
      team1: null,
      team2: null,
    });
  }

  // 4. Update title and description in DB
  const updatedTitle = buildUpdatedTitle(event.title, teams.team1, teams.team2);
  const updatedDescription = buildUpdatedDescription(
    event.description ?? "",
    teams.team1,
    teams.team2,
  );

  const updatedEvent = await prisma.event.update({
    where: { id: eventId },
    data: { title: updatedTitle, description: updatedDescription },
  });

  return NextResponse.json({
    success: true,
    team1: teams.team1,
    team2: teams.team2,
    updatedTitle,
    updatedEvent,
  });
}
