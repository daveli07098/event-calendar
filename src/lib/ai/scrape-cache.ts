/**
 * Cache of AI scrape extractions, keyed by sha256(prompt version + url + page
 * text).
 *
 * Why: the free tier's binding limit is requests/DAY (see model-quota.ts), and
 * the biggest source of repeat requests is Sync — it re-scrapes every ticket
 * page on every check, re-running the SAME prompt over the SAME page text and
 * burning a flagship-model request for a result we already have. With the page
 * text in the key, an unchanged page is a guaranteed-identical prompt
 * (temperature 0), so reusing the stored result is lossless; the moment the
 * page changes (new sale window announced) the hash changes and a fresh AI
 * call runs.
 *
 * Cache hits cost zero Gemini requests AND don't consume the user's daily app
 * quota. Entries expire after 30 days so model/prompt improvements eventually
 * re-extract even static pages; bumping the prompt version invalidates
 * immediately. All helpers swallow DB errors — a broken cache must degrade to
 * "no cache", never block scraping.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function scrapeCacheKey(promptVersion: string, url: string, pageText: string): string {
  return createHash("sha256").update(`${promptVersion}\n${url}\n${pageText}`).digest("hex");
}

export async function getScrapeCache(
  hash: string
): Promise<{ result: Record<string, unknown>; provider: string } | null> {
  try {
    const row = await prisma.aiScrapeCache.findUnique({ where: { hash } });
    if (!row) return null;
    if (Date.now() - row.updatedAt.getTime() > CACHE_TTL_MS) return null;
    if (typeof row.result !== "object" || row.result === null || Array.isArray(row.result)) return null;
    return { result: row.result as Record<string, unknown>, provider: row.provider };
  } catch {
    return null;
  }
}

export async function saveScrapeCache(
  hash: string,
  url: string,
  result: Record<string, unknown>,
  provider: string
): Promise<void> {
  try {
    const json = result as Prisma.InputJsonObject;
    await prisma.aiScrapeCache.upsert({
      where: { hash },
      create: { hash, url, result: json, provider },
      update: { result: json, provider },
    });
    // Opportunistic prune — writes only happen on cache misses, so this stays
    // cheap and keeps the table from accumulating dead page versions.
    await prisma.aiScrapeCache.deleteMany({
      where: { updatedAt: { lt: new Date(Date.now() - CACHE_TTL_MS) } },
    });
  } catch {
    // Cache is best-effort — never fail the scrape over it.
  }
}

/**
 * Merge follow-up enrichments (classify-fallback category, AI-composed
 * description) into an existing entry, so repeat hits on the same page don't
 * re-run those extra AI calls either. No-op if the entry doesn't exist.
 */
export async function patchScrapeCache(
  hash: string,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    const row = await prisma.aiScrapeCache.findUnique({ where: { hash } });
    if (!row || typeof row.result !== "object" || row.result === null) return;
    await prisma.aiScrapeCache.update({
      where: { hash },
      data: {
        result: { ...(row.result as Record<string, unknown>), ...patch } as Prisma.InputJsonObject,
      },
    });
  } catch {
    // Cache is best-effort — never fail the scrape over it.
  }
}
