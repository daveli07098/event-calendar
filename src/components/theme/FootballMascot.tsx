"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { getEventTheme } from "@/lib/event-themes";

/**
 * A little pixel-art footballer that peeks from the bottom-left corner while
 * the ⚽ Football (World Cup) event theme is active. Purely decorative — it's
 * pointer-events-none so it never blocks the sidebar links underneath, except
 * for the mascot body itself which gives a cheery toast on click.
 */

// Pixel grid (16 wide × 18 tall). Each char maps to a color below; space = clear.
//   h hair · s skin · e eye · j jersey · n number · p shorts · l leg · b boot
//   w ball-white · k ball-spot
const SPRITE = [
  "                ",
  "      hhhh      ",
  "     hhhhhh     ",
  "     hssssh     ",
  "     sesses     ",
  "     ssssss     ",
  "     sseess     ",
  "    sjjjjjjs    ",
  "   ssjjnnjjss   ",
  "    sjjnnjjs    ",
  "    sjjjjjjs    ",
  "     jjjjjj     ",
  "     pppppp     ",
  "     pp  pp     ",
  "  ww ll  ll     ",
  "wkww ll  ll     ",
  "wwww bb  bb     ",
  "  ww bb  bb     ",
];

const COLORS: Record<string, string> = {
  h: "#3a2417",
  s: "#f3c892",
  e: "#1b120b",
  j: "#dc2626",
  n: "#ffffff",
  p: "#f1f5f9",
  l: "#f3c892",
  b: "#1e293b",
  w: "#ffffff",
  k: "#111827",
};

export function FootballMascot() {
  const { theme } = useTheme();
  const [cheer, setCheer] = useState(false);

  if (getEventTheme(theme.eventTheme)?.id !== "worldcup") return null;

  const cells: React.ReactNode[] = [];
  SPRITE.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const fill = COLORS[ch];
      if (fill) {
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
      }
    }
  });

  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-30 select-none">
      {/* Speech bubble on cheer */}
      {cheer && (
        <div className="absolute -top-6 left-10 animate-bounce rounded-md bg-foreground px-2 py-0.5 text-[10px] font-bold text-background shadow">
          GOAL! ⚽
        </div>
      )}
      <button
        type="button"
        aria-label="Football mascot"
        onClick={() => {
          setCheer(true);
          setTimeout(() => setCheer(false), 1400);
        }}
        className="pointer-events-auto block opacity-90 transition-transform hover:scale-110 focus-visible:outline-none"
        style={{ animation: "mascotBob 2.4s ease-in-out infinite" }}
      >
        <svg
          width="64"
          height="72"
          viewBox="0 0 16 18"
          shapeRendering="crispEdges"
          aria-hidden="true"
          className="drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
        >
          {cells}
        </svg>
      </button>
    </div>
  );
}
