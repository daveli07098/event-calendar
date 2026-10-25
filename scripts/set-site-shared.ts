/**
 * Mark (or unmark) an owner's calendars as site-wide shared, read-only calendars.
 * Every signed-in user is auto-joined as a viewer (see src/lib/site-calendar.ts).
 *
 * Run: npx tsx scripts/set-site-shared.ts --email <owner> [--names event-reminders,sale-ticket] [--off] [--dry-run]
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";
import { randomBytes } from "crypto";

dotenv.config({ path: ".env.local" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  if (!email) {
    console.error("Usage: tsx scripts/set-site-shared.ts --email <owner> [--names a,b] [--off] [--dry-run]");
    process.exit(1);
  }
  const names = (arg("names") ?? "event-reminders,sale-ticket").split(",").map((s) => s.trim()).filter(Boolean);
  const off = process.argv.includes("--off");
  const dryRun = process.argv.includes("--dry-run");

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No user with email ${email}`);

    const calendars = await prisma.calendar.findMany({ where: { userId: user.id, name: { in: names } } });
    if (calendars.length === 0) console.log(`No calendars named ${names.join(", ")} for ${email}`);

    for (const cal of calendars) {
      if (off) {
        console.log(`${dryRun ? "[dry-run] " : ""}${cal.name} (${cal.id}): isSiteShared -> false (members and share settings kept)`);
        if (!dryRun) await prisma.calendar.update({ where: { id: cal.id }, data: { isSiteShared: false } });
        continue;
      }
      const data = {
        isSiteShared: true,
        shareMode: "broadcast",
        ...(cal.shareToken ? {} : { shareToken: randomBytes(16).toString("hex") }),
      };
      console.log(`${dryRun ? "[dry-run] " : ""}${cal.name} (${cal.id}): ${JSON.stringify({ ...data, shareToken: data.shareToken ? "<new>" : undefined })}`);
      if (cal.shareMode === "collaborative") {
        console.log(`  note: was collaborative; existing editors become viewers`);
        if (!dryRun) await prisma.calendarMember.updateMany({ where: { calendarId: cal.id, role: "editor" }, data: { role: "viewer" } });
      }
      if (!dryRun) await prisma.calendar.update({ where: { id: cal.id }, data });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
