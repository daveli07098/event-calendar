import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { VenueSeatMapConfig } from "@/lib/venue-seatmap/types";

export interface VenueSeatMapListEntry {
  venueId: string;
  venueName: string;
  aliases: string[];
  status: string | null;
  source: string | null;
  planUrl: string | null;
  updatedAt: string | null;
  config: VenueSeatMapConfig | null;
}

/**
 * GET /api/venues/seatmaps — every community venue that has a saved seat-map config and/or an
 * uploaded seating-plan URL, for the review UI. Venues with neither are omitted entirely
 * (they're indistinguishable from any other venue in the directory).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const venues = await prisma.eventVenue.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      aliases: true,
      seatMapConfig: true,
      seatMapStatus: true,
      seatMapSource: true,
      seatMapPlanUrl: true,
      seatMapUpdatedAt: true,
    },
  });

  const result: VenueSeatMapListEntry[] = venues
    .filter((v) => v.seatMapConfig != null || v.seatMapPlanUrl != null)
    .map((v) => ({
      venueId: v.id,
      venueName: v.name,
      aliases: v.aliases,
      status: v.seatMapStatus,
      source: v.seatMapSource,
      planUrl: v.seatMapPlanUrl,
      updatedAt: v.seatMapUpdatedAt ? v.seatMapUpdatedAt.toISOString() : null,
      config: (v.seatMapConfig as VenueSeatMapConfig | null) ?? null,
    }));

  return NextResponse.json({ venues: result });
}
