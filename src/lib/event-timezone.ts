/**
 * Venue-timezone display helpers.
 *
 * There is deliberately NO timezone column on Event (see prisma/schema.prisma —
 * Event only has `location: String?`). Rather than a schema change (a call for
 * the human, not an agent — the DB is a live shared instance), the venue's
 * timezone is *derived* on the fly from the same location tagging already used
 * for filters/chips: `detectLocationTag` in `./location-tags`.
 *
 * Only tags that map to exactly one IANA zone in practice are included below.
 * Countries spanning multiple zones (US, Canada, Australia, Indonesia) are
 * left OUT on purpose — guessing a zone for those is worse than showing
 * nothing, since a wrong secondary time is actively misleading. Do NOT add
 * e.g. "United States": "America/New_York" here; there is no single correct
 * answer, and the omission is intentional, not an oversight.
 */
import { detectLocationTag } from "./location-tags";

/** Location tag → IANA zone, for tags that resolve to a single timezone. */
export const LOCATION_TAG_TIME_ZONE: Record<string, string> = {
  "Hong Kong": "Asia/Hong_Kong",
  "Macau": "Asia/Macau",
  "Japan": "Asia/Tokyo",
  "South Korea": "Asia/Seoul",
  "Singapore": "Asia/Singapore",
  "Thailand": "Asia/Bangkok",
  "Taiwan": "Asia/Taipei",
  "China": "Asia/Shanghai", // mainland China is officially one timezone nationwide
  "Malaysia": "Asia/Kuala_Lumpur",
  "Philippines": "Asia/Manila",
  "France": "Europe/Paris",
  "Germany": "Europe/Berlin",
  "United Kingdom": "Europe/London",
  // Deliberately omitted (ambiguous, multi-zone countries): United States,
  // Canada, Australia, Indonesia. See file header comment — do not add these.
};

/** Minimal event shape needed to derive a venue timezone. */
export interface EventLocationLike {
  title: string;
  location: string | null;
}

/**
 * Derive the venue's IANA timezone from an event's title + location, via the
 * shared location-tag detector. Returns null when no tag is detected, or when
 * the detected tag is one of the deliberately-ambiguous countries.
 */
export function venueTimeZone(event: EventLocationLike): string | null {
  const tag = detectLocationTag(event.title, event.location);
  if (!tag) return null;
  return LOCATION_TAG_TIME_ZONE[tag] ?? null;
}

/**
 * Format options shared by both the primary and secondary time lines.
 * `hourCycle: "h23"` (rather than `hour12: false`) avoids a known ICU quirk
 * in some engines where midnight renders as "24:00" instead of "00:00".
 */
const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

/** e.g. "18:00" in the given IANA zone. */
export function formatClockTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { ...TIME_FORMAT_OPTIONS, timeZone }).format(new Date(iso));
}

/** e.g. "HKT" / "GMT+8" — the short timezone abbreviation/offset for a zone at a given instant. */
export function formatZoneAbbreviation(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

export interface VenueTimeInfo {
  /** Headline time in the viewer's zone, e.g. "18:00" */
  primaryTime: string;
  /** Viewer zone abbreviation, e.g. "HKT" */
  primaryZoneLabel: string;
  /** Secondary "N local time at venue" line — null when it wouldn't add information */
  secondaryTime: string | null;
}

/**
 * Build the primary (viewer timezone) + optional secondary (venue timezone)
 * time display for a single instant.
 *
 * The secondary line is only included when it adds real information: the
 * venue zone must resolve, differ from the viewer zone, AND the rendered
 * wall-clock time must actually differ (same-offset zones like Hong Kong and
 * Singapore would otherwise show a redundant, identical-looking second line).
 */
export function describeVenueTime(
  iso: string,
  event: EventLocationLike,
  viewerTimeZone: string,
): VenueTimeInfo {
  const primaryTime = formatClockTime(iso, viewerTimeZone);
  const primaryZoneLabel = formatZoneAbbreviation(iso, viewerTimeZone);

  const venueTz = venueTimeZone(event);
  let secondaryTime: string | null = null;
  if (venueTz && venueTz !== viewerTimeZone) {
    const venueClock = formatClockTime(iso, venueTz);
    if (venueClock !== primaryTime) {
      secondaryTime = venueClock;
    }
  }

  return { primaryTime, primaryZoneLabel, secondaryTime };
}
