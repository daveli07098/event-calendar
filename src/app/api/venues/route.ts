import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const venues = await prisma.eventVenue.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, aliases: true, address: true, city: true, country: true, tags: true, createdAt: true },
  });
  return NextResponse.json(venues);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { name?: string; address?: string; city?: string; country?: string; tags?: string[]; aliases?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, address, city = "Hong Kong", country = "HK", tags = [], aliases = [] } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const venue = await prisma.eventVenue.create({
    data: { name: name.trim(), address: address?.trim() || null, city, country, tags, aliases },
  });
  return NextResponse.json(venue, { status: 201 });
}

/**
 * PUT /api/venues — import venues from the user's existing events.
 * Reads "Venue: ..." lines from event descriptions and upserts them to EventVenue.
 * Returns { imported, skipped }.
 */
export async function PUT() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uid = session.user.id;

  // Collect all unique venue names from the user's events
  const calendars = await prisma.calendar.findMany({
    where: { userId: uid },
    select: { id: true },
  });
  const calendarIds = calendars.map((c) => c.id);

  const events = await prisma.event.findMany({
    where: {
      calendarId: { in: calendarIds },
      OR: [
        { location: { not: null } },
        { description: { contains: "Venue:" } },
      ],
    },
    select: { location: true, description: true },
  });

  // Extract venue names from event location field + "Venue: …" lines in description
  const names = new Set<string>();
  for (const ev of events) {
    if (ev.location?.trim()) names.add(ev.location.trim());
    const fromDesc = ev.description?.match(/^Venue:\s*(.+)$/m)?.[1]?.trim();
    if (fromDesc) names.add(fromDesc);
  }

  if (names.size === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  // Load existing venue names to skip duplicates
  const existing = await prisma.eventVenue.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((v) => v.name.toLowerCase()));

  let imported = 0;
  let skipped = 0;
  for (const name of names) {
    if (existingNames.has(name.toLowerCase())) {
      skipped++;
      continue;
    }
    await prisma.eventVenue.create({
      data: { name, city: "Hong Kong", country: "HK" },
    });
    existingNames.add(name.toLowerCase());
    imported++;
  }

  return NextResponse.json({ imported, skipped });
}
