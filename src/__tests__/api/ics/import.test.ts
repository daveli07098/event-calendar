import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, setMockSession, mockSession, getMockSession } from "../../helpers";

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));

import { POST } from "@/app/api/ics/import/route";

const ics = (dtend: string) =>
  ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:a@x", "SUMMARY:Expo", "DTSTART;VALUE=DATE:20261024", `DTEND;VALUE=DATE:${dtend}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");

// helpers' mock model has no createMany; attach one for this route
const createMany = vi.fn();
(prismaMock.event as unknown as Record<string, unknown>).createMany = createMany;

const post = (icsContent: string) =>
  POST(new NextRequest("http://localhost/api/ics/import", { method: "POST", body: JSON.stringify({ icsContent }) }));

const recurring = (rrule: string, n = 1) =>
  [
    "BEGIN:VCALENDAR",
    ...Array.from({ length: n }, (_, i) => [`BEGIN:VEVENT`, `UID:r${i}@x`, "SUMMARY:R", "DTSTART:20261024T100000Z", "DTEND:20261024T110000Z", `RRULE:${rrule}`, "END:VEVENT"]).flat(),
    "END:VCALENDAR",
  ].join("\r\n");

describe("POST /api/ics/import all-day end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.calendar.create.mockResolvedValue({ id: "cal-x" } as never);
    createMany.mockReset();
    createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  });

  const run = async (dtend: string) => {
    await POST(new NextRequest("http://localhost/api/ics/import", { method: "POST", body: JSON.stringify({ icsContent: ics(dtend) }) }));
    return createMany.mock.calls[0][0].data[0];
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

describe("POST /api/ics/import limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockSession(mockSession);
    prismaMock.calendar.create.mockResolvedValue({ id: "cal-x" } as never);
    createMany.mockReset();
    createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  });

  it("rejects oversized uploads with 413", async () => {
    const res = await post("BEGIN:VCALENDAR" + "x".repeat(2 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(prismaMock.calendar.create).not.toHaveBeenCalled();
  });

  it("caps a SECONDLY rule at 1000 instances and reports truncation", async () => {
    const res = await post(recurring("FREQ=SECONDLY"));
    const json = await res.json();
    expect(json.importedEvents).toBe(1000);
    expect(json.truncated).toBe(1);
  });

  it("caps total events per import at 5000 and chunks inserts", async () => {
    const res = await post(recurring("FREQ=SECONDLY", 7));
    const json = await res.json();
    expect(json.importedEvents).toBe(5000);
    expect(json.truncated).toBe(7 + 2000);
    expect(createMany.mock.calls.length).toBe(10);
  });
});
