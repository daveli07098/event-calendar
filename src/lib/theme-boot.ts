/**
 * Single source of truth for "apply a Theme to the DOM" — shared, byte-for-byte,
 * between two very different runtimes:
 *
 *   1. `ThemeContext` (a mounted React client component) calls `applyThemeToDocument`
 *      directly, as a normal imported function.
 *   2. `RootLayout` (a server component) calls `buildThemeBootScript()` to get a
 *      plain-JS string that is embedded in a `beforeInteractive` inline <script> in
 *      <head> (see src/app/layout.tsx). That script runs in the browser BEFORE any
 *      React/Next module has loaded, so it cannot `import` anything — it can only
 *      run a `.toString()`'d copy of `applyThemeToDocument` against JSON-serialized
 *      copies of the theme constants.
 *
 * Both call sites therefore execute the *exact same function body*. This is what
 * prevents the boot script and ThemeContext from silently drifting apart over time
 * — there is no second implementation to keep in sync; there is only one, reused.
 *
 * Constraints this imposes on `applyThemeToDocument`:
 *   - It must take every value it needs as a parameter (theme, isDark, and the
 *     three lookup tables). It must NOT close over any module-level import,
 *     because `Function.prototype.toString()` only captures the function's own
 *     source text, not the bindings it closed over — a stringified function that
 *     referenced an outside import would throw a ReferenceError when eval'd in
 *     the inline script.
 *   - It must only touch the DOM (document.documentElement) — no React, no
 *     state, no network.
 */
import {
  ACCENT_COLORS,
  DEFAULT_THEME,
  FONT_OPTIONS,
  RADIUS_VALUES,
  STORAGE_KEY,
  type Theme,
} from "@/lib/theme";
import { EVENT_THEMES } from "@/lib/event-themes";

/** The subset of an EventTheme's fields this function actually needs. */
interface AccentPalette {
  lightPrimary: string;
  darkPrimary: string;
  primaryForeground: string;
  lightRing: string;
  darkRing: string;
}

/**
 * Applies a resolved theme + dark/light decision to `document.documentElement`.
 * Pure DOM manipulation — see the module doc comment above for why it must stay
 * self-contained (no closures over imports) so it can be safely stringified.
 */
export function applyThemeToDocument(
  theme: Theme,
  isDark: boolean,
  eventThemes: Record<string, AccentPalette>,
  accentColors: Record<string, AccentPalette>,
  radiusValues: Record<string, { value: string }>,
  fontOptions: Record<string, { variable: string }>,
) {
  const root = document.documentElement;

  // --- dark class ---
  root.classList.toggle("dark", isDark);

  // --- primary accent: an active event theme overrides the chosen accent color ---
  const eventTheme = theme.eventTheme ? eventThemes[theme.eventTheme] : null;
  if (eventTheme) {
    // Event skin takes priority — paint its palette and tag the root so CSS can
    // hook decorative styles via [data-event-theme="…"] if desired.
    root.style.setProperty("--primary", isDark ? eventTheme.darkPrimary : eventTheme.lightPrimary);
    root.style.setProperty("--primary-foreground", eventTheme.primaryForeground);
    root.style.setProperty("--ring", isDark ? eventTheme.darkRing : eventTheme.lightRing);
    root.dataset.eventTheme = theme.eventTheme as string;
  } else {
    delete root.dataset.eventTheme;
    // Fall back to the accent color (or remove overrides for default slate).
    const accent = accentColors[theme.accent];
    if (theme.accent === "slate") {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--ring");
    } else {
      root.style.setProperty("--primary", isDark ? accent.darkPrimary : accent.lightPrimary);
      root.style.setProperty("--primary-foreground", accent.primaryForeground);
      root.style.setProperty("--ring", isDark ? accent.darkRing : accent.lightRing);
    }
  }

  // --- border radius ---
  root.style.setProperty("--radius", radiusValues[theme.radius].value);

  // --- font ---
  const fontVar = fontOptions[theme.font ?? "geist"].variable;
  root.style.setProperty("--font-sans", `var(${fontVar})`);

  // --- density via data attribute (CSS selects [data-density="compact"]) ---
  root.dataset.density = theme.density;
}

/**
 * Builds the inline, `beforeInteractive` boot script that eliminates the
 * light→dark (and wrong-accent) flash of unstyled content: it reads the
 * persisted theme from localStorage (same STORAGE_KEY / shape ThemeContext
 * writes), resolves `mode: "system"` against the OS preference, and calls the
 * stringified `applyThemeToDocument` — all synchronously, before first paint.
 *
 * Wrapped in try/catch throughout so a corrupt localStorage value or an old
 * browser without `matchMedia` degrades to the server-rendered default theme
 * instead of throwing and blanking the page.
 */
export function buildThemeBootScript(): string {
  const data = {
    storageKey: STORAGE_KEY,
    defaultTheme: DEFAULT_THEME,
    accentColors: ACCENT_COLORS,
    radiusValues: RADIUS_VALUES,
    fontOptions: FONT_OPTIONS,
    eventThemes: EVENT_THEMES,
  };

  // NOTE: `applyThemeToDocument.toString()` is the anti-drift mechanism — see
  // the module doc comment. Do not hand-copy this logic elsewhere.
  return `(function(){try{
var d=${JSON.stringify(data)};
var apply=${applyThemeToDocument.toString()};
var theme=d.defaultTheme;
try{
var raw=localStorage.getItem(d.storageKey);
if(raw){var parsed=JSON.parse(raw);theme=Object.assign({},d.defaultTheme,parsed);}
}catch(e){}
var isDark=theme.mode==="dark"||(theme.mode==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
apply(theme,isDark,d.eventThemes,d.accentColors,d.radiusValues,d.fontOptions);
}catch(e){}})();`;
}
