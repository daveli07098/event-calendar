/**
 * Per-model daily request tracking (RPD) for the shared Gemini free-tier pool.
 *
 * Why: the app's usage shape is many tiny spread-out calls, so Google's RPM/TPM
 * limits are never the binding constraint — the ~20 requests/DAY caps on the
 * flagship flash models are. The old cascade always started from the same model,
 * so it peaked at 31/20 RPD while lower rungs sat idle, and every scrape burned
 * a doomed 429 on the exhausted rung first.
 *
 * This module keeps one global counter per model (free-tier quota is per API
 * key, not per user) in the AiModelUsage table, keyed by the Pacific-time day —
 * Google resets daily quotas at midnight America/Los_Angeles. The cascade
 * helpers order models by remaining daily headroom:
 *
 *   1. models under the soft reserve (80% of RPD), in pool priority order;
 *   2. models past the reserve but not exhausted (last-resort band);
 *   3. exhausted models are dropped entirely.
 *
 * The soft reserve is what spreads load: traffic moves DOWN the cascade before
 * a model hits its wall, so no single model peaks past its RPD and a few calls
 * stay in reserve for high-priority use late in the day.
 *
 * DB errors fall back to an in-memory map (same pattern as src/lib/ai/quota.ts)
 * so tracking degrades gracefully instead of blocking AI calls.
 */
import { prisma } from "@/lib/prisma";
import { geminiPool } from "./models";

/** Keep this fraction as the hard-priority zone; past it a model becomes last-resort. */
const SOFT_RESERVE = 0.8;

/** "YYYY-MM-DD" in America/Los_Angeles — Google's daily-quota reset clock. */
export function getPacificDayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// In-memory fallback (used when the DB is unavailable / not yet migrated).
const memoryUsage = new Map<string, { count: number; dayKey: string }>();

function memoryGet(model: string, today: string): number {
  const bucket = memoryUsage.get(model);
  return bucket && bucket.dayKey === today ? bucket.count : 0;
}

function memorySet(model: string, today: string, count: number): void {
  memoryUsage.set(model, { count, dayKey: today });
}

/** Record one successful call to a pool model. Call after a 2xx response. */
export async function recordModelCall(model: string): Promise<void> {
  if (!geminiPool.has(model)) return;
  const today = getPacificDayKey();
  try {
    const row = await prisma.aiModelUsage.findUnique({ where: { model } });
    if (!row || row.dayKey !== today) {
      await prisma.aiModelUsage.upsert({
        where: { model },
        create: { model, dayKey: today, count: 1 },
        update: { dayKey: today, count: 1 },
      });
    } else {
      await prisma.aiModelUsage.update({
        where: { model },
        data: { count: { increment: 1 } },
      });
    }
  } catch {
    memorySet(model, today, memoryGet(model, today) + 1);
  }
}

/**
 * Mark a model's daily quota as spent for the rest of the Pacific day.
 * Call when Google returns a 429 whose detail names a per-DAY quota metric
 * (e.g. "GenerateRequestsPerDayPerProjectPerModel") — our own counter may have
 * undercounted (other deploys, dashboard drift), so trust Google's verdict.
 */
export async function markModelExhausted(model: string): Promise<void> {
  const spec = geminiPool.spec(model);
  if (!spec) return;
  const today = getPacificDayKey();
  try {
    await prisma.aiModelUsage.upsert({
      where: { model },
      create: { model, dayKey: today, count: spec.rpd },
      update: { dayKey: today, count: spec.rpd },
    });
  } catch {
    memorySet(model, today, spec.rpd);
  }
  console.warn(`[ai] ${model} daily quota (RPD ${spec.rpd}) exhausted — skipped until Pacific midnight`);
}

/** True when the 429 detail names a per-day quota (vs a transient per-minute one). */
export function isDailyQuotaError(message: string): boolean {
  return /per\s*day|perday/i.test(message);
}

/** Today's recorded usage for the given models (0 for unknown/stale rows). */
async function getUsage(models: string[]): Promise<Map<string, number>> {
  const today = getPacificDayKey();
  const usage = new Map<string, number>();
  try {
    const rows = await prisma.aiModelUsage.findMany({ where: { model: { in: models } } });
    for (const row of rows) {
      if (row.dayKey === today) usage.set(row.model, row.count);
    }
  } catch {
    for (const model of models) usage.set(model, memoryGet(model, today));
  }
  return usage;
}

// Order ids by daily headroom: fresh band (usage < 80% RPD) keeps pool priority
// order, throttled band (80%–100%) trails as last resort, exhausted dropped.
// If EVERY model is exhausted, return the original list — our counts may be
// stale and a real 429 is cheap, whereas an empty list would skip AI entirely.
function orderByHeadroom(ids: string[], usage: Map<string, number>): string[] {
  const fresh: string[] = [];
  const throttled: string[] = [];
  for (const id of ids) {
    const spec = geminiPool.spec(id);
    if (!spec) { fresh.push(id); continue; }
    const used = usage.get(id) ?? 0;
    if (used >= spec.rpd) continue;
    (used >= spec.rpd * SOFT_RESERVE ? throttled : fresh).push(id);
  }
  const ordered = [...fresh, ...throttled];
  return ordered.length > 0 ? ordered : ids;
}

/** RPD-aware replacement for geminiPool.cascade(). */
export async function availableCascade(): Promise<string[]> {
  const ids = geminiPool.cascade();
  return orderByHeadroom(ids, await getUsage(ids));
}

/** RPD-aware replacement for geminiPool.lite(). */
export async function availableLite(): Promise<string[]> {
  const ids = geminiPool.lite();
  return orderByHeadroom(ids, await getUsage(ids));
}

/** RPD-aware replacement for geminiPool.grounded(). */
export async function availableGrounded(): Promise<string[]> {
  const ids = geminiPool.grounded();
  return orderByHeadroom(ids, await getUsage(ids));
}
