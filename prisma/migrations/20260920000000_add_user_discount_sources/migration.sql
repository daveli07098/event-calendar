-- User's custom Discount Sale source URLs (string[]), so sources survive
-- across browsers/devices instead of living in localStorage only.
ALTER TABLE "User" ADD COLUMN "discountSources" JSONB;
