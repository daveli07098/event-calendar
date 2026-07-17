/**
 * Fix the knockout-stage calendar events to match the official bracket:
 *   • rename placeholder titles ("32強 | A組亞軍 vs B組亞軍") to the REAL teams
 *   • correct the kickoff TIME and VENUE (the seed's were tied to the old
 *     match-number mapping, so they no longer matched the real matchup)
 *
 * Sources of truth in src/lib/worldcup-results.ts: VERIFIED_KNOCKOUT_TEAMS (zh-yue
 * matchups, now R32→Final) + VERIFIED_KNOCKOUT_SCHEDULE (UTC kickoff + venue,
 * R32 only). Every match with verified teams is renamed; R32 also gets the
 * corrected time/venue. Idempotent — re-running changes nothing once applied.
 *
 * SAFE BY DEFAULT: dry run (prints planned changes) unless you pass --apply.
 *
 *   npx tsx scripts/apply-worldcup-knockout-teams.ts              # dry run
 *   npx tsx scripts/apply-worldcup-knockout-teams.ts --apply      # write
 *   npx tsx scripts/apply-worldcup-knockout-teams.ts --apply --email you@x.com
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";
import { getKnockoutTeams, VERIFIED_KNOCKOUT_SCHEDULE } from "../src/lib/worldcup-results";

const TWO_HOURS = 2 * 60 * 60 * 1000;

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const emailFlag = argv.indexOf("--email");
const EMAIL = emailFlag !== -1 ? argv[emailFlag + 1] : "dave22dave22@gmail.com";

// Mirror worldcup-sync's title/description rewriters so the on-disk format stays
// identical to what the "Update Teams" button produces.
function buildUpdatedTitle(currentTitle: string, team1: string, team2: string): string {
  const pipeIdx = currentTitle.indexOf("|");
  if (pipeIdx === -1) return `${currentTitle.split(" | ")[0]} | ${team1} vs ${team2}`;
  const prefix = currentTitle.slice(0, pipeIdx + 1).trim();
  return `${prefix} ${team1} vs ${team2}`;
}
function buildUpdatedDescription(currentDescription: string, team1: string, team2: string): string {
  const lines = currentDescription.split("\n");
  if (lines.length >= 2) lines[1] = `${team1} vs ${team2}`;
  return lines.join("\n");
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes — pass --apply to write)"}`);

  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error(`User ${EMAIL} not found (pass --email <addr>)`);
  console.log(`User: ${user.name ?? user.email} (${user.id})`);

  const cals = await prisma.calendar.findMany({ where: { userId: user.id }, select: { id: true } });
  const calIds = cals.map((c) => c.id);
  const rows = await prisma.event.findMany({
    where: { calendarId: { in: calIds }, description: { contains: "World Cup Match ID:" } },
    // Select only what we touch — avoids failing on schema-drift columns (e.g. a
    // schema `artist` field not yet migrated into this DB).
    select: { id: true, title: true, description: true, startTime: true, endTime: true, location: true },
    orderBy: { startTime: "asc" },
  });
  console.log(`Loaded ${rows.length} knockout events`);

  let planned = 0, skipped = 0, unchanged = 0;
  for (const ev of rows) {
    const matchId = Number(ev.description?.match(/World Cup Match ID:\s*(\d+)/)?.[1]);
    if (!Number.isFinite(matchId)) { skipped++; continue; }
    const teams = getKnockoutTeams(matchId);
    const sched = VERIFIED_KNOCKOUT_SCHEDULE[matchId];
    if (!teams && !sched) {
      skipped++; // later-round placeholder (M73勝者…) with no verified matchup/schedule
      continue;
    }

    const data: { title?: string; description?: string; startTime?: Date; endTime?: Date; location?: string } = {};
    const changes: string[] = [];

    if (teams) {
      const newTitle = buildUpdatedTitle(ev.title, teams.home, teams.away);
      const newDesc = buildUpdatedDescription(ev.description ?? "", teams.home, teams.away);
      if (newTitle !== ev.title) { data.title = newTitle; changes.push(`name "${ev.title}" → "${newTitle}"`); }
      if (newDesc !== (ev.description ?? "")) data.description = newDesc;
    }
    if (sched) {
      const start = new Date(sched.utcStart);
      if (ev.startTime.getTime() !== start.getTime()) {
        data.startTime = start;
        data.endTime = new Date(start.getTime() + TWO_HOURS);
        changes.push(`time → ${sched.utcStart}`);
      }
      if ((ev.location ?? "") !== sched.venue) { data.location = sched.venue; changes.push(`venue → ${sched.venue}`); }
    }

    if (Object.keys(data).length === 0) { unchanged++; continue; }
    planned++;
    console.log(`  ✎ M${matchId}: ${changes.join("; ")}`);
    if (APPLY) {
      // select:{id} keeps the UPDATE ... RETURNING clause off the missing column.
      await prisma.event.update({ where: { id: ev.id }, data, select: { id: true } });
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"} ${planned} update(s); ${unchanged} already correct; ${skipped} later-round placeholders left as-is.`,
  );
  if (!APPLY && planned > 0) console.log("Re-run with --apply to write these changes.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
