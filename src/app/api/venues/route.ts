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

  // 1. Filter out TBD / placeholder venues
  const nonTbd = venues.filter((v) => !v.name.startsWith("地點待定"));

  // 2. Deduplicate "X, Y" entries where "X" (base name) also exists — show only the base
  const nameSet = new Set(nonTbd.map((v) => v.name.toLowerCase()));
  const deduped = nonTbd.filter((v) => {
    const commaIdx = v.name.indexOf(",");
    if (commaIdx > 0) {
      const baseName = v.name.slice(0, commaIdx).trim().toLowerCase();
      if (nameSet.has(baseName)) return false; // suppress "X, Y" if "X" exists
    }
    return true;
  });

  return NextResponse.json(deduped);
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

  // Extract venue names (and optional addresses) from event location field + "Venue: …" lines.
  // A location field may be "Venue Name, Street Address" — split on first comma so both
  // variants ("Venue Name" and "Venue Name, Street Address") aren't created as separate entries.
  const nameToAddress = new Map<string, string | null>();
  for (const ev of events) {
    if (ev.location?.trim()) {
      const loc = ev.location.trim();
      // Skip TBD / placeholder venues
      if (loc.startsWith("地點待定")) continue;
      const commaIdx = loc.indexOf(",");
      const venueName = commaIdx > 0 ? loc.slice(0, commaIdx).trim() : loc;
      const venueAddress = commaIdx > 0 ? loc.slice(commaIdx + 1).trim() || null : null;
      if (venueName) {
        // Keep address if we already have one, or set it if newly found
        if (!nameToAddress.has(venueName) || (!nameToAddress.get(venueName) && venueAddress)) {
          nameToAddress.set(venueName, venueAddress);
        }
      }
    }
    const fromDesc = ev.description?.match(/^Venue:\s*(.+)$/m)?.[1]?.trim();
    if (fromDesc && !fromDesc.startsWith("地點待定") && !nameToAddress.has(fromDesc)) {
      nameToAddress.set(fromDesc, null);
    }
  }

  if (nameToAddress.size === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  // Load existing venues to detect duplicates and clean up bad "name, address" entries
  const existing = await prisma.eventVenue.findMany({ select: { id: true, name: true, address: true } });
  const existingByName = new Map(existing.map((v) => [v.name.toLowerCase(), v]));

  // Cleanup pass 1: delete all "地點待定" placeholder venues
  const tbdIds = existing.filter((v) => v.name.startsWith("地點待定")).map((v) => v.id);
  if (tbdIds.length > 0) {
    await prisma.eventVenue.deleteMany({ where: { id: { in: tbdIds } } });
    for (const v of existing.filter((v) => v.name.startsWith("地點待定"))) {
      existingByName.delete(v.name.toLowerCase());
    }
  }

  // Cleanup pass 2: venues whose name is "X, Y" where "X" also exists → merge address onto X, delete "X, Y"
  // Also handles the reverse: "X, Y" was created first, then "X" added → delete "X, Y"
  const toDelete: string[] = [];
  for (const v of existing) {
    if (tbdIds.includes(v.id)) continue; // already removed
    const commaIdx = v.name.indexOf(",");
    if (commaIdx > 0) {
      const baseName = v.name.slice(0, commaIdx).trim();
      const addr = v.name.slice(commaIdx + 1).trim() || null;
      const base = existingByName.get(baseName.toLowerCase());
      if (base) {
        if (!base.address && addr) {
          await prisma.eventVenue.update({ where: { id: base.id }, data: { address: addr } });
          base.address = addr; // update local cache
        }
        toDelete.push(v.id);
        existingByName.delete(v.name.toLowerCase()); // remove from lookup so it's not counted as existing
      }
    }
  }
  if (toDelete.length > 0) {
    await prisma.eventVenue.deleteMany({ where: { id: { in: toDelete } } });
  }

  let imported = 0;
  let skipped = 0;
  for (const [name, address] of nameToAddress) {
    if (existingByName.has(name.toLowerCase())) {
      skipped++;
      continue;
    }
    await prisma.eventVenue.create({
      data: { name, address: address ?? null, city: "Hong Kong", country: "HK" },
    });
    existingByName.set(name.toLowerCase(), { id: "", name, address: address ?? null });
    imported++;
  }

  return NextResponse.json({ imported, skipped, cleaned: toDelete.length });
}
