/**
 * Seed script: add all 32 FIFA World Cup 2026 knockout stage matches
 * into the existing "world cup" calendar for dave22dave22@gmail.com.
 *
 * Events are seeded with placeholder team names (Chinese) since group
 * stage hasn't finished yet. Use the "Update Teams" sync feature in the
 * UI to refresh team names once group results are known.
 *
 * Run: npx tsx scripts/seed-worldcup-knockout.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Match data — UTC start times, venues, placeholder team names (Traditional Chinese)
// ---------------------------------------------------------------------------

interface KnockoutMatch {
  round: string;
  roundZh: string;
  matchId: number;
  team1: string;
  team2: string;
  utcStart: string;
  venue: string;
}

const MATCHES: KnockoutMatch[] = [
  // ── Round of 32 (June 28 – July 3) ──
  { round: "Round of 32", roundZh: "32強", matchId: 73,  team1: "A組亞軍",              team2: "B組亞軍",              utcStart: "2026-06-28T19:00:00Z", venue: "SoFi Stadium, 英格爾伍德" },
  { round: "Round of 32", roundZh: "32強", matchId: 76,  team1: "C組冠軍",              team2: "F組亞軍",              utcStart: "2026-06-29T17:00:00Z", venue: "NRG Stadium, 休斯頓" },
  { round: "Round of 32", roundZh: "32強", matchId: 74,  team1: "E組冠軍",              team2: "最佳第三名(ABCDF)",    utcStart: "2026-06-29T20:30:00Z", venue: "Gillette Stadium, 福克斯伯勒" },
  { round: "Round of 32", roundZh: "32強", matchId: 75,  team1: "F組冠軍",              team2: "C組亞軍",              utcStart: "2026-06-30T01:00:00Z", venue: "Estadio BBVA, 蒙特雷" },
  { round: "Round of 32", roundZh: "32強", matchId: 78,  team1: "E組亞軍",              team2: "I組亞軍",              utcStart: "2026-06-30T17:00:00Z", venue: "AT&T Stadium, 阿靈頓" },
  { round: "Round of 32", roundZh: "32強", matchId: 77,  team1: "I組冠軍",              team2: "最佳第三名(CDFGH)",    utcStart: "2026-06-30T21:00:00Z", venue: "MetLife Stadium, 東盧瑟福" },
  { round: "Round of 32", roundZh: "32強", matchId: 79,  team1: "A組冠軍",              team2: "最佳第三名(CEFHI)",    utcStart: "2026-07-01T01:00:00Z", venue: "Estadio Azteca, 墨西哥城" },
  { round: "Round of 32", roundZh: "32強", matchId: 80,  team1: "L組冠軍",              team2: "最佳第三名(EHIJK)",    utcStart: "2026-07-01T16:00:00Z", venue: "Mercedes-Benz Stadium, 亞特蘭大" },
  { round: "Round of 32", roundZh: "32強", matchId: 82,  team1: "G組冠軍",              team2: "最佳第三名(AEHIJ)",    utcStart: "2026-07-01T20:00:00Z", venue: "Lumen Field, 西雅圖" },
  { round: "Round of 32", roundZh: "32強", matchId: 81,  team1: "D組冠軍",              team2: "最佳第三名(BEFIJ)",    utcStart: "2026-07-02T00:00:00Z", venue: "Levi's Stadium, 聖克拉拉" },
  { round: "Round of 32", roundZh: "32強", matchId: 84,  team1: "H組冠軍",              team2: "J組亞軍",              utcStart: "2026-07-02T19:00:00Z", venue: "SoFi Stadium, 英格爾伍德" },
  { round: "Round of 32", roundZh: "32強", matchId: 83,  team1: "K組亞軍",              team2: "L組亞軍",              utcStart: "2026-07-02T23:00:00Z", venue: "BMO Field, 多倫多" },
  { round: "Round of 32", roundZh: "32強", matchId: 85,  team1: "B組冠軍",              team2: "最佳第三名(EFGIJ)",    utcStart: "2026-07-03T03:00:00Z", venue: "BC Place, 溫哥華" },
  { round: "Round of 32", roundZh: "32強", matchId: 88,  team1: "D組亞軍",              team2: "G組亞軍",              utcStart: "2026-07-03T18:00:00Z", venue: "AT&T Stadium, 阿靈頓" },
  { round: "Round of 32", roundZh: "32強", matchId: 86,  team1: "J組冠軍",              team2: "H組亞軍",              utcStart: "2026-07-03T22:00:00Z", venue: "Hard Rock Stadium, 邁阿密花園" },
  { round: "Round of 32", roundZh: "32強", matchId: 87,  team1: "K組冠軍",              team2: "最佳第三名(DEIJL)",    utcStart: "2026-07-04T01:30:00Z", venue: "Arrowhead Stadium, 堪薩斯城" },

  // ── Round of 16 (July 4 – 7) ──
  { round: "Round of 16", roundZh: "16強", matchId: 90,  team1: "M73勝者",              team2: "M75勝者",              utcStart: "2026-07-04T17:00:00Z", venue: "Lincoln Financial Field, 費城" },
  { round: "Round of 16", roundZh: "16強", matchId: 89,  team1: "M74勝者",              team2: "M77勝者",              utcStart: "2026-07-04T21:00:00Z", venue: "NRG Stadium, 休斯頓" },
  { round: "Round of 16", roundZh: "16強", matchId: 91,  team1: "M76勝者",              team2: "M78勝者",              utcStart: "2026-07-05T20:00:00Z", venue: "Lincoln Financial Field, 費城" },
  { round: "Round of 16", roundZh: "16強", matchId: 92,  team1: "M79勝者",              team2: "M80勝者",              utcStart: "2026-07-06T00:00:00Z", venue: "MetLife Stadium, 東盧瑟福" },
  { round: "Round of 16", roundZh: "16強", matchId: 93,  team1: "M83勝者",              team2: "M84勝者",              utcStart: "2026-07-06T19:00:00Z", venue: "Estadio Azteca, 墨西哥城" },
  { round: "Round of 16", roundZh: "16強", matchId: 94,  team1: "M81勝者",              team2: "M82勝者",              utcStart: "2026-07-07T00:00:00Z", venue: "AT&T Stadium, 阿靈頓" },
  { round: "Round of 16", roundZh: "16強", matchId: 95,  team1: "M86勝者",              team2: "M88勝者",              utcStart: "2026-07-07T16:00:00Z", venue: "Mercedes-Benz Stadium, 亞特蘭大" },
  { round: "Round of 16", roundZh: "16強", matchId: 96,  team1: "M85勝者",              team2: "M87勝者",              utcStart: "2026-07-07T20:00:00Z", venue: "BC Place, 溫哥華" },

  // ── Quarterfinals (July 9 – 11) ──
  { round: "Quarterfinal", roundZh: "8強",  matchId: 97,  team1: "M89勝者",              team2: "M90勝者",              utcStart: "2026-07-09T20:00:00Z", venue: "Gillette Stadium, 福克斯伯勒" },
  { round: "Quarterfinal", roundZh: "8強",  matchId: 98,  team1: "M93勝者",              team2: "M94勝者",              utcStart: "2026-07-10T19:00:00Z", venue: "SoFi Stadium, 英格爾伍德" },
  { round: "Quarterfinal", roundZh: "8強",  matchId: 99,  team1: "M91勝者",              team2: "M92勝者",              utcStart: "2026-07-11T21:00:00Z", venue: "Hard Rock Stadium, 邁阿密花園" },
  { round: "Quarterfinal", roundZh: "8強",  matchId: 100, team1: "M95勝者",              team2: "M96勝者",              utcStart: "2026-07-12T01:00:00Z", venue: "Arrowhead Stadium, 堪薩斯城" },

  // ── Semifinals (July 14 – 15) ──
  { round: "Semifinal",    roundZh: "4強",  matchId: 101, team1: "M97勝者",              team2: "M98勝者",              utcStart: "2026-07-14T19:00:00Z", venue: "AT&T Stadium, 阿靈頓" },
  { round: "Semifinal",    roundZh: "4強",  matchId: 102, team1: "M99勝者",              team2: "M100勝者",             utcStart: "2026-07-15T19:00:00Z", venue: "Mercedes-Benz Stadium, 亞特蘭大" },

  // ── Third place (July 18) ──
  { round: "Third place",  roundZh: "季軍賽", matchId: 103, team1: "M101敗者",            team2: "M102敗者",             utcStart: "2026-07-18T21:00:00Z", venue: "Hard Rock Stadium, 邁阿密花園" },

  // ── Final (July 19) ──
  { round: "Final",        roundZh: "決賽",   matchId: 104, team1: "M101勝者",            team2: "M102勝者",             utcStart: "2026-07-19T19:00:00Z", venue: "MetLife Stadium, 東盧瑟福" },
];

// ---------------------------------------------------------------------------

async function main() {
  // 1. Find the user
  const user = await prisma.user.findUnique({ where: { email: "dave22dave22@gmail.com" } });
  if (!user) throw new Error("User dave22dave22@gmail.com not found — run the group stage seed first.");
  console.log(`Found user: ${user.name ?? user.email} (${user.id})`);

  // 2. Find the existing "world cup" calendar (created by seed-worldcup.ts)
  const calendar = await prisma.calendar.findFirst({
    where: { userId: user.id, name: { contains: "world cup", mode: "insensitive" } },
  });
  if (!calendar) {
    throw new Error(
      "No 'world cup' calendar found. Run scripts/seed-worldcup.ts first to create it.",
    );
  }
  console.log(`Found calendar: "${calendar.name}" (${calendar.id})`);

  // 3. Find existing knockout event match IDs to skip duplicates
  const existingEvents = await prisma.event.findMany({
    where: {
      calendarId: calendar.id,
      description: { contains: "World Cup Match ID:" },
    },
    select: { description: true },
  });
  const existingMatchIds = new Set(
    existingEvents
      .map((e) => e.description?.match(/World Cup Match ID: (\d+)/)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  console.log(`Already seeded match IDs: ${[...existingMatchIds].join(", ") || "(none)"}`);

  // 4. Insert missing knockout events
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const toCreate = MATCHES.filter((m) => !existingMatchIds.has(m.matchId));

  if (toCreate.length === 0) {
    console.log("All knockout events already exist — nothing to do.");
    return;
  }

  const data = toCreate.map((m) => {
    const startTime = new Date(m.utcStart);
    const endTime   = new Date(startTime.getTime() + TWO_HOURS);
    return {
      calendarId: calendar.id,
      title: `${m.roundZh} | ${m.team1} vs ${m.team2}`,
      location: m.venue,
      description: [
        `2026 FIFA 世界盃 | ${m.roundZh} 第${m.matchId}場`,
        `${m.team1} vs ${m.team2}`,
        "",
        `World Cup Match ID: ${m.matchId}`,
        `Round: ${m.round}`,
        `Source: https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage`,
      ].join("\n"),
      startTime,
      endTime,
      allDay: false,
      category: "sports",
    };
  });

  const result = await prisma.event.createMany({ data });
  console.log(`✓ Created ${result.count} knockout stage events`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
