import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
// Rules shared with CalendarView's location filter — counts and filtering must agree.
import { LOCATION_RULES, detectLocationTag as detectCountry } from "@/lib/location-tags";

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
    // If onlyUntagged: skip events that already have a country tag OR whose location
    // already contains enough country context (matched by the detection regex itself).
    // This prevents double-tagging e.g. "Japan, 東京アニメセンター" on a second run,
    // and also skips events like "東京アニメセンター, 渋谷モディ" that were already tagged
    // with "Japan, " prefix (location already starts with a LOCATION_RULES tag value).
    if (onlyUntagged) {
      const alreadyTagged = LOCATION_RULES.some(([, tag]) => ev.location?.startsWith(tag));
      if (alreadyTagged) continue; // already has a country prefix
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
