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
}

export const DEFAULT_THEME: Theme = {
  mode: "system",
  accent: "blue",
  radius: "default",
  density: "comfortable",
  font: "geist",
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
