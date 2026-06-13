-- CreateTable
-- Singleton cache of AI-fetched World Cup scores/standings (id = 'global').
-- IF NOT EXISTS keeps this safe to apply even though the table was created
-- manually first; mark it applied with `prisma migrate resolve --applied
-- 20260613000000_add_worldcup_scores` to sync migration history.
CREATE TABLE IF NOT EXISTS "WorldCupScores" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "data" JSONB NOT NULL,
    "provider" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCupScores_pkey" PRIMARY KEY ("id")
);
