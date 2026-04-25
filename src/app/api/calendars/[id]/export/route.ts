import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ── ICS helpers (RFC 5545) ────────────────────────────────────────────────────

/** Fold long lines at 75 octets as required by RFC 5545 §3.1 */
function fold(line: string): string {
  const chunks: string[] = [];
  while (line.length > 75) {
    chunks.push(line.slice(0, 75));
    line = " " + line.slice(75);
  }
  chunks.push(line);
  return chunks.join("\r\n");
}

/** Escape TEXT values: backslash, semicolon, comma, newlines */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Format a Date as ICS UTC datetime: 20260426T090000Z */
function fmtUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

/** Format a Date as ICS date-only: 20260426 */
function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${dy}`;
}

// ─────────────────────────────────────────────────────────────────────────────

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
    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:${event.id}@event-calendar`));
    lines.push(fold(`SUMMARY:${esc(event.title)}`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`CREATED:${fmtUtc(event.createdAt)}`);
    lines.push(`LAST-MODIFIED:${fmtUtc(event.updatedAt)}`);

    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(event.startTime)}`);
      // ICS all-day DTEND is exclusive — advance by one day
      const endExclusive = new Date(event.endTime);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      lines.push(`DTEND;VALUE=DATE:${fmtDate(endExclusive)}`);
    } else {
      lines.push(`DTSTART:${fmtUtc(event.startTime)}`);
      lines.push(`DTEND:${fmtUtc(event.endTime)}`);
    }

    if (event.description) {
      lines.push(fold(`DESCRIPTION:${esc(event.description)}`));
    }
    if (event.location) {
      lines.push(fold(`LOCATION:${esc(event.location)}`));
    }

    lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
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
