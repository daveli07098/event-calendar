/**
 * Seed script: store the researched seat-map drafts (scripts/data/venue-seatmap-drafts.ts) on
 * their EventVenue rows as status "draft", source "research", so they show up for review in
 * the Venues section. Never approves anything and never overwrites a venue that already has a
 * seat map or plan — a human reviews and approves in the UI.
 *
 * Dry run (default): npx tsx scripts/seed-venue-seatmaps.ts
 * Write:             npx tsx scripts/seed-venue-seatmaps.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";
import { VENUE_SEATMAP_DRAFTS, NOT_FOUND_VENUES } from "./data/venue-seatmap-drafts";
import { validateSeatMapConfig } from "../src/lib/venue-seatmap/validate";

dotenv.config({ path: ".env.local" });

const apply = process.argv.includes("--apply");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(apply ? "Mode: APPLY (writing drafts)" : "Mode: dry run (pass --apply to write)");
  for (const { venueName, planUrl, config } of VENUE_SEATMAP_DRAFTS) {
    const checked = validateSeatMapConfig(config);
    if (!checked.ok) {
      console.log(`✗ ${venueName}: invalid config — ${checked.errors.join("; ")}`);
      continue;
    }
    const venue = await prisma.eventVenue.findFirst({
      where: { name: venueName },
      select: { id: true, name: true, seatMapStatus: true, seatMapPlanUrl: true },
    });
    if (!venue) {
      console.log(`✗ ${venueName}: no EventVenue with this exact name`);
      continue;
    }
    if (venue.seatMapStatus || venue.seatMapPlanUrl) {
      console.log(`– ${venueName}: already has a seat map (${venue.seatMapStatus ?? "plan only"}), left alone`);
      continue;
    }
    if (apply) {
      await prisma.eventVenue.update({
        where: { id: venue.id },
        data: {
          seatMapConfig: checked.config as object,
          seatMapStatus: "draft",
          seatMapSource: "research",
          seatMapPlanUrl: planUrl,
          seatMapUpdatedBy: "research draft (Claude)",
          seatMapUpdatedAt: new Date(),
        },
      });
    }
    console.log(`✓ ${venueName}: ${apply ? "saved as draft" : "would save as draft"} (${config.layout ?? "bowl-end-stage"})`);
  }
  console.log("\nNo seating plan found:");
  for (const v of NOT_FOUND_VENUES) console.log(`  · ${v.venueName} — ${v.reason}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
