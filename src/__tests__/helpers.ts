import { PrismaClient } from "@prisma/client";

/**
 * Shared mocks for auth and prisma used across API route tests.
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

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve(_session)),
}));

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
  event: createMockModel(),
  user: createMockModel(),
  account: createMockModel(),
  session: createMockModel(),
} as unknown as DeepMockProxy<PrismaClient>;

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));
