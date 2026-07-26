import { describe, it, expect } from "vitest";
import {
  REMINDERS_CALENDAR_NAME,
  SALE_TICKET_CALENDAR_NAME,
  TICKET_CALENDAR_NAMES,
  remindersCalendarVisible,
} from "@/lib/calendar-names";

const cal = (
  name: string,
  isVisible: boolean,
  memberRole: string | null = null,
) => ({ name, isVisible, memberRole });

describe("calendar-names", () => {
  it("exposes both auto-created ticket calendars", () => {
    expect(TICKET_CALENDAR_NAMES).toEqual([
      REMINDERS_CALENDAR_NAME,
      SALE_TICKET_CALENDAR_NAME,
    ]);
  });
});

describe("remindersCalendarVisible", () => {
  it("is true when the user's own reminders calendar is visible", () => {
    expect(
      remindersCalendarVisible([
        cal("Personal", true),
        cal(REMINDERS_CALENDAR_NAME, true),
      ]),
    ).toBe(true);
  });

  it("is false when the reminders calendar is hidden", () => {
    expect(
      remindersCalendarVisible([
        cal("Personal", true),
        cal(REMINDERS_CALENDAR_NAME, false),
      ]),
    ).toBe(false);
  });

  it("is false when there is no reminders calendar at all", () => {
    expect(remindersCalendarVisible([cal("Personal", true)])).toBe(false);
  });

  // A calendar shared *to* this user can carry the same name as their own.
  // Only the user's own copy governs their filters, otherwise someone else's
  // shared reminders calendar would keep their filters alive after they hid
  // their own.
  it("ignores a shared calendar that happens to have the same name", () => {
    expect(
      remindersCalendarVisible([
        cal(REMINDERS_CALENDAR_NAME, false),
        cal(REMINDERS_CALENDAR_NAME, true, "editor"),
      ]),
    ).toBe(false);
  });

  it("is unaffected by the sale-ticket calendar's visibility", () => {
    expect(
      remindersCalendarVisible([
        cal(REMINDERS_CALENDAR_NAME, true),
        cal(SALE_TICKET_CALENDAR_NAME, false),
      ]),
    ).toBe(true);
  });
});
