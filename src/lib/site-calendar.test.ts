import { describe, it, expect, beforeEach } from "vitest";
import { prismaMock } from "@/__tests__/helpers";

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { ensureSiteCalendarMembership, getSiteSharedCalendarIds } from "@/lib/site-calendar";

const createMany = vi.fn();
(prismaMock.calendarMember as unknown as Record<string, unknown>).createMany = createMany;

describe("site-calendar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getSiteSharedCalendarIds returns ids of site-shared calendars", async () => {
    prismaMock.calendar.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
    expect(await getSiteSharedCalendarIds()).toEqual(["a", "b"]);
    expect(prismaMock.calendar.findMany).toHaveBeenCalledWith({ where: { isSiteShared: true }, select: { id: true } });
  });

  it("adds viewer memberships idempotently for calendars not owned by the user", async () => {
    prismaMock.calendar.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
    await ensureSiteCalendarMembership("u1");
    expect(prismaMock.calendar.findMany).toHaveBeenCalledWith({
      where: { isSiteShared: true, userId: { not: "u1" }, members: { none: { userId: "u1" } } },
      select: { id: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { calendarId: "a", userId: "u1", role: "viewer" },
        { calendarId: "b", userId: "u1", role: "viewer" },
      ],
      skipDuplicates: true,
    });
  });

  it("does nothing when there are no site calendars", async () => {
    prismaMock.calendar.findMany.mockResolvedValue([] as never);
    await ensureSiteCalendarMembership("u1");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    prismaMock.calendar.findMany.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ensureSiteCalendarMembership("u1")).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
