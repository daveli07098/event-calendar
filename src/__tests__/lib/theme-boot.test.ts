import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyThemeToDocument, buildThemeBootScript } from "@/lib/theme-boot";
import { ACCENT_COLORS, DEFAULT_THEME, FONT_OPTIONS, RADIUS_VALUES, STORAGE_KEY, type Theme } from "@/lib/theme";
import { EVENT_THEMES } from "@/lib/event-themes";

/**
 * These tests exercise the FOUC-prevention boot script end-to-end: instead of
 * asserting on string contents (brittle, and doesn't prove the script actually
 * works), they `eval` the exact string that gets embedded in <head> against a
 * real jsdom `document`, with a mocked `localStorage` / `matchMedia`, and assert
 * on the resulting DOM — the same DOM state a browser would have immediately
 * after parsing <head>, before first paint.
 */

function runBootScript() {
  // Intentional eval: this is exactly what the browser does when it parses the inline <script>.
  (0, eval)(buildThemeBootScript());
}

function mockMatchMedia(matchesDark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("dark") ? matchesDark : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("buildThemeBootScript", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.eventTheme;
    delete document.documentElement.dataset.density;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("references the exact STORAGE_KEY ThemeContext writes, so it can never read the wrong slot", () => {
    expect(buildThemeBootScript()).toContain(JSON.stringify(STORAGE_KEY));
  });

  it("applies the OS-dark class before first paint when localStorage is empty and mode is system (the default)", () => {
    mockMatchMedia(true);
    runBootScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("does not apply the dark class when the OS prefers light and no stored theme overrides it", () => {
    mockMatchMedia(false);
    runBootScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("prefers the persisted localStorage theme over the OS preference", () => {
    mockMatchMedia(false); // OS is light...
    const stored: Theme = { ...DEFAULT_THEME, mode: "dark" }; // ...but the user chose dark explicitly
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    runBootScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applies the same --primary/--ring/--radius/density the runtime applyThemeToDocument would, for the persisted theme", () => {
    mockMatchMedia(false);
    const stored: Theme = { ...DEFAULT_THEME, mode: "light", accent: "rose", eventTheme: null, radius: "lg", density: "compact" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    runBootScript();

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--primary")).toBe(ACCENT_COLORS.rose.lightPrimary);
    expect(root.style.getPropertyValue("--ring")).toBe(ACCENT_COLORS.rose.lightRing);
    expect(root.style.getPropertyValue("--radius")).toBe(RADIUS_VALUES.lg.value);
    expect(root.dataset.density).toBe("compact");
  });

  it("does not throw and falls back to defaults when localStorage holds corrupt JSON", () => {
    mockMatchMedia(false);
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(() => runBootScript()).not.toThrow();
    // Default theme ships eventTheme: "worldcup", which overrides the accent —
    // confirms the default was used rather than blowing up mid-script.
    expect(document.documentElement.dataset.eventTheme).toBe("worldcup");
  });
});

describe("applyThemeToDocument (shared with the boot script via .toString())", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.eventTheme;
  });

  it("prioritizes the event theme's palette over the chosen accent", () => {
    applyThemeToDocument(
      { ...DEFAULT_THEME, accent: "blue", eventTheme: "worldcup" },
      false,
      EVENT_THEMES,
      ACCENT_COLORS,
      RADIUS_VALUES,
      FONT_OPTIONS,
    );
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(EVENT_THEMES.worldcup.lightPrimary);
    expect(document.documentElement.dataset.eventTheme).toBe("worldcup");
  });

  it("clears accent overrides for the slate accent with no event theme", () => {
    applyThemeToDocument(
      { ...DEFAULT_THEME, accent: "slate", eventTheme: null },
      false,
      EVENT_THEMES,
      ACCENT_COLORS,
      RADIUS_VALUES,
      FONT_OPTIONS,
    );
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
    expect(document.documentElement.dataset.eventTheme).toBeUndefined();
  });
});
