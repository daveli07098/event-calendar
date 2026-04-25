import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { importGoogleCalendarEvents } from "@/lib/google-calendar";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: calendarId } = await params;
  const userId = session.user.id;

  const calendar = await prisma.calendar.findFirst({
    where: { id: calendarId, userId },
  });

  if (!calendar) {
    return NextResponse.json({ error: "Calendar not found" }, { status: 404 });
  }

  if (!calendar.googleCalendarId) {
    return NextResponse.json(
      { error: "This calendar is not linked to Google Calendar" },
      { status: 400 }
    );
  }

  try {
    const imported = await importGoogleCalendarEvents(
      userId,
      calendar.googleCalendarId,
      calendar.id
    );
    return NextResponse.json({ importedEvents: imported });
  } catch {
    return NextResponse.json(
      { error: "Sync failed. Please reconnect your Google account." },
      { status: 500 }
    );
  }
}
