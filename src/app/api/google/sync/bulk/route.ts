import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { importGoogleCalendarEvents } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

interface BulkCalendarItem {
  googleCalendarId: string;
  name: string;
  color?: string;
}

// POST /api/google/sync/bulk
// Body: { calendars: BulkCalendarItem[] }
// Syncs all selected google calendars in one request.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { calendars } = body as { calendars: BulkCalendarItem[] };

  if (!Array.isArray(calendars) || calendars.length === 0) {
    return NextResponse.json({ error: "calendars array is required" }, { status: 400 });
  }

  const results: { name: string; importedEvents: number; error?: string }[] = [];

  for (const cal of calendars) {
    try {
      let localCal = await prisma.calendar.findFirst({
        where: { userId: session.user.id, googleCalendarId: cal.googleCalendarId },
      });

      if (!localCal) {
        localCal = await prisma.calendar.create({
          data: {
            userId: session.user.id,
            name: cal.name,
            color: cal.color || "#0f9d58",
            googleCalendarId: cal.googleCalendarId,
          },
        });
      }

      const imported = await importGoogleCalendarEvents(
        session.user.id,
        cal.googleCalendarId,
        localCal.id
      );

      results.push({ name: cal.name, importedEvents: imported });
    } catch {
      results.push({ name: cal.name, importedEvents: 0, error: "Failed to import" });
    }
  }

  return NextResponse.json({ results });
}
