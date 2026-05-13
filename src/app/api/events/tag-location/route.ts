import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Known location keywords → canonical country/city tag
// ---------------------------------------------------------------------------
const LOCATION_RULES: Array<[RegExp, string]> = [
  // Hong Kong (check before China since HK is a separate region)
  [/hong kong|香港|hk\b|hksar/i, "Hong Kong"],
  // Macau
  [/macau|macao|澳門/i, "Macau"],
  // Taiwan
  [/taiwan|taipei|臺灣|台灣|台北|taichung|台中|kaohsiung|高雄/i, "Taiwan"],
  // Japan cities
  [/japan|tokyo|osaka|kyoto|nagoya|yokohama|sapporo|fukuoka|日本|東京|大阪|京都|名古屋|橫濱|札幌|福岡/i, "Japan"],
  // Korea
  [/korea|seoul|busan|韓國|首爾|釜山/i, "South Korea"],
  // Singapore
  [/singapore|新加坡/i, "Singapore"],
  // Thailand
  [/thailand|bangkok|泰國|曼谷/i, "Thailand"],
  // China (mainland — after HK/TW/MO)
  [/\bchina\b|beijing|shanghai|shenzhen|guangzhou|chengdu|中國|北京|上海|深圳|廣州|成都/i, "China"],
  // UK
  [/\buk\b|united kingdom|london|manchester|birmingham|英國|倫敦/i, "United Kingdom"],
  // USA
  [/\busa\b|\bus\b|united states|new york|los angeles|chicago|houston|美國|紐約|洛杉磯/i, "United States"],
  // Australia
  [/australia|sydney|melbourne|澳洲|澳大利亞/i, "Australia"],
  // Canada
  [/canada|toronto|vancouver|加拿大/i, "Canada"],
  // Malaysia
  [/malaysia|kuala lumpur|馬來西亞|吉隆坡/i, "Malaysia"],
  // Philippines
  [/philippines|manila|菲律賓|馬尼拉/i, "Philippines"],
  // Indonesia
  [/indonesia|jakarta|印尼|雅加達/i, "Indonesia"],
  // France
  [/france|paris|法國|巴黎/i, "France"],
  // Germany
  [/germany|berlin|德國|柏林/i, "Germany"],
];

/** Detect country from event's existing location field or title. Returns null if no match. */
function detectCountry(title: string, location: string | null): string | null {
  const haystack = `${title} ${location ?? ""}`;
  for (const [re, country] of LOCATION_RULES) {
    if (re.test(haystack)) return country;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET — return location distribution counts
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId: session.user.id }, select: { id: true } }),
    prisma.calendarMember.findMany({ where: { userId: session.user.id }, select: { calendarId: true } }),
  ]);
  const calIds = [...owned.map((c) => c.id), ...memberships.map((m) => m.calendarId)];

  const events = await prisma.event.findMany({
    where: { calendarId: { in: calIds } },
    select: { id: true, title: true, location: true },
  });

  const countryCounts: Record<string, number> = {};
  let untagged = 0;
  for (const ev of events) {
    const c = detectCountry(ev.title, ev.location);
    if (c) countryCounts[c] = (countryCounts[c] ?? 0) + 1;
    else untagged++;
  }

  return NextResponse.json({ counts: countryCounts, untagged, total: events.length });
}

// ---------------------------------------------------------------------------
// POST — tag location for events (rule-based, no AI quota used)
// Body: { onlyUntagged?: boolean; calendarIds?: string[] }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { onlyUntagged?: boolean; calendarIds?: string[] };
  const onlyUntagged = body.onlyUntagged !== false; // default true

  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId: session.user.id }, select: { id: true } }),
    prisma.calendarMember.findMany({ where: { userId: session.user.id }, select: { calendarId: true } }),
  ]);
  const accessibleCalIds = new Set([...owned.map((c) => c.id), ...memberships.map((m) => m.calendarId)]);

  let calIds: string[];
  if (body.calendarIds?.length) {
    calIds = body.calendarIds.filter((id) => accessibleCalIds.has(id));
    if (calIds.length === 0) {
      return NextResponse.json({ error: "No accessible calendars in the provided list" }, { status: 403 });
    }
  } else {
    calIds = [...accessibleCalIds];
  }

  const events = await prisma.event.findMany({
    where: {
      calendarId: { in: calIds },
      // "onlyUntagged" means location is null OR location doesn't contain a country tag
      // We can't easily filter by regex in DB, so we fetch all and apply in-process
    },
    select: { id: true, title: true, location: true },
    orderBy: { startTime: "asc" },
  });

  // Apply rule-based detection
  let updatedCount = 0;
  const updates: Array<{ id: string; country: string }> = [];
  for (const ev of events) {
    const country = detectCountry(ev.title, ev.location);
    if (!country) continue;
    // If onlyUntagged: skip events whose existing location already contains a known country tag
    if (onlyUntagged) {
      const existing = LOCATION_RULES.find(([, tag]) => ev.location?.includes(tag));
      if (existing) continue; // already has a country tag
    }
    // Build new location: prepend country tag if not already in location
    const hasTag = LOCATION_RULES.some(([, tag]) => ev.location?.includes(tag));
    if (!hasTag) {
      // Keep existing location suffix, prepend country
      const newLocation = ev.location
        ? `${country}, ${ev.location}`
        : country;
      updates.push({ id: ev.id, country: newLocation });
    } else if (!onlyUntagged) {
      // Re-tag mode: replace any country prefix
      const base = ev.location ?? "";
      // Strip any existing country tag (first segment before ", ")
      const stripped = LOCATION_RULES.reduce((acc, [re, tag]) => {
        return acc.startsWith(tag) ? acc.slice(tag.length).replace(/^,\s*/, "") : acc;
      }, base);
      const newLocation = stripped ? `${country}, ${stripped}` : country;
      updates.push({ id: ev.id, country: newLocation });
    }
  }

  // Batch update
  await Promise.all(
    updates.map(({ id, country }) =>
      prisma.event.update({ where: { id }, data: { location: country } })
    )
  );
  updatedCount = updates.length;

  return NextResponse.json({
    updated: updatedCount,
    total: events.length,
    message: updatedCount > 0
      ? `Tagged ${updatedCount} of ${events.length} event(s) with location.`
      : "No events needed location tagging.",
  });
}
