import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EVENT_CATEGORIES, type EventCategory } from "@/types";

const VALID_CATEGORIES = new Set<string>(EVENT_CATEGORIES);

// ---------------------------------------------------------------------------
// AI batch classification using the same Gemini cascade as the scrape route
// ---------------------------------------------------------------------------
async function classifyBatch(
  events: Array<{ id: string; title: string; description: string | null; location: string | null }>
): Promise<Record<string, EventCategory>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return {};

  const list = events.map((e, i) => `${i}: "${e.title}"${e.location ? ` at ${e.location}` : ""}${e.description ? ` — ${(e.description).slice(0, 120)}` : ""}`).join("\n");
  const prompt = `Classify each event into exactly one category. Return ONLY a JSON object mapping the index (string key) to a category string.

Categories (choose the best fit):
  concert    — live music, band show, K-pop concert, singer performance
  exhibition — art gallery, museum exhibition, art fair, design expo
  theatre    — play, musical, opera, ballet, circus, dance performance
  sports     — match, tournament, race, sporting event
  festival   — cultural festival, fair, carnival, parade, lantern festival
  anime      — anime/manga/IP event, character pop-up, cosplay event, doujin market
  popup      — brand pop-up store, limited-edition retail activation, product launch
  comedy     — stand-up comedy show, improv night
  film       — film screening, movie premiere, film festival
  food       — food festival, wine tasting, dining event, craft beer event
  other      — does not fit any above

Events:
${list}

Return ONLY {"0":"concert","1":"exhibition",...} with no extra text.`;

  const models = ["gemini-3-flash-preview", "gemini-2.5-flash-lite"];
  for (const model of models) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      const parsed: Record<string, string> = JSON.parse(cleaned);
      // Validate each value
      const result: Record<string, EventCategory> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (VALID_CATEGORIES.has(v)) result[k] = v as EventCategory;
      }
      return result;
    } catch {
      continue;
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// GET /api/events/classify — return category counts for the user's events
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId: session.user.id }, select: { id: true } }),
    prisma.calendarMember.findMany({ where: { userId: session.user.id }, select: { calendarId: true } }),
  ]);
  const calIds = [...owned.map((c) => c.id), ...memberships.map((m) => m.calendarId)];

  const counts = await prisma.event.groupBy({
    by: ["category"],
    where: { calendarId: { in: calIds } },
    _count: { _all: true },
  });

  const total = await prisma.event.count({ where: { calendarId: { in: calIds } } });
  const unclassified = counts.find((c) => c.category === null)?._count._all ?? 0;

  return NextResponse.json({
    counts: counts.map((c) => ({ category: c.category, count: c._count._all })),
    total,
    unclassified,
  });
}

// ---------------------------------------------------------------------------
// POST /api/events/classify — AI-classify all (or unclassified) events
// Body: { onlyUnclassified?: boolean }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { onlyUnclassified?: boolean };
  const onlyUnclassified = body.onlyUnclassified !== false; // default true

  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId: session.user.id }, select: { id: true } }),
    prisma.calendarMember.findMany({ where: { userId: session.user.id }, select: { calendarId: true } }),
  ]);
  const calIds = [...owned.map((c) => c.id), ...memberships.map((m) => m.calendarId)];

  const events = await prisma.event.findMany({
    where: {
      calendarId: { in: calIds },
      ...(onlyUnclassified ? { category: null } : {}),
    },
    select: { id: true, title: true, description: true, location: true },
    orderBy: { startTime: "asc" },
  });

  if (events.length === 0) {
    return NextResponse.json({ updated: 0, message: "No events to classify." });
  }

  // Process in batches of 30 to keep prompts manageable
  const BATCH_SIZE = 30;
  let updatedCount = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const classifications = await classifyBatch(batch);

    await Promise.all(
      Object.entries(classifications).map(([idx, category]) => {
        const event = batch[Number(idx)];
        if (!event) return;
        updatedCount++;
        return prisma.event.update({ where: { id: event.id }, data: { category } });
      })
    );
  }

  return NextResponse.json({
    updated: updatedCount,
    total: events.length,
    message: `Classified ${updatedCount} of ${events.length} event(s).`,
  });
}
