/**
 * Seed script: create "world cup" calendar for dave22dave22@gmail.com
 * and insert all 72 FIFA World Cup 2026 group stage matches with Chinese team names.
 *
 * Run: npx tsx scripts/seed-worldcup.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// UTC start times for each match (endTime = startTime + 2h)
// Format: [group, homeZh, awayZh, utcStart, venue]
const MATCHES: Array<[string, string, string, string, string]> = [
  // ── Group A ──
  ["A組", "墨西哥", "南非",   "2026-06-11T19:00:00Z", "Estadio Azteca, 墨西哥城"],
  ["A組", "韓國",   "捷克",   "2026-06-12T02:00:00Z", "Estadio Akron, 薩波潘"],
  ["A組", "捷克",   "南非",   "2026-06-18T16:00:00Z", "Mercedes-Benz Stadium, 亞特蘭大"],
  ["A組", "墨西哥", "韓國",   "2026-06-19T01:00:00Z", "Estadio Akron, 薩波潘"],
  ["A組", "捷克",   "墨西哥", "2026-06-25T01:00:00Z", "Estadio Azteca, 墨西哥城"],
  ["A組", "南非",   "韓國",   "2026-06-25T01:00:00Z", "Estadio BBVA, 蒙特雷"],

  // ── Group B ──
  ["B組", "加拿大", "波赫",   "2026-06-12T19:00:00Z", "BMO Field, 多倫多"],
  ["B組", "卡達",   "瑞士",   "2026-06-13T19:00:00Z", "Levi's Stadium, 聖克拉拉"],
  ["B組", "瑞士",   "波赫",   "2026-06-18T19:00:00Z", "SoFi Stadium, 英格爾伍德"],
  ["B組", "加拿大", "卡達",   "2026-06-18T22:00:00Z", "BC Place, 溫哥華"],
  ["B組", "瑞士",   "加拿大", "2026-06-24T19:00:00Z", "BC Place, 溫哥華"],
  ["B組", "波赫",   "卡達",   "2026-06-24T19:00:00Z", "Lumen Field, 西雅圖"],

  // ── Group C ──
  ["C組", "巴西",   "摩洛哥", "2026-06-13T22:00:00Z", "MetLife Stadium, 東盧瑟福"],
  ["C組", "海地",   "蘇格蘭", "2026-06-14T01:00:00Z", "Gillette Stadium, 福克斯伯勒"],
  ["C組", "蘇格蘭", "摩洛哥", "2026-06-19T22:00:00Z", "Gillette Stadium, 福克斯伯勒"],
  ["C組", "巴西",   "海地",   "2026-06-20T00:30:00Z", "Lincoln Financial Field, 費城"],
  ["C組", "蘇格蘭", "巴西",   "2026-06-24T22:00:00Z", "Hard Rock Stadium, 邁阿密花園"],
  ["C組", "摩洛哥", "海地",   "2026-06-24T22:00:00Z", "Mercedes-Benz Stadium, 亞特蘭大"],

  // ── Group D ──
  ["D組", "美國",   "巴拉圭", "2026-06-13T01:00:00Z", "SoFi Stadium, 英格爾伍德"],
  ["D組", "澳洲",   "土耳其", "2026-06-14T04:00:00Z", "BC Place, 溫哥華"],
  ["D組", "美國",   "澳洲",   "2026-06-19T19:00:00Z", "Lumen Field, 西雅圖"],
  ["D組", "土耳其", "巴拉圭", "2026-06-20T03:00:00Z", "Levi's Stadium, 聖克拉拉"],
  ["D組", "土耳其", "美國",   "2026-06-26T02:00:00Z", "SoFi Stadium, 英格爾伍德"],
  ["D組", "巴拉圭", "澳洲",   "2026-06-26T02:00:00Z", "Levi's Stadium, 聖克拉拉"],

  // ── Group E ──
  ["E組", "德國",     "庫拉索",   "2026-06-14T17:00:00Z", "NRG Stadium, 休斯頓"],
  ["E組", "科特迪瓦", "厄瓜多",   "2026-06-14T23:00:00Z", "Lincoln Financial Field, 費城"],
  ["E組", "德國",     "科特迪瓦", "2026-06-20T20:00:00Z", "BMO Field, 多倫多"],
  ["E組", "厄瓜多",   "庫拉索",   "2026-06-21T00:00:00Z", "Arrowhead Stadium, 堪薩斯城"],
  ["E組", "庫拉索",   "科特迪瓦", "2026-06-25T20:00:00Z", "Lincoln Financial Field, 費城"],
  ["E組", "厄瓜多",   "德國",     "2026-06-25T20:00:00Z", "MetLife Stadium, 東盧瑟福"],

  // ── Group F ──
  ["F組", "荷蘭",   "日本",   "2026-06-14T20:00:00Z", "AT&T Stadium, 阿靈頓"],
  ["F組", "瑞典",   "突尼斯", "2026-06-15T02:00:00Z", "Estadio BBVA, 蒙特雷"],
  ["F組", "荷蘭",   "瑞典",   "2026-06-20T17:00:00Z", "Estadio BBVA, 蒙特雷"],
  ["F組", "突尼斯", "日本",   "2026-06-21T04:00:00Z", "NRG Stadium, 休斯頓"],
  ["F組", "日本",   "瑞典",   "2026-06-25T23:00:00Z", "Estadio BBVA, 蒙特雷"],
  ["F組", "突尼斯", "荷蘭",   "2026-06-25T23:00:00Z", "AT&T Stadium, 阿靈頓"],

  // ── Group G ──
  ["G組", "比利時", "埃及",   "2026-06-15T19:00:00Z", "Lumen Field, 西雅圖"],
  ["G組", "伊朗",   "紐西蘭", "2026-06-16T01:00:00Z", "SoFi Stadium, 英格爾伍德"],
  ["G組", "比利時", "伊朗",   "2026-06-21T19:00:00Z", "SoFi Stadium, 英格爾伍德"],
  ["G組", "紐西蘭", "埃及",   "2026-06-22T01:00:00Z", "BC Place, 溫哥華"],
  ["G組", "埃及",   "伊朗",   "2026-06-27T03:00:00Z", "BC Place, 溫哥華"],
  ["G組", "紐西蘭", "比利時", "2026-06-27T03:00:00Z", "Lumen Field, 西雅圖"],

  // ── Group H ──
  ["H組", "西班牙",     "佛得角",   "2026-06-15T16:00:00Z", "Mercedes-Benz Stadium, 亞特蘭大"],
  ["H組", "沙特阿拉伯", "烏拉圭",   "2026-06-15T22:00:00Z", "Hard Rock Stadium, 邁阿密花園"],
  ["H組", "西班牙",     "沙特阿拉伯","2026-06-21T16:00:00Z", "Hard Rock Stadium, 邁阿密花園"],
  ["H組", "烏拉圭",     "佛得角",   "2026-06-21T22:00:00Z", "Mercedes-Benz Stadium, 亞特蘭大"],
  ["H組", "佛得角",     "沙特阿拉伯","2026-06-27T00:00:00Z", "NRG Stadium, 休斯頓"],
  ["H組", "烏拉圭",     "西班牙",   "2026-06-27T00:00:00Z", "Estadio Akron, 薩波潘"],

  // ── Group I ──
  ["I組", "法國",   "塞內加爾", "2026-06-16T19:00:00Z", "MetLife Stadium, 東盧瑟福"],
  ["I組", "伊拉克", "挪威",     "2026-06-16T22:00:00Z", "Gillette Stadium, 福克斯伯勒"],
  ["I組", "法國",   "伊拉克",   "2026-06-22T21:00:00Z", "Gillette Stadium, 福克斯伯勒"],
  ["I組", "挪威",   "塞內加爾", "2026-06-23T00:00:00Z", "Lincoln Financial Field, 費城"],
  ["I組", "挪威",   "法國",     "2026-06-26T19:00:00Z", "MetLife Stadium, 東盧瑟福"],
  ["I組", "塞內加爾","伊拉克",  "2026-06-26T19:00:00Z", "BMO Field, 多倫多"],

  // ── Group J ──
  ["J組", "阿根廷",   "阿爾及利亞", "2026-06-17T01:00:00Z", "Arrowhead Stadium, 堪薩斯城"],
  ["J組", "奧地利",   "約旦",       "2026-06-17T04:00:00Z", "Levi's Stadium, 聖克拉拉"],
  ["J組", "阿根廷",   "奧地利",     "2026-06-22T17:00:00Z", "AT&T Stadium, 阿靈頓"],
  ["J組", "約旦",     "阿爾及利亞", "2026-06-23T01:00:00Z", "AT&T Stadium, 阿靈頓"],
  ["J組", "阿爾及利亞","奧地利",    "2026-06-28T02:00:00Z", "Arrowhead Stadium, 堪薩斯城"],
  ["J組", "約旦",     "阿根廷",     "2026-06-28T02:00:00Z", "Levi's Stadium, 聖克拉拉"],

  // ── Group K ──
  ["K組", "葡萄牙",       "剛果民主共和國", "2026-06-17T17:00:00Z", "NRG Stadium, 休斯頓"],
  ["K組", "烏茲別克",     "哥倫比亞",       "2026-06-18T02:00:00Z", "Estadio Azteca, 墨西哥城"],
  ["K組", "葡萄牙",       "烏茲別克",       "2026-06-23T17:00:00Z", "NRG Stadium, 休斯頓"],
  ["K組", "哥倫比亞",     "剛果民主共和國", "2026-06-24T02:00:00Z", "Estadio Akron, 薩波潘"],
  ["K組", "哥倫比亞",     "葡萄牙",         "2026-06-27T23:30:00Z", "Hard Rock Stadium, 邁阿密花園"],
  ["K組", "剛果民主共和國","烏茲別克",      "2026-06-27T23:30:00Z", "Mercedes-Benz Stadium, 亞特蘭大"],

  // ── Group L ──
  ["L組", "英格蘭", "克羅地亞", "2026-06-17T20:00:00Z", "AT&T Stadium, 阿靈頓"],
  ["L組", "加納",   "巴拿馬",   "2026-06-17T23:00:00Z", "BMO Field, 多倫多"],
  ["L組", "英格蘭", "加納",     "2026-06-23T20:00:00Z", "BMO Field, 多倫多"],
  ["L組", "巴拿馬", "克羅地亞", "2026-06-23T23:00:00Z", "Gillette Stadium, 福克斯伯勒"],
  ["L組", "巴拿馬", "英格蘭",   "2026-06-27T21:00:00Z", "MetLife Stadium, 東盧瑟福"],
  ["L組", "克羅地亞","加納",    "2026-06-27T21:00:00Z", "Lincoln Financial Field, 費城"],
];

async function main() {
  // 1. Find the user
  const user = await prisma.user.findUnique({ where: { email: "dave22dave22@gmail.com" } });
  if (!user) throw new Error("User dave22dave22@gmail.com not found");
  console.log(`Found user: ${user.name ?? user.email} (${user.id})`);

  // 2. Create the "world cup" calendar (green)
  const calendar = await prisma.calendar.create({
    data: {
      userId: user.id,
      name: "world cup",
      color: "#27AE60",
      isDefault: false,
      isVisible: true,
    },
  });
  console.log(`Created calendar: ${calendar.name} (${calendar.id})`);

  // 3. Create all matches
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const events = MATCHES.map(([group, home, away, utcStart, venue]) => {
    const startTime = new Date(utcStart);
    const endTime   = new Date(startTime.getTime() + TWO_HOURS);
    return {
      calendarId: calendar.id,
      title: `${group} ${home} vs ${away}`,
      location: venue,
      description: `2026 FIFA 世界盃 | ${group} | ${home} vs ${away}`,
      startTime,
      endTime,
      allDay: false,
      category: "sports",
    };
  });

  const result = await prisma.event.createMany({ data: events });
  console.log(`Created ${result.count} events`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
