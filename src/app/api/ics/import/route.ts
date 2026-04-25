import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RRule } from "rrule";

// ── ICS parser ──────────────────────────────────────────────────────────────

function unfoldLines(ics: string): string {
  // RFC 5545 line folding: CRLF + WSP or LF + WSP is a continuation
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function unescapeICS(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseICSDateTime(
  value: string,
  params: string,
): { iso: string; allDay: boolean } {
  const isDateOnly = params.includes("VALUE=DATE") || value.length === 8;

  if (isDateOnly) {
    // YYYYMMDD — treat as UTC midnight
    const year = parseInt(value.slice(0, 4), 10);
    const month = parseInt(value.slice(4, 6), 10) - 1;
    const day = parseInt(value.slice(6, 8), 10);
    return {
      iso: new Date(Date.UTC(year, month, day)).toISOString(),
      allDay: true,
    };
  }

  // YYYYMMDDTHHmmSS[Z]
  const year = parseInt(value.slice(0, 4), 10);
  const month = parseInt(value.slice(4, 6), 10) - 1;
  const day = parseInt(value.slice(6, 8), 10);
  const hour = parseInt(value.slice(9, 11), 10);
  const min = parseInt(value.slice(11, 13), 10);
  const sec = parseInt(value.slice(13, 15), 10);
  const isUTC = value.endsWith("Z");

  const date = isUTC
    ? new Date(Date.UTC(year, month, day, hour, min, sec))
    : new Date(year, month, day, hour, min, sec);

  return { iso: date.toISOString(), allDay: false };
}

interface ParsedEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  rrule?: string;
}

function parseICS(icsText: string): {
  calName: string;
  events: ParsedEvent[];
} {
  const unfolded = unfoldLines(icsText);
  const lines = unfolded.split(/\r?\n/);

  let calName = "Imported Calendar";
  const events: ParsedEvent[] = [];
  let currentEvent: Partial<ParsedEvent> | null = null;
  let startAllDay = false;

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const keyPart = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1).trim();

    // Keys support parameters: DTSTART;VALUE=DATE
    const semicolonIdx = keyPart.indexOf(";");
    const key = semicolonIdx === -1 ? keyPart : keyPart.slice(0, semicolonIdx);
    const params =
      semicolonIdx === -1 ? "" : keyPart.slice(semicolonIdx + 1);

    if (key === "X-WR-CALNAME") {
      calName = unescapeICS(value);
    } else if (key === "BEGIN" && value === "VEVENT") {
      currentEvent = {};
      startAllDay = false;
    } else if (key === "END" && value === "VEVENT" && currentEvent) {
      if (
        currentEvent.uid &&
        currentEvent.summary &&
        currentEvent.startIso &&
        currentEvent.endIso
      ) {
        events.push(currentEvent as ParsedEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      switch (key) {
        case "UID":
          currentEvent.uid = value;
          break;
        case "SUMMARY":
          currentEvent.summary = unescapeICS(value);
          break;
        case "DESCRIPTION":
          currentEvent.description = stripHtml(unescapeICS(value));
          break;
        case "LOCATION":
          currentEvent.location = unescapeICS(value);
          break;
        case "RRULE":
          currentEvent.rrule = value;
          break;
        case "DTSTART": {
          const { iso, allDay } = parseICSDateTime(value, params);
          currentEvent.startIso = iso;
          currentEvent.allDay = allDay;
          startAllDay = allDay;
          break;
        }
        case "DTEND": {
          const { iso } = parseICSDateTime(value, params);
          if (startAllDay) {
            // iCal DTEND is exclusive for all-day; subtract 1 day to get inclusive end
            const d = new Date(iso);
            d.setUTCDate(d.getUTCDate() - 1);
            currentEvent.endIso = d.toISOString();
          } else {
            currentEvent.endIso = iso;
          }
          break;
        }
      }
    }
  }

  return { calName, events };
}

// ── API handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { icsContent: string; calendarName?: string; color?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { icsContent, calendarName, color = "#4285f4" } = body;

  if (typeof icsContent !== "string" || !icsContent.includes("BEGIN:VCALENDAR")) {
    return NextResponse.json(
      { error: "Invalid ICS content" },
      { status: 400 },
    );
  }

  const { calName, events } = parseICS(icsContent);
  const name = calendarName || calName;

  // Create a new local calendar for this ICS file
  const calendar = await prisma.calendar.create({
    data: {
      name,
      color,
      isDefault: false,
      userId: session.user.id,
    },
  });

  // Batch-insert events, expanding recurring events via rrule package
  let imported = 0;
  // Expand up to 3 years from today for recurring events
  const expandUntil = new Date();
  expandUntil.setFullYear(expandUntil.getFullYear() + 3);

  for (const ev of events) {
    // Build a list of (startIso, endIso) pairs to insert
    const instances: { startIso: string; endIso: string }[] = [];

    if (ev.rrule) {
      try {
        const dtstart = new Date(ev.startIso);
        const durationMs = new Date(ev.endIso).getTime() - dtstart.getTime();
        // rrule.fromString needs a RRULE: string without the key prefix
        const rule = RRule.fromString(`DTSTART:${dtstart.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z\nRRULE:${ev.rrule}`);
        const dates = rule.between(new Date(ev.startIso), expandUntil, true);
        for (const d of dates) {
          instances.push({
            startIso: d.toISOString(),
            endIso: new Date(d.getTime() + durationMs).toISOString(),
          });
        }
      } catch {
        // Fall back to single instance if rrule parsing fails
        instances.push({ startIso: ev.startIso, endIso: ev.endIso });
      }
    } else {
      instances.push({ startIso: ev.startIso, endIso: ev.endIso });
    }

    for (const inst of instances) {
      try {
        await prisma.event.create({
          data: {
            title: ev.summary,
            description: ev.description ?? null,
            location: ev.location ?? null,
            startTime: new Date(inst.startIso),
            endTime: new Date(inst.endIso),
            allDay: ev.allDay ?? false,
            calendarId: calendar.id,
          },
        });
        imported++;
      } catch {
        // Skip events that fail (e.g. invalid dates)
      }
    }
  }

  return NextResponse.json({
    calendarId: calendar.id,
    calendarName: name,
    importedEvents: imported,
    totalEvents: events.length,
  });
}
