-- CreateTable
-- Cache of AI scrape extractions keyed by sha256(prompt version + url + page
-- text) — unchanged pages are served from cache at zero Gemini requests.
CREATE TABLE IF NOT EXISTS "AiScrapeCache" (
    "hash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiScrapeCache_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiScrapeCache_updatedAt_idx" ON "AiScrapeCache"("updatedAt");
