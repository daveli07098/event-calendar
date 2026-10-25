import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildVevent, esc, fmtUtc, fold } from "@/lib/ics";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: calendarId } = await params;
  const userId = session.user.id;

  // Verify access: owner or member
  const calendar = await prisma.calendar.findFirst({
    where: {
      id: calendarId,
      OR: [
        { userId },
        { members: { some: { userId } } },
      ],
    },
    include: {
      events: {
        orderBy: { startTime: "asc" },
      },
    },
  });

  if (!calendar) {
    return NextResponse.json({ error: "Calendar not found" }, { status: 404 });
  }

  const now = new Date();
  const dtstamp = fmtUtc(now);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Event Calendar//Event Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${esc(calendar.name)}`),
    "X-WR-TIMEZONE:UTC",
  ];

  for (const event of calendar.events) {
    lines.push(...buildVevent(event, dtstamp));
  }

  lines.push("END:VCALENDAR");

  const icsBody = lines.join("\r\n") + "\r\n";
  const safeFilename = calendar.name.replace(/[^\w\s-]/g, "").trim() || "calendar";

  return new NextResponse(icsBody, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
