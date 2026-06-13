"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ACCENT_COLORS,
  DEFAULT_THEME,
  FONT_OPTIONS,
  RADIUS_VALUES,
  STORAGE_KEY,
  type Theme,
} from "@/lib/theme";
import { getEventTheme } from "@/lib/event-themes";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (patch: Partial<Theme>) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

function prefersDark(): boolean {
  return typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

function applyTheme(theme: Theme, isDark: boolean) {
  const root = document.documentElement;

  // --- dark class ---
  root.classList.toggle("dark", isDark);

  // --- primary accent: an active event theme overrides the chosen accent color ---
  const eventTheme = getEventTheme(theme.eventTheme);
  if (eventTheme) {
    // Event skin takes priority — paint its palette and tag the root so CSS can
    // hook decorative styles via [data-event-theme="…"] if desired.
    root.style.setProperty("--primary", isDark ? eventTheme.darkPrimary : eventTheme.lightPrimary);
    root.style.setProperty("--primary-foreground", eventTheme.primaryForeground);
    root.style.setProperty("--ring", isDark ? eventTheme.darkRing : eventTheme.lightRing);
    root.dataset.eventTheme = eventTheme.id;
  } else {
    delete root.dataset.eventTheme;
    // Fall back to the accent color (or remove overrides for default slate).
    const accent = ACCENT_COLORS[theme.accent];
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
  root.style.setProperty("--radius", RADIUS_VALUES[theme.radius].value);

  // --- font ---
  const fontVar = FONT_OPTIONS[theme.font ?? "geist"].variable;
  root.style.setProperty("--font-sans", `var(${fontVar})`);

  // --- density via data attribute (CSS selects [data-density="compact"]) ---
  root.dataset.density = theme.density;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  const applyAndPersist = useCallback((next: Theme) => {
    const dark =
      next.mode === "dark" || (next.mode === "system" && prefersDark());
    applyTheme(next, dark);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }, []);

  // Boot: load from localStorage (fast, for instant paint) → then authoritative fetch from server
  useEffect(() => {
    let stored: Theme = DEFAULT_THEME;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = { ...DEFAULT_THEME, ...(JSON.parse(raw) as Partial<Theme>) };
    } catch {
      // ignore parse errors
    }
    // Apply cached theme immediately so there's no flash
    setThemeState(stored);
    applyAndPersist(stored);

    // Then fetch the server-stored theme (source of truth across browsers)
    fetch("/api/user/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.theme && typeof data.theme === "object") {
          const serverTheme: Theme = { ...DEFAULT_THEME, ...(data.theme as Partial<Theme>) };
          setThemeState(serverTheme);
          applyAndPersist(serverTheme);
        }
      })
      .catch(() => {/* keep localStorage value on network error */});

    // Re-apply when OS dark/light preference changes (system mode only)
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onOsChange = () => {
      setThemeState((prev) => {
        if (prev.mode === "system") applyTheme(prev, mq.matches);
        return prev; // no state change, just a side-effect
      });
    };
    mq.addEventListener("change", onOsChange);
    return () => mq.removeEventListener("change", onOsChange);
  }, [applyAndPersist]);

  const setTheme = useCallback(
    (patch: Partial<Theme>) => {
      setThemeState((prev) => {
        const next = { ...prev, ...patch };
        applyAndPersist(next);
        // Persist to server (best-effort — don't block the UI)
        fetch("/api/user/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme: next }),
        }).catch(() => {/* ignore — localStorage is the fallback */});
        return next;
      });
    },
    [applyAndPersist],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
