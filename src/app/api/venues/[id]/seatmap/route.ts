import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateSeatMapConfig } from "@/lib/venue-seatmap/validate";

const VALID_STATUSES = new Set(["draft", "approved"]);
const VALID_SOURCES = new Set(["ai-draft", "research", "user"]);

/**
 * PUT /api/venues/[id]/seatmap — save (create or overwrite) a venue's seat-map config.
 * Body: { config: unknown, status: "draft" | "approved", source?: "ai-draft" | "research" | "user" }
 * Validates `config` via validateSeatMapConfig before writing anything; a validation failure
 * writes nothing and returns 400 with the full list of errors.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const venue = await prisma.eventVenue.findUnique({ where: { id }, select: { id: true } });
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 404 });

  let body: { config?: unknown; status?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, source } = body;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: 'status must be "draft" or "approved"' }, { status: 400 });
  }
  if (source !== undefined && (typeof source !== "string" || !VALID_SOURCES.has(source))) {
    return NextResponse.json({ error: 'source must be one of "ai-draft", "research", "user"' }, { status: 400 });
  }

  const validated = validateSeatMapConfig(body.config);
  if (!validated.ok) {
    return NextResponse.json({ error: "Invalid seat-map config", errors: validated.errors }, { status: 400 });
  }

  const updatedBy = session.user.email ?? session.user.id;
  const updatedAt = new Date();
  const resolvedSource = typeof source === "string" ? source : "user";

  const updated = await prisma.eventVenue.update({
    where: { id },
    data: {
      seatMapConfig: validated.config as unknown as Prisma.InputJsonObject,
      seatMapStatus: status,
      seatMapSource: resolvedSource,
      seatMapUpdatedBy: updatedBy,
      seatMapUpdatedAt: updatedAt,
    },
    select: {
      id: true,
      seatMapConfig: true,
      seatMapStatus: true,
      seatMapSource: true,
      seatMapPlanUrl: true,
      seatMapUpdatedBy: true,
      seatMapUpdatedAt: true,
    },
  });

  return NextResponse.json({
    venueId: updated.id,
    config: updated.seatMapConfig,
    status: updated.seatMapStatus,
    source: updated.seatMapSource,
    planUrl: updated.seatMapPlanUrl,
    updatedBy: updated.seatMapUpdatedBy,
    updatedAt: updated.seatMapUpdatedAt ? updated.seatMapUpdatedAt.toISOString() : null,
  });
}

/**
 * DELETE /api/venues/[id]/seatmap — clears every seatMap* field on the venue (config, status,
 * source, plan url, and the updatedBy/updatedAt audit fields), returning it to a venue with no
 * seat-map coverage at all.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const venue = await prisma.eventVenue.findUnique({ where: { id }, select: { id: true } });
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 404 });

  await prisma.eventVenue.update({
    where: { id },
    data: {
      seatMapConfig: Prisma.DbNull,
      seatMapStatus: null,
      seatMapSource: null,
      seatMapPlanUrl: null,
      seatMapUpdatedBy: null,
      seatMapUpdatedAt: null,
    },
  });

  return NextResponse.json({ ok: true });
}
