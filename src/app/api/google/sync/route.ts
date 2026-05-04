import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  listGoogleCalendars,
  importGoogleCalendarEvents,
} from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const calendars = await listGoogleCalendars(session.user.id);
    return NextResponse.json(calendars);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[google/sync GET]", msg);
    return NextResponse.json(
      { error: "Failed to fetch Google calendars. Please reconnect your Google account.", detail: msg },
      { status: 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { googleCalendarId, name, color } = body;

  if (!googleCalendarId) {
    return NextResponse.json(
      { error: "googleCalendarId is required" },
      { status: 400 }
    );
  }

  try {
    // Create or find local calendar for this Google calendar
    let localCalendar = await prisma.calendar.findFirst({
      where: {
        userId: session.user.id,
        googleCalendarId,
      },
    });

    if (!localCalendar) {
      localCalendar = await prisma.calendar.create({
        data: {
          userId: session.user.id,
          name: name || "Google Calendar",
          color: color || "#0f9d58",
          googleCalendarId,
        },
      });
    }

    const imported = await importGoogleCalendarEvents(
      session.user.id,
      googleCalendarId,
      localCalendar.id
    );

    return NextResponse.json({
      calendar: localCalendar,
      importedEvents: imported,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to import Google Calendar events." },
      { status: 500 }
    );
  }
}
