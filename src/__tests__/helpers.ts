import { PrismaClient } from "@prisma/client";

/**
 * Shared mocks for auth and prisma used across API route tests.
 *
 * IMPORTANT: the `vi.mock("@/lib/prisma", ...)` / `vi.mock("@/lib/auth", ...)` calls
 * themselves must be written in each *test file* (not here). Vitest hoists `vi.mock`
 * calls to the top of the file that contains them — a call executed inside an
 * imported helper module like this one does not get hoisted above the route
 * module's own imports, so the real `prisma`/`auth` modules would already be bound
 * by the time this file's `vi.mock` ran. Keep the mock *factories/fixtures* here and
 * `vi.mock(...)` in each test file, e.g.:
 *
 *   import { prismaMock, getMockSession } from "../../helpers";
 *   vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
 *   vi.mock("@/lib/auth", () => ({ auth: vi.fn(() => Promise.resolve(getMockSession())) }));
 *   import { GET, POST } from "@/app/api/calendars/route"; // import the route AFTER the mocks
 */

// --- Auth mock ---
export const mockSession = {
  user: { id: "user-1", name: "Test User", email: "test@example.com" },
  expires: new Date(Date.now() + 86400000).toISOString(),
};

let _session: typeof mockSession | null = mockSession;

export function setMockSession(s: typeof mockSession | null) {
  _session = s;
}

export function getMockSession() {
  return _session;
}

// --- Prisma mock ---
type DeepMockProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : T[K] extends object
      ? DeepMockProxy<T[K]>
      : T[K];
};

function createMockModel() {
  return {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
}

export const prismaMock = {
  calendar: createMockModel(),
  calendarMember: createMockModel(),
  event: createMockModel(),
  user: createMockModel(),
  account: createMockModel(),
  session: createMockModel(),
} as unknown as DeepMockProxy<PrismaClient>;

// --- Fixture builders ---
// Full row shapes matching prisma/schema.prisma, with sensible defaults. Route
// handlers read/return every column (via `include`/spread), and the Prisma mock
// above is typed against the real PrismaClient, so mock data must satisfy the
// full model shape — not just the fields a given test cares about. Pass
// `overrides` for the fields under test.

export function mockCalendar(overrides: Record<string, unknown> = {}) {
  return {
    id: "cal-1",
    userId: "user-1",
    name: "My Calendar",
    color: "#4285f4",
    isDefault: false,
    isVisible: true,
    googleCalendarId: null as string | null,
    shareToken: null as string | null,
    shareMode: null as string | null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

export function mockEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    calendarId: "cal-1",
    title: "Event",
    description: null as string | null,
    location: null as string | null,
    startTime: new Date("2025-01-15T10:00:00.000Z"),
    endTime: new Date("2025-01-15T11:00:00.000Z"),
    allDay: false,
    recurrenceRule: null as string | null,
    googleEventId: null as string | null,
    category: null as string | null,
    artist: null as string | null,
    referenceUrl: null as string | null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

export function mockMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    calendarId: "cal-1",
    userId: "user-2",
    role: "editor",
    joinedAt: new Date("2025-01-03T00:00:00.000Z"),
    user: { id: "user-2", name: "Member User", email: "member@example.com", image: null },
    ...overrides,
  };
}

/** Round-trips a value through JSON so Date fields become the ISO strings a
 * `NextResponse.json(...)` body would actually contain — for asserting API
 * response bodies against fixtures built with real `Date` objects. */
export function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
