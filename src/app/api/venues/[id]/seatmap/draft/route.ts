import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasAiProvider, aiExtractJsonFromImage } from "@/lib/ai/client";
import { AI_DAILY_LIMIT, checkRemainingAiLimit, incrementAiLimit, getResetAt } from "@/lib/ai/quota";
import { safeFetch, UnsafeUrlError } from "@/lib/safe-fetch";
import { scrapeCacheKey, getScrapeCache, saveScrapeCache } from "@/lib/ai/scrape-cache";
import { validateSeatMapConfig } from "@/lib/venue-seatmap/validate";
import { buildDraftPrompt, DRAFT_PROMPT_VERSION } from "@/lib/venue-seatmap/draft-prompt";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const MAX_PLAN_BYTES = 10 * 1024 * 1024; // matches the 10 MB PDF upload cap in seatmap/plan

/**
 * POST /api/venues/[id]/seatmap/draft — AI-draft a `VenueSeatMapConfig` from a venue's seating
 * plan. Body: `{ planUrl?: string; notes?: string }` — `planUrl` defaults to the venue's stored
 * `seatMapPlanUrl`. Returns `{ draft, warnings }` WITHOUT saving anything; the caller reviews
 * the draft and PUTs it to /seatmap themselves.
 *
 * Cached by sha256(prompt version + venue id + plan url + notes + image bytes) in
 * AiScrapeCache, so re-drafting the exact same plan (same venue, same notes) costs zero AI
 * calls and doesn't touch the user's daily quota — see src/lib/ai/scrape-cache.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uid = session.user.id;

  const { id } = await params;
  const venue = await prisma.eventVenue.findUnique({
    where: { id },
    select: { id: true, name: true, aliases: true, seatMapPlanUrl: true },
  });
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 404 });

  let body: { planUrl?: unknown; notes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const planUrl = typeof body.planUrl === "string" && body.planUrl.trim() ? body.planUrl.trim() : venue.seatMapPlanUrl;
  if (!planUrl) {
    return NextResponse.json(
      { error: "No planUrl given and this venue has no stored seatMapPlanUrl" },
      { status: 400 }
    );
  }
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined;

  if (!hasAiProvider()) {
    return NextResponse.json({ error: "No AI provider configured — seat-map drafting requires AI" }, { status: 503 });
  }

  // Fetch the plan bytes (SSRF-safe — see src/lib/safe-fetch.ts) before touching quota, so a
  // bad/unreachable planUrl fails cheaply.
  let mimeType: string;
  let base64: string;
  try {
    const res = await safeFetch(planUrl, {
      maxBytes: MAX_PLAN_BYTES,
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "image/*,application/pdf" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Could not fetch plan (HTTP ${res.status})` }, { status: 422 });
    }
    mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported plan content type: ${mimeType || "unknown"} (expected an image or application/pdf)` },
        { status: 415 }
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    base64 = buf.toString("base64");
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return NextResponse.json({ error: "Private URLs are not allowed" }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : "Fetch failed";
    return NextResponse.json({ error: `Could not fetch plan: ${msg}` }, { status: 422 });
  }

  // Cache key covers everything that changes the prompt/result: prompt version, venue identity
  // (so the SAME image drafted for two different venues never cross-contaminates), notes, and
  // the plan bytes themselves.
  const cacheKey = scrapeCacheKey(DRAFT_PROMPT_VERSION, `${venue.id}:${planUrl}`, `${notes ?? ""}\n${base64}`);

  let rawDraft: Record<string, unknown>;
  let cacheHit = false;
  const cached = await getScrapeCache(cacheKey);
  if (cached) {
    rawDraft = cached.result;
    cacheHit = true;
  } else {
    if (!(await checkRemainingAiLimit(uid))) {
      return NextResponse.json(
        { error: `Daily AI limit reached (${AI_DAILY_LIMIT}/day)`, resetAt: getResetAt() },
        { status: 429 }
      );
    }
    const prompt = buildDraftPrompt(venue, planUrl, notes);
    try {
      const result = await aiExtractJsonFromImage(prompt, { mimeType, base64 });
      await incrementAiLimit(uid);
      rawDraft = result.data;
      await saveScrapeCache(cacheKey, planUrl, rawDraft, result.provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI extraction failed";
      return NextResponse.json({ error: `AI draft failed: ${msg}` }, { status: 502 });
    }
  }

  // The model is never trusted for the venue's identity or the parts that are policy, not
  // observation — these are forced from the DB row / fixed rules regardless of what came back.
  const forced: Record<string, unknown> = {
    ...rawDraft,
    id: venue.id,
    name: venue.name,
    aliases: venue.aliases.length > 0 ? venue.aliases : [venue.name],
    bowlShape: "rounded-rect",
    orientationConfidence: "unconfirmed",
    seatingPlanSources: [{ url: planUrl, label: "Official seating plan" }],
  };

  const validated = validateSeatMapConfig(forced);
  if (!validated.ok) {
    return NextResponse.json(
      { error: "AI draft failed validation", errors: validated.errors },
      { status: 422 }
    );
  }

  const warnings: string[] = [];
  if (cacheHit) warnings.push("Draft served from cache — no AI call was made.");
  const unconfirmedCount = countUnconfirmedPositions(validated.config);
  if (unconfirmedCount > 0) {
    warnings.push(`${unconfirmedCount} block range(s) have unconfirmed position — review before approving.`);
  }

  return NextResponse.json({ draft: validated.config, warnings });
}

/** Counts block ranges (numeric + labelled) across every level whose position isn't confirmed
 * — surfaced as a review warning, not a validation failure (unconfirmed is a valid, expected
 * state for a fresh AI draft). */
function countUnconfirmedPositions(config: VenueSeatMapConfig): number {
  let count = 0;
  for (const level of config.levels) {
    for (const r of level.blockNumberRanges) {
      if (r.positionConfidence === "unconfirmed") count++;
    }
    for (const r of level.blockLabelRanges ?? []) {
      if (r.positionConfidence === "unconfirmed") count++;
    }
  }
  return count;
}
