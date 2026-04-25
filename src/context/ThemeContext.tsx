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
  RADIUS_VALUES,
  STORAGE_KEY,
  type Theme,
} from "@/lib/theme";

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

  // --- accent color: override CSS vars inline or remove overrides for default slate ---
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

  // --- border radius ---
  root.style.setProperty("--radius", RADIUS_VALUES[theme.radius].value);

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

  // Boot: load from localStorage and apply
  useEffect(() => {
    let stored: Theme = DEFAULT_THEME;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = { ...DEFAULT_THEME, ...(JSON.parse(raw) as Partial<Theme>) };
    } catch {
      // ignore parse errors
    }
    setThemeState(stored);
    applyAndPersist(stored);

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
