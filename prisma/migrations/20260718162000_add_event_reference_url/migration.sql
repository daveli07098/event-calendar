-- Additional info / reference URL per event (e.g. a station-specific ticketing
-- page announced later) — used by Sync as the preferred scrape source.
ALTER TABLE "Event" ADD COLUMN "referenceUrl" TEXT;
