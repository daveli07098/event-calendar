"use client";

import { Sun, Moon, Monitor, Check } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { EVENT_THEME_ORDER, EVENT_THEMES, getEventTheme } from "@/lib/event-themes";
import { ACCENT_COLORS, type ThemeMode } from "@/lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const MODES: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="size-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-4" /> },
  { value: "system", label: "System", icon: <Monitor className="size-4" /> },
];

/**
 * Compact theme switcher for the top-right corner: quick light/dark/system
 * toggle plus the event-theme picker (e.g. ⚽ Football). Selecting an event
 * theme re-skins the app's accent instantly; "None" restores the saved accent.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const activeEvent = getEventTheme(theme.eventTheme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        aria-label="Change theme"
        title={activeEvent ? `Theme: ${activeEvent.label}` : `Theme: ${ACCENT_COLORS[theme.accent].label}`}
      >
        {/* Always mirror the current selection so the button matches Settings:
            event theme emoji when one is active, else the accent swatch. */}
        {activeEvent ? (
          <span className="text-base leading-none">{activeEvent.emoji}</span>
        ) : (
          <span
            className="size-3.5 rounded-full border border-border"
            style={{ backgroundColor: ACCENT_COLORS[theme.accent].color }}
          />
        )}
        <span className="hidden md:inline">
          {activeEvent ? activeEvent.label : ACCENT_COLORS[theme.accent].label}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m.value}
            onClick={() => setTheme({ mode: m.value })}
            className="gap-2"
          >
            {m.icon}
            <span className="flex-1">{m.label}</span>
            {theme.mode === m.value && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Event theme</DropdownMenuLabel>

        {/* None — restores the user's saved accent color */}
        <DropdownMenuItem
          onClick={() => setTheme({ eventTheme: null })}
          className="gap-2"
        >
          <span
            className="size-4 rounded-full border border-border"
            style={{ backgroundColor: ACCENT_COLORS[theme.accent].color }}
          />
          <span className="flex-1">None (accent)</span>
          {!activeEvent && <Check className="size-4" />}
        </DropdownMenuItem>

        {EVENT_THEME_ORDER.map((id) => {
          const ev = EVENT_THEMES[id];
          if (!ev) return null;
          return (
            <DropdownMenuItem
              key={id}
              onClick={() => setTheme({ eventTheme: id })}
              className="gap-2"
            >
              <span className="text-base leading-none">{ev.emoji}</span>
              <span className="flex-1">
                {ev.label}
                <span className="block text-xs text-muted-foreground">{ev.description}</span>
              </span>
              {theme.eventTheme === id && <Check className="size-4" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
