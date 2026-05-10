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
