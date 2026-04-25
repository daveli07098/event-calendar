"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import {
  ACCENT_COLORS,
  FONT_OPTIONS,
  RADIUS_VALUES,
  type ThemeAccent,
  type ThemeDensity,
  type ThemeFont,
  type ThemeMode,
  type ThemeRadius,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODES: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="size-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-4" /> },
  { value: "system", label: "System", icon: <Monitor className="size-4" /> },
];

const DENSITIES: { value: ThemeDensity; label: string; desc: string }[] = [
  { value: "comfortable", label: "Comfortable", desc: "Default spacing" },
  { value: "compact", label: "Compact", desc: "Tighter spacing" },
];

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      {/* Mode */}
      <div>
        <p className="text-sm font-medium mb-3">Mode</p>
        <div className="flex gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setTheme({ mode: m.value })}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors",
                theme.mode === m.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent color */}
      <div>
        <p className="text-sm font-medium mb-3">Accent color</p>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(ACCENT_COLORS) as ThemeAccent[]).map((key) => {
            const accent = ACCENT_COLORS[key];
            const isSelected = theme.accent === key;
            return (
              <button
                key={key}
                onClick={() => setTheme({ accent: key })}
                title={accent.label}
                className={cn(
                  "size-8 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected ? "border-foreground scale-110" : "border-transparent",
                )}
                style={{ backgroundColor: accent.color }}
              />
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {ACCENT_COLORS[theme.accent].label}
        </p>
      </div>

      {/* Border radius */}
      <div>
        <p className="text-sm font-medium mb-3">Border radius</p>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(RADIUS_VALUES) as ThemeRadius[]).map((key) => {
            const r = RADIUS_VALUES[key];
            const isSelected = theme.radius === key;
            return (
              <button
                key={key}
                onClick={() => setTheme({ radius: key })}
                style={{ borderRadius: r.value }}
                className={cn(
                  "px-3 py-2 border text-sm transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Calendar density */}
      <div>
        <p className="text-sm font-medium mb-3">Calendar density</p>
        <div className="flex gap-2">
          {DENSITIES.map((d) => {
            const isSelected = theme.density === d.value;
            return (
              <button
                key={d.value}
                onClick={() => setTheme({ density: d.value })}
                className={cn(
                  "flex flex-col items-start px-3 py-2 rounded-md border text-sm transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <span className="font-medium">{d.label}</span>
                <span
                  className={cn(
                    "text-xs",
                    isSelected ? "text-primary-foreground/70" : "text-muted-foreground",
                  )}
                >
                  {d.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Font */}
      <div>
        <p className="text-sm font-medium mb-3">Font</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FONT_OPTIONS) as ThemeFont[]).map((key) => {
            const f = FONT_OPTIONS[key];
            const isSelected = (theme.font ?? "geist") === key;
            return (
              <button
                key={key}
                onClick={() => setTheme({ font: key })}
                style={{ fontFamily: `var(${f.variable})` }}
                className={cn(
                  "px-3 py-2 rounded-md border text-sm transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
