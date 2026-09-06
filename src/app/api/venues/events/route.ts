import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { matchVenue, extractVenueText, isPlaceholderLocation } from "@/lib/venue-match";
import { matchVenueConfig } from "@/lib/venue-seatmap/registry";
import { TICKET_CALENDAR_NAMES } from "@/lib/calendar-names";

/** Returns all calendar IDs the user can read (owned + shared memberships) — mirrors
 * `accessibleCalendarIds` in src/app/api/events/route.ts. */
async function accessibleCalendarIds(userId: string): Promise<string[]> {
  const [owned, memberships] = await Promise.all([
    prisma.calendar.findMany({ where: { userId }, select: { id: true } }),
    prisma.calendarMember.findMany({ where: { userId }, select: { calendarId: true } }),
  ]);
  return [
    ...owned.map((c) => c.id),
    ...memberships.map((m) => m.calendarId),
  ];
}

export interface VenueEventSummary {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName: string;
  isTicket: boolean;
  seat: string | null;
  ticketUrl: string | null;
  hasSeatMap: boolean;
}

export interface VenueEventsResponse {
  venues: Array<{
    venueId: string;
    hasSeatMap: boolean;
    upcoming: VenueEventSummary[];
    pastCount: number;
  }>;
  // Upcoming events whose venue text matched nothing in the directory, grouped by the raw
  // (un-normalized) text so it's still recognizable in the UI, top 20 by count.
  unmatched: Array<{ location: string; count: number; sampleEventId: string; sampleTitle: string }>;
}

const UPCOMING_CAP = 20;
const UNMATCHED_CAP = 20;

/**
 * GET /api/venues/events — groups the caller's events by matched physical venue, so the UI
 * can show "where am I going" per venue rather than per free-text location string.
 *
 * `EventVenue` is a shared directory with no `userId`, and events only reference a venue by
 * free text (`Event.location` or a "Venue: ..." line in `Event.description`) — see
 * `src/lib/venue-match.ts` for the matching logic. Events the matcher can't place are surfaced
 * under `unmatched` instead of being silently dropped.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const calIds = await accessibleCalendarIds(session.user.id);
  const now = new Date();
  const upcomingCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // now - 1 day

  const [events, venues] = await Promise.all([
    prisma.event.findMany({
      where: { calendarId: { in: calIds } },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        allDay: true,
        location: true,
        description: true, // Seat: / Venue: / Ticket URL: lines are parsed out of this below
        calendar: { select: { name: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.eventVenue.findMany({ select: { id: true, name: true, aliases: true } }),
  ]);

  // Venue-level hasSeatMap: does the venue's own name or any of its aliases resolve to a
  // built-in seat-map config?
  const venueHasSeatMap = new Map<string, boolean>();
  for (const v of venues) {
    const hasSeatMap =
      matchVenueConfig(v.name) !== null || v.aliases.some((alias) => matchVenueConfig(alias) !== null);
    venueHasSeatMap.set(v.id, hasSeatMap);
  }

  type Bucket = { venueId: string; upcoming: VenueEventSummary[]; pastCount: number };
  const buckets = new Map<string, Bucket>();
  const unmatchedByText = new Map<string, { count: number; sampleEventId: string; sampleTitle: string }>();

  for (const ev of events) {
    const venueText = extractVenueText(ev);
    const match = matchVenue(venueText, venues);
    const isUpcoming = ev.startTime >= upcomingCutoff;

    if (!match) {
      // Bare city/country names ("Hong Kong") and TBD-style placeholders aren't venues we
      // failed to match — they're not venues at all, so don't clutter the unmatched report.
      if (isUpcoming && venueText && !isPlaceholderLocation(venueText)) {
        const existing = unmatchedByText.get(venueText);
        if (existing) {
          existing.count++;
        } else {
          unmatchedByText.set(venueText, { count: 1, sampleEventId: ev.id, sampleTitle: ev.title });
        }
      }
      continue;
    }

    let bucket = buckets.get(match.venueId);
    if (!bucket) {
      bucket = { venueId: match.venueId, upcoming: [], pastCount: 0 };
      buckets.set(match.venueId, bucket);
    }

    if (!isUpcoming) {
      bucket.pastCount++;
      continue;
    }

    const isTicket = TICKET_CALENDAR_NAMES.includes(ev.calendar.name);
    const seat = ev.description?.match(/^Seat: (.+)$/m)?.[1] ?? null;
    const ticketUrl = ev.description?.match(/^Ticket URL: (.+)$/m)?.[1] ?? null;
    // Event-level hasSeatMap: the venue-level flag, or (belt-and-braces) the raw venue text
    // itself resolving to a config directly — covers events whose text didn't need the
    // directory to match a seat-map-covered venue.
    const eventHasSeatMap = venueHasSeatMap.get(match.venueId) === true || matchVenueConfig(venueText) !== null;

    bucket.upcoming.push({
      id: ev.id,
      title: ev.title,
      start: ev.startTime.toISOString(),
      end: ev.endTime.toISOString(),
      allDay: ev.allDay,
      calendarName: ev.calendar.name,
      isTicket,
      seat,
      ticketUrl,
      hasSeatMap: eventHasSeatMap,
    });
  }

  const venuesResult = Array.from(buckets.values()).map((bucket) => ({
    venueId: bucket.venueId,
    hasSeatMap: venueHasSeatMap.get(bucket.venueId) === true,
    upcoming: bucket.upcoming
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, UPCOMING_CAP),
    pastCount: bucket.pastCount,
  }));

  const unmatched = Array.from(unmatchedByText.entries())
    .map(([location, info]) => ({ location, ...info }))
    .sort((a, b) => b.count - a.count)
    .slice(0, UNMATCHED_CAP);

  const response: VenueEventsResponse = { venues: venuesResult, unmatched };
  return NextResponse.json(response);
}
