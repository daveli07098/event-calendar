/**
 * Well-known calendar names the app treats specially.
 *
 * These are the auto-created calendars the ticket flow writes into, as opposed
 * to calendars the user made themselves. They were previously spelled as bare
 * strings in more than one component, which made them easy to drift apart.
 */

/** Reminder events generated from scraped tickets (⭐ / 🎫 rows). */
export const REMINDERS_CALENDAR_NAME = "event-reminders";

/** Sale/presale window events generated from scraped tickets. */
export const SALE_TICKET_CALENDAR_NAME = "sale-ticket";

/** Both auto-created ticket calendars, for sorting/grouping in the sidebar. */
export const TICKET_CALENDAR_NAMES: readonly string[] = [
  REMINDERS_CALENDAR_NAME,
  SALE_TICKET_CALENDAR_NAME,
];

/**
 * The category/location filters only meaningfully narrow ticket-derived events,
 * so hiding the reminders calendar should also drop those filters rather than
 * leave the user staring at an empty calendar with no obvious cause.
 */
export function remindersCalendarVisible(
  calendars: { name: string; isVisible: boolean; memberRole?: string | null }[],
): boolean {
  return calendars.some(
    (c) => c.name === REMINDERS_CALENDAR_NAME && !c.memberRole && c.isVisible,
  );
}
