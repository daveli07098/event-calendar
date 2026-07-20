-- CreateTable
-- Per-model daily request counter for the shared Gemini free-tier pool (RPD).
-- dayKey = "YYYY-MM-DD" in America/Los_Angeles (Google's daily-quota reset clock).
CREATE TABLE IF NOT EXISTS "AiModelUsage" (
    "model" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelUsage_pkey" PRIMARY KEY ("model")
);
