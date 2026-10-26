import "@testing-library/jest-dom/vitest";

// Stub next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Never let a real OpenCode key from the shell reach the suite: with it set,
// every AI call site would try OpenCode before the Gemini URLs tests assert on.
// Tests that exercise OpenCode opt in with vi.stubEnv("OPENCODE_API_KEY", …).
delete process.env.OPENCODE_API_KEY;
delete process.env.OPENCODE_MODELS;
delete process.env.OPENCODE_BASE_URL;
