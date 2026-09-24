-- Procedural seat-map fields on the shared EventVenue directory. Nullable/additive: a venue
-- with none of these set behaves exactly as it did before this feature existed. See
-- src/lib/venue-seatmap/types.ts (VenueSeatMapConfig) and src/lib/venue-seatmap/validate.ts.
ALTER TABLE "EventVenue" ADD COLUMN "seatMapConfig" JSONB;
ALTER TABLE "EventVenue" ADD COLUMN "seatMapStatus" TEXT;
ALTER TABLE "EventVenue" ADD COLUMN "seatMapSource" TEXT;
ALTER TABLE "EventVenue" ADD COLUMN "seatMapPlanUrl" TEXT;
ALTER TABLE "EventVenue" ADD COLUMN "seatMapUpdatedBy" TEXT;
ALTER TABLE "EventVenue" ADD COLUMN "seatMapUpdatedAt" TIMESTAMP(3);
