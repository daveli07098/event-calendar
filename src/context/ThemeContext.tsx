"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
import { EVENT_THEMES } from "@/lib/event-themes";
import { applyThemeToDocument } from "@/lib/theme-boot";
import { mutate } from "@/lib/mutate";

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

// Thin wrapper around the shared `applyThemeToDocument` (src/lib/theme-boot.ts) —
// that single function is also stringified into the pre-hydration boot script in
// src/app/layout.tsx, so this call site and the boot script can never drift apart.
function applyTheme(theme: Theme, isDark: boolean) {
  applyThemeToDocument(theme, isDark, EVENT_THEMES, ACCENT_COLORS, RADIUS_VALUES, FONT_OPTIONS);
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

  // Set the instant a user-initiated change happens (setTheme, below) and checked
  // by the boot effect's server-fetch callback: guards against the race where the
  // user toggles the theme while the GET below is still in flight, and the stale
  // server payload would otherwise land afterwards and silently clobber their
  // fresh choice.
  const userEditedRef = useRef(false);

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
        // If the user already changed the theme while this GET was in flight,
        // their change wins — don't overwrite it with the (now stale) server value.
        if (userEditedRef.current) return;
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
      userEditedRef.current = true;
      setThemeState((prev) => {
        const next = { ...prev, ...patch };
        applyAndPersist(next);
        // Persist to server (best-effort — don't block the UI). `mutate()` checks
        // res.ok and surfaces a single toast.error on failure instead of swallowing
        // it, so a sync failure isn't silently invisible to the user; localStorage
        // still holds the change either way.
        void mutate("/api/user/settings", {
          method: "PUT",
          body: { theme: next },
          fallbackError: "Couldn't sync your theme to your account — it's saved on this device only.",
        });
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
