import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession } from "../../helpers";

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { POST } from "@/app/api/ics/import/route";

const ics = (dtend: string) =>
  ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:a@x", "SUMMARY:Expo", "DTSTART;VALUE=DATE:20261024", `DTEND;VALUE=DATE:${dtend}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");

describe("POST /api/ics/import all-day end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.calendar.create.mockResolvedValue({ id: "cal-x" } as never);
    prismaMock.event.create.mockResolvedValue({} as never);
  });

  const run = async (dtend: string) => {
    await POST(new NextRequest("http://localhost/api/ics/import", { method: "POST", body: JSON.stringify({ icsContent: ics(dtend) }) }));
    return prismaMock.event.create.mock.calls[0][0].data;
  };

  it("stores DTEND as-is (exclusive) for a multi-day all-day event", async () => {
    const data = await run("20261102");
    expect(data.allDay).toBe(true);
    expect(new Date(data.endTime).toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("stores a 1-day all-day event with exclusive end = start + 1", async () => {
    const data = await run("20261025");
    expect(new Date(data.endTime).toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });
});
