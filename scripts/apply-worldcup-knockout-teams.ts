/**
 * Rewrite knockout-stage calendar event titles/descriptions from placeholder
 * slots ("32強 | A組亞軍 vs B組亞軍") to the REAL qualified teams, so the calendar
 * month/list/search views match the "Road to Trophy" bracket.
 *
 * Source of truth: VERIFIED_KNOCKOUT_TEAMS in src/lib/worldcup-results.ts — the
 * official Round-of-32 matchups (zh-yue bracket) keyed by FIFA match number.
 * Only R32 matches (73–88) are rewritten; later rounds keep their "M73勝者"
 * placeholders until winners are known (no winner-propagation yet). Idempotent —
 * re-running changes nothing once applied.
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
import { getKnockoutTeams } from "../src/lib/worldcup-results";

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
    orderBy: { startTime: "asc" },
  });
  console.log(`Loaded ${rows.length} knockout events`);

  let planned = 0, skipped = 0, unchanged = 0;
  for (const ev of rows) {
    const matchId = Number(ev.description?.match(/World Cup Match ID:\s*(\d+)/)?.[1]);
    const teams = Number.isFinite(matchId) ? getKnockoutTeams(matchId) : undefined;
    if (!teams) {
      skipped++; // later-round placeholder (M73勝者…) or no verified matchup
      continue;
    }
    const newTitle = buildUpdatedTitle(ev.title, teams.home, teams.away);
    const newDesc = buildUpdatedDescription(ev.description ?? "", teams.home, teams.away);
    if (newTitle === ev.title && newDesc === (ev.description ?? "")) {
      unchanged++;
      continue;
    }
    planned++;
    console.log(`  ✎ M${matchId}: "${ev.title}"  →  "${newTitle}"`);
    if (APPLY) {
      await prisma.event.update({ where: { id: ev.id }, data: { title: newTitle, description: newDesc } });
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"} ${planned} rewrite(s); ${unchanged} already correct; ${skipped} later-round placeholders left as-is.`,
  );
  if (!APPLY && planned > 0) console.log("Re-run with --apply to write these changes.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
