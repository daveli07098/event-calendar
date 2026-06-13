export type ThemeMode = "light" | "dark" | "system";
export type ThemeAccent = "slate" | "blue" | "green" | "purple" | "rose" | "orange";
export type ThemeRadius = "none" | "sm" | "default" | "lg";
export type ThemeDensity = "comfortable" | "compact";
export type ThemeFont = "geist" | "inter" | "roboto" | "poppins" | "lato";

export interface Theme {
  mode: ThemeMode;
  accent: ThemeAccent;
  radius: ThemeRadius;
  density: ThemeDensity;
  font: ThemeFont;
  /**
   * Active event theme id (see src/lib/event-themes.ts), or null for none.
   * When set, it overrides the `accent` colors with the event's palette.
   */
  eventTheme?: string | null;
  /**
   * The team the user supports under the Football (World Cup) theme — the
   * mascot wears its kit. `undefined` = never asked (prompt them); `null` =
   * asked but declined; a string = the chosen team name (matches event titles,
   * e.g. "阿根廷").
   */
  favouriteTeam?: string | null;
  /**
   * IANA timezone used to display event times (e.g. "Asia/Hong_Kong").
   * Defaults to Hong Kong (GMT+8). Falls back to this when unset.
   */
  timeZone?: string;
}

/** Default display timezone (GMT+8) when the user hasn't picked one. */
export const DEFAULT_TIME_ZONE = "Asia/Hong_Kong";

/** A short, friendly set of timezones for the settings picker. */
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "Asia/Hong_Kong", label: "Hong Kong / Taipei (GMT+8)" },
  { value: "Asia/Tokyo", label: "Tokyo / Seoul (GMT+9)" },
  { value: "Asia/Singapore", label: "Singapore (GMT+8)" },
  { value: "Asia/Bangkok", label: "Bangkok / Jakarta (GMT+7)" },
  { value: "Asia/Kolkata", label: "India (GMT+5:30)" },
  { value: "Europe/London", label: "London (GMT+0/1)" },
  { value: "Europe/Paris", label: "Central Europe (GMT+1/2)" },
  { value: "America/New_York", label: "US Eastern" },
  { value: "America/Los_Angeles", label: "US Pacific" },
  { value: "UTC", label: "UTC" },
];

export const DEFAULT_THEME: Theme = {
  mode: "system",
  accent: "blue",
  radius: "default",
  density: "comfortable",
  font: "geist",
  // Ships in World Cup mode so every visitor lands in the football skin; it can
  // be switched off (→ null) from the top-right theme button or settings.
  eventTheme: "worldcup",
  timeZone: DEFAULT_TIME_ZONE, // GMT+8 by default
};

export const FONT_OPTIONS: Record<ThemeFont, { label: string; variable: string; stack: string }> = {
  geist:   { label: "Geist",   variable: "--font-geist-sans", stack: "Geist, system-ui, sans-serif" },
  inter:   { label: "Inter",   variable: "--font-inter",      stack: "Inter, system-ui, sans-serif" },
  roboto:  { label: "Roboto",  variable: "--font-roboto",     stack: "Roboto, system-ui, sans-serif" },
  poppins: { label: "Poppins", variable: "--font-poppins",    stack: "Poppins, system-ui, sans-serif" },
  lato:    { label: "Lato",    variable: "--font-lato",       stack: "Lato, system-ui, sans-serif" },
};

export const ACCENT_COLORS: Record<
  ThemeAccent,
  {
    label: string;
    color: string; // hex swatch for the UI circle
    lightPrimary: string;
    darkPrimary: string;
    primaryForeground: string;
    lightRing: string;
    darkRing: string;
  }
> = {
  slate: {
    label: "Slate",
    color: "#64748b",
    lightPrimary: "oklch(0.205 0 0)",
    darkPrimary: "oklch(0.922 0 0)",
    primaryForeground: "", // let CSS defaults handle it
    lightRing: "oklch(0.708 0 0)",
    darkRing: "oklch(0.556 0 0)",
  },
  blue: {
    label: "Blue",
    color: "#3b82f6",
    lightPrimary: "oklch(0.546 0.245 262.881)",
    darkPrimary: "oklch(0.623 0.214 259.815)",
    primaryForeground: "oklch(0.985 0 0)",
    lightRing: "oklch(0.546 0.245 262.881)",
    darkRing: "oklch(0.546 0.245 262.881)",
  },
  green: {
    label: "Green",
    color: "#22c55e",
    lightPrimary: "oklch(0.527 0.154 154.449)",
    darkPrimary: "oklch(0.596 0.145 163.225)",
    primaryForeground: "oklch(0.985 0 0)",
    lightRing: "oklch(0.527 0.154 154.449)",
    darkRing: "oklch(0.527 0.154 154.449)",
  },
  purple: {
    label: "Purple",
    color: "#a855f7",
    lightPrimary: "oklch(0.558 0.288 302.321)",
    darkPrimary: "oklch(0.621 0.271 304.789)",
    primaryForeground: "oklch(0.985 0 0)",
    lightRing: "oklch(0.558 0.288 302.321)",
    darkRing: "oklch(0.558 0.288 302.321)",
  },
  rose: {
    label: "Rose",
    color: "#f43f5e",
    lightPrimary: "oklch(0.599 0.231 346.863)",
    darkPrimary: "oklch(0.645 0.207 351.258)",
    primaryForeground: "oklch(0.985 0 0)",
    lightRing: "oklch(0.599 0.231 346.863)",
    darkRing: "oklch(0.599 0.231 346.863)",
  },
  orange: {
    label: "Orange",
    color: "#f97316",
    lightPrimary: "oklch(0.627 0.207 49.234)",
    darkPrimary: "oklch(0.671 0.193 52.448)",
    primaryForeground: "oklch(0.985 0 0)",
    lightRing: "oklch(0.627 0.207 49.234)",
    darkRing: "oklch(0.627 0.207 49.234)",
  },
};

export const RADIUS_VALUES: Record<ThemeRadius, { label: string; value: string }> = {
  none: { label: "None", value: "0rem" },
  sm: { label: "Small", value: "0.375rem" },
  default: { label: "Default", value: "0.625rem" },
  lg: { label: "Large", value: "1rem" },
};

export const STORAGE_KEY = "ec-theme";
