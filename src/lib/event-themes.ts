/**
 * Event themes — named, seasonal "skins" that re-color the app's primary accent
 * for a specific event (e.g. the World Cup). They sit on top of the base theme
 * (mode / radius / font / density stay untouched) and override only the accent
 * CSS variables, so switching one on or off is instant and non-destructive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOW TO ADD A NEW EVENT THEME (e.g. a future "Olympics" or "Christmas" skin):
 *  1. Add an entry to EVENT_THEMES below with a unique `id`.
 *  2. Pick primary/ring colors (oklch — same format as ACCENT_COLORS in theme.ts).
 *  3. (Optional) point `bannerPreset` at a banner in src/lib/banner.ts so the
 *     theme and its banner can be enabled together.
 *  That's it — it automatically appears in the theme switcher and settings.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface EventTheme {
  id: string;
  /** Human-readable name shown in the switcher / settings. */
  label: string;
  /** Leading emoji for quick visual identification. */
  emoji: string;
  /** One-line description. */
  description: string;
  // Accent overrides — same oklch format as ACCENT_COLORS in theme.ts.
  swatch: string;          // hex, for the UI preview dot
  lightPrimary: string;
  darkPrimary: string;
  primaryForeground: string;
  lightRing: string;
  darkRing: string;
  /** Optional banner preset id (see src/lib/banner.ts) that pairs with this theme. */
  bannerPreset?: string;
}

export const EVENT_THEMES: Record<string, EventTheme> = {
  worldcup: {
    id: "worldcup",
    label: "Football",
    emoji: "⚽",
    description: "World Cup — pitch green",
    swatch: "#15a34a",
    // Vibrant grass-pitch green
    lightPrimary: "oklch(0.567 0.166 149.3)",
    darkPrimary: "oklch(0.63 0.16 152)",
    primaryForeground: "oklch(0.985 0 0)",
    lightRing: "oklch(0.567 0.166 149.3)",
    darkRing: "oklch(0.63 0.16 152)",
    bannerPreset: "worldcup",
  },
};

/** Stable display order for the switcher / settings list. */
export const EVENT_THEME_ORDER: string[] = ["worldcup"];

export function getEventTheme(id: string | null | undefined): EventTheme | null {
  if (!id) return null;
  return EVENT_THEMES[id] ?? null;
}
