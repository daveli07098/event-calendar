/**
 * Per-user daily AI quota — DB-backed, persists across hot reloads and restarts.
 * Shared by every AI-powered feature (ticket scraping, discount scanning, …)
 * so one daily budget covers them all.
 */
import { prisma } from "@/lib/prisma";

export const AI_DAILY_LIMIT = 250; // max AI calls per user per day

export function getDayKey() {
  // Use HKT (UTC+8) so quota resets at midnight Hong Kong time, not midnight UTC
  const hkt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return hkt.toISOString().slice(0, 10); // "YYYY-MM-DD" in HKT
}

/** ISO UTC string of the next HKT midnight (quota reset point). */
export function getResetAt(): string {
  const hktMs = Date.now() + 8 * 60 * 60 * 1000;
  // Start of current HKT day (ms), then add one day to get next midnight HKT
  const nextMidnightHktMs = Math.floor(hktMs / 86400000) * 86400000 + 86400000;
  return new Date(nextMidnightHktMs - 8 * 60 * 60 * 1000).toISOString();
}

// In-memory fallback for quota (used when DB columns not yet migrated)
const rateLimitMap = new Map<string, { count: number; dayKey: string }>();

/** Returns true if the user still has quota remaining (does NOT increment). */
export async function checkRemainingAiLimit(userId: string): Promise<boolean> {
  const today = getDayKey();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiQuotaDate: true, aiQuotaCount: true },
  }).catch(() => null);
  if (!user) {
    // DB unavailable — fall back to in-memory
    const bucket = rateLimitMap.get(userId);
    return !bucket || bucket.dayKey !== today || bucket.count < AI_DAILY_LIMIT;
  }
  if (user.aiQuotaDate !== today) return true;
  return user.aiQuotaCount < AI_DAILY_LIMIT;
}

/** Increments the counter by 1. Call only after a successful AI response. */
export async function incrementAiLimit(userId: string): Promise<void> {
  const today = getDayKey();
  try {
    // Read current state first, then write atomically
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiQuotaDate: true, aiQuotaCount: true },
    });
    if (!user) return;
    if (user.aiQuotaDate !== today) {
      // New day — reset to 1
      await prisma.user.update({
        where: { id: userId },
        data: { aiQuotaDate: today, aiQuotaCount: 1 },
      });
    } else {
      // Same day — increment
      await prisma.user.update({
        where: { id: userId },
        data: { aiQuotaCount: { increment: 1 } },
      });
    }
  } catch {
    // DB unavailable — fall back to in-memory
    const bucket = rateLimitMap.get(userId);
    if (!bucket || bucket.dayKey !== today) {
      rateLimitMap.set(userId, { count: 1, dayKey: today });
    } else {
      bucket.count += 1;
    }
  }
}

/** How many AI calls remain today for this user (0–250). */
export async function remainingAiCalls(userId: string): Promise<number> {
  const today = getDayKey();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiQuotaDate: true, aiQuotaCount: true },
  }).catch(() => null);
  if (!user) {
    // DB unavailable — fall back to in-memory
    const bucket = rateLimitMap.get(userId);
    if (!bucket || bucket.dayKey !== today) return AI_DAILY_LIMIT;
    return Math.max(0, AI_DAILY_LIMIT - bucket.count);
  }
  if (user.aiQuotaDate !== today) return AI_DAILY_LIMIT; // new day — full quota
  return Math.max(0, AI_DAILY_LIMIT - (user.aiQuotaCount ?? 0));
}
