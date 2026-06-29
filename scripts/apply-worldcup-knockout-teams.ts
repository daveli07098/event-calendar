/**
 * Rewrite knockout-stage event titles/descriptions from placeholder slots
 * ("32強 | A組亞軍 vs B組亞軍") to the REAL qualified teams, derived from the
 * verified group standings — so the calendar month/list views match the
 * "Road to Trophy" bracket (which already resolves teams on the fly).
 *
 * Source of truth: src/lib/worldcup-results.ts (verified group scorelines) +
 * resolveKnockout() in src/lib/worldcup.ts. Only Round-of-32 slots that are
 * mathematically CONFIRMED are rewritten; later rounds ("M73勝者") and any
 * still-provisional slot are left untouched. Idempotent — re-running changes
 * nothing once applied.
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
import {
  buildGroups,
  buildBracket,
  computeStandings,
  resolveKnockout,
  clinchedPositions,
  type MatchScore,
  type TeamStanding,
} from "../src/lib/worldcup";
import { mergeVerifiedGroups } from "../src/lib/worldcup-results";
import type { EventType } from "../src/types";

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
    where: { calendarId: { in: calIds }, description: { contains: "FIFA 世界盃" } },
    orderBy: { startTime: "asc" },
  });
  // Adapt DB rows to the EventType shape the parsers read.
  const events: EventType[] = rows.map((r) => ({
    id: r.id,
    calendarId: r.calendarId,
    title: r.title,
    description: r.description,
    location: r.location,
    startTime: r.startTime.toISOString(),
    endTime: r.endTime.toISOString(),
    allDay: r.allDay,
    recurrenceRule: r.recurrenceRule,
    googleEventId: r.googleEventId,
    category: r.category as EventType["category"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
  console.log(`Loaded ${events.length} World Cup events`);

  // Build group standings with verified scores layered on top.
  const groups = buildGroups(events);
  const perGroupSnap: Record<string, { standings: TeamStanding[]; matches: MatchScore[] }> = {};
  for (const g of groups) {
    const matches: MatchScore[] = g.matches.map((m) => ({
      home: m.home, away: m.away, homeScore: null, awayScore: null,
    }));
    perGroupSnap[g.group] = { matches, standings: computeStandings(g.teams, matches) };
  }
  mergeVerifiedGroups(perGroupSnap);
  const perGroup: Record<string, TeamStanding[]> = {};
  for (const [g, v] of Object.entries(perGroupSnap)) perGroup[g] = v.standings;

  // Early-clinch per group (lets confirmed winners/runners-up resolve).
  const clinch: Record<string, { first: string | null; second: string | null }> = {};
  for (const g of groups) {
    const fixtures = g.matches.map((m) => ({ home: m.home, away: m.away }));
    const c = clinchedPositions(g.teams, fixtures, perGroupSnap[g.group].matches);
    clinch[g.group] = { first: c.first, second: c.second };
  }

  const r32 = buildBracket(events).find((r) => r.round === "R32")?.matches ?? [];
  const resolved = resolveKnockout(r32, perGroup, clinch);

  let planned = 0, skipped = 0, unchanged = 0;
  for (const match of r32) {
    const slots = resolved[match.eventId];
    const home = slots?.home, away = slots?.away;
    // Only rewrite when BOTH sides are resolved AND confirmed (locked).
    if (!home?.team || !away?.team || !home.confirmed || !away.confirmed) {
      skipped++;
      console.log(`  · skip M${match.matchId} (${match.home} vs ${match.away}) — not confirmed yet`);
      continue;
    }
    const ev = events.find((e) => e.id === match.eventId)!;
    const newTitle = buildUpdatedTitle(ev.title, home.team, away.team);
    const newDesc = buildUpdatedDescription(ev.description ?? "", home.team, away.team);
    if (newTitle === ev.title && newDesc === (ev.description ?? "")) {
      unchanged++;
      continue;
    }
    planned++;
    console.log(`  ✎ M${match.matchId}: "${ev.title}"  →  "${newTitle}"`);
    if (APPLY) {
      await prisma.event.update({ where: { id: ev.id }, data: { title: newTitle, description: newDesc } });
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"} ${planned} rewrite(s); ${unchanged} already correct; ${skipped} not yet confirmed.`,
  );
  if (!APPLY && planned > 0) console.log("Re-run with --apply to write these changes.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
