"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { getEventTheme } from "@/lib/event-themes";
import { getTeamKit } from "@/lib/team-kits";

/**
 * A little pixel-art footballer that lives along the bottom of the screen while
 * the ⚽ Football (World Cup) event theme is active. He paces back and forth
 * chasing a ball, kicks it in an arc (it bounces off the screen edges and rolls
 * to rest), then trots after it again.
 *
 * - Draggable: grab him to reposition; the spot is remembered across reloads.
 * - A plain click (no drag) still pops a cheery "GOAL! ⚽" toast.
 * - Sits clear of the Next.js dev indicator (bottom-left corner) and never
 *   walks back under it.
 * - Respects prefers-reduced-motion: stands idle instead of roaming.
 *
 * Animation runs on a single rAF loop that mutates DOM transforms via refs, so
 * the component never re-renders per frame.
 */

// Pixel grid is 16 wide. The body (rows 0–13) is shared; the legs (rows 14–17)
// swap between frames to animate the walk and the kick. The ball is drawn as a
// separate element so it can have its own physics.
//   h hair · s skin · e eye · j jersey · n number · p shorts · l leg · b boot
const BODY = [
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
];

// Leg frames (rows 14–17). Authored facing right; left-facing is a scaleX flip.
const LEGS: Record<string, string[]> = {
  idle: [
    "     ll  ll     ",
    "     ll  ll     ",
    "     bb  bb     ",
    "     bb  bb     ",
  ],
  walkA: [
    "     ll  ll     ",
    "    ll    ll    ",
    "   bb      bb   ",
    "  bb        bb  ",
  ],
  walkB: [
    "     ll  ll     ",
    "     ll  ll     ",
    "    bb    bb    ",
    "    bb    bb    ",
  ],
  kick: [
    "     ll  lll    ",
    "     ll   lll   ",
    "     bb    llbb ",
    "     bb     bb  ",
  ],
};

const COLORS: Record<string, string> = {
  h: "#3a2417",
  s: "#f3c892",
  e: "#1b120b",
  j: "#dc2626",
  n: "#ffffff",
  p: "#f1f5f9",
  l: "#f3c892",
  b: "#1e293b",
};

// 8×8 pixel football, drawn separately so it can fly and roll.
const BALL = [
  "  wwww  ",
  " wwwwww ",
  "wwkwwkww",
  "wwwkkwww",
  "wwwkkwww",
  "wwkwwkww",
  " wwwwww ",
  "  wwww  ",
];
const BALL_COLORS: Record<string, string> = { w: "#ffffff", k: "#111827" };

function cellsFrom(rows: string[], palette: Record<string, string>, yOffset = 0) {
  const out: React.ReactNode[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = palette[row[x]];
      if (fill) {
        out.push(
          <rect key={`${x}-${y + yOffset}`} x={x} y={y + yOffset} width={1} height={1} fill={fill} />,
        );
      }
    }
  });
  return out;
}

// ── Layout / physics constants (px, seconds) ──
const CHAR_W = 64; // rendered character width
const BALL_W = 20; // rendered ball width
const CHAR_BOTTOM = 8; // character's footing above viewport bottom
const BALL_BOTTOM = 6; // ball's resting height above viewport bottom
const LEFT_BOUND = 52; // keeps him clear of the Next.js dev indicator
const WALK_SPEED = 56; // px/s
const KICK_VX = 230; // px/s horizontal launch
const KICK_VY = 270; // px/s vertical launch
const GRAVITY = 950; // px/s²
const KICK_RANGE = 30; // how close (center-to-center) before he kicks
const STEP_INTERVAL = 0.14; // leg-swap cadence while walking (s)
const JUGGLE_UP = 250; // px/s upward bounce for keepie-uppies
const DRIBBLE_MS = 8000; // time spent dribbling before switching to juggling
const JUGGLE_MS = 5000; // time spent juggling the ball up and down

export function FootballMascot() {
  const { theme } = useTheme();
  const [cheer, setCheer] = useState(false);

  const active = getEventTheme(theme.eventTheme)?.id === "worldcup";

  // The mascot wears the kit of the team the user supports (or a default red).
  const kit = getTeamKit(theme.favouriteTeam);
  const palette: Record<string, string> = { ...COLORS, j: kit.jersey, p: kit.shorts, n: kit.trim };

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const legRefs = useRef<Record<string, SVGGElement | null>>({});

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const rightBound = () => Math.max(LEFT_BOUND + 120, window.innerWidth - CHAR_W - 24);
    const ballMax = () => window.innerWidth - BALL_W - 12;

    const savedX = Number(window.localStorage.getItem("mascotX"));
    const startX = Number.isFinite(savedX) && savedX >= LEFT_BOUND ? savedX : 56;

    const st = {
      mascotX: startX,
      facing: 1 as 1 | -1,
      ballX: startX + 80,
      ballY: 0, // height above ground
      ballVX: 0,
      ballVY: 0,
      ballAngle: 0,
      airborne: false,
      kicking: false,
      kickAt: 0, // timestamp the current kick started
      kickedThisSwing: false,
      cooldownUntil: 0,
      stepAccum: 0,
      stepFrame: false,
      dragging: false,
      mode: "dribble" as "dribble" | "juggle",
      modeUntil: 0, // timestamp when the current mode ends (0 = uninitialised)
      juggleTouch: 0, // timestamp of the last juggle foot-tap
    };

    const showLeg = (name: string) => {
      for (const key of Object.keys(legRefs.current)) {
        const el = legRefs.current[key];
        if (el) el.style.display = key === name ? "" : "none";
      }
    };

    let isWalking = false;

    const render = (now: number) => {
      if (containerRef.current) containerRef.current.style.left = `${st.mascotX}px`;
      const bob = reduce || st.kicking || (!st.dragging && isWalking) ? 0 : Math.sin(now / 320) * 1.6;
      if (svgRef.current) svgRef.current.style.transform = `translateY(${bob}px) scaleX(${st.facing})`;
      if (ballRef.current) {
        ballRef.current.style.left = `${st.ballX}px`;
        ballRef.current.style.bottom = `${BALL_BOTTOM + st.ballY}px`;
        ballRef.current.style.transform = `rotate(${st.ballAngle}deg)`;
      }
    };

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (reduce || st.dragging) {
        showLeg(st.kicking ? "kick" : "idle");
        render(now);
        raf = requestAnimationFrame(tick);
        return;
      }

      // Alternate between dribbling across the screen and juggling in place.
      if (st.modeUntil === 0) st.modeUntil = now + DRIBBLE_MS;
      if (now >= st.modeUntil) {
        if (st.mode === "dribble") {
          st.mode = "juggle";
          st.modeUntil = now + JUGGLE_MS;
          st.airborne = false;
          st.kicking = false;
          st.ballVX = 0;
          st.ballX = st.mascotX + CHAR_W / 2 - BALL_W / 2; // gather the ball
          st.ballY = 0.1;
          st.ballVY = JUGGLE_UP; // pop it up to start juggling
        } else {
          st.mode = "dribble";
          st.modeUntil = now + DRIBBLE_MS;
          st.ballVY = 0;
          st.ballY = 0;
          st.cooldownUntil = now + 300;
        }
      }

      // ── Juggling: keep the ball bouncing up and down off little foot taps ──
      if (st.mode === "juggle") {
        isWalking = false;
        st.facing = 1;
        const center = st.mascotX + CHAR_W / 2;
        const target = center - BALL_W / 2 + Math.sin(now / 220) * 5; // tiny sway
        st.ballX += (target - st.ballX) * Math.min(1, dt * 12);
        st.ballVY -= GRAVITY * dt;
        st.ballY += st.ballVY * dt;
        st.ballAngle += dt * 90;
        if (st.ballY <= 0) {
          st.ballY = 0;
          if (st.ballVY < 0) {
            st.ballVY = JUGGLE_UP; // tap it back up
            st.juggleTouch = now;
          }
        }
        // Flick a foot up on each touch, otherwise stand.
        showLeg(now - st.juggleTouch < 130 ? "kick" : "idle");
        render(now);
        raf = requestAnimationFrame(tick);
        return;
      }

      const mascotCenter = st.mascotX + CHAR_W / 2;
      const ballCenter = st.ballX + BALL_W / 2;
      const toBall = ballCenter - mascotCenter;
      isWalking = false;

      // Ball physics ----------------------------------------------------------
      if (st.airborne) {
        st.ballVY -= GRAVITY * dt;
        st.ballX += st.ballVX * dt;
        st.ballY += st.ballVY * dt;
        st.ballAngle += st.ballVX * dt * 14;

        // Bounce off the walls
        if (st.ballX < LEFT_BOUND) {
          st.ballX = LEFT_BOUND;
          st.ballVX = Math.abs(st.ballVX) * 0.6;
        } else if (st.ballX > ballMax()) {
          st.ballX = ballMax();
          st.ballVX = -Math.abs(st.ballVX) * 0.6;
        }

        // Land / bounce on the ground
        if (st.ballY <= 0) {
          st.ballY = 0;
          if (st.ballVY < -40) {
            st.ballVY = -st.ballVY * 0.5; // bounce
          } else {
            st.ballVY = 0;
            st.ballVX *= Math.exp(-3 * dt); // rolling friction
            if (Math.abs(st.ballVX) < 8) {
              st.ballVX = 0;
              st.airborne = false; // come to rest
            }
          }
        }
      }

      // Mascot behaviour ------------------------------------------------------
      if (st.kicking) {
        showLeg("kick");
        // Apply the impulse mid-swing, exactly once.
        if (!st.kickedThisSwing && now - st.kickAt > 110) {
          st.ballVX = st.facing * KICK_VX;
          st.ballVY = KICK_VY;
          st.ballY = 0.1;
          st.airborne = true;
          st.kickedThisSwing = true;
        }
        if (now - st.kickAt > 320) {
          st.kicking = false;
          st.cooldownUntil = now + 450;
        }
      } else if (!st.airborne && Math.abs(toBall) <= KICK_RANGE && now >= st.cooldownUntil) {
        // Reached the ball → wind up a kick
        st.facing = toBall >= 0 ? 1 : -1;
        st.kicking = true;
        st.kickAt = now;
        st.kickedThisSwing = false;
      } else {
        // Walk toward the ball
        st.facing = toBall >= 0 ? 1 : -1;
        st.mascotX += st.facing * WALK_SPEED * dt;
        st.mascotX = Math.max(LEFT_BOUND, Math.min(rightBound(), st.mascotX));
        isWalking = true;
        st.stepAccum += dt;
        if (st.stepAccum >= STEP_INTERVAL) {
          st.stepAccum = 0;
          st.stepFrame = !st.stepFrame;
        }
        showLeg(st.stepFrame ? "walkA" : "walkB");
      }

      render(now);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    // ── Drag to reposition (vs. click to cheer) ──
    const el = containerRef.current?.querySelector("button");
    let drag: { offset: number; startX: number; moved: boolean; id: number } | null = null;

    const onDown = (e: PointerEvent) => {
      drag = { offset: e.clientX - st.mascotX, startX: e.clientX, moved: false, id: e.pointerId };
      st.dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.startX) > 4) drag.moved = true;
      st.mascotX = Math.max(LEFT_BOUND, Math.min(rightBound(), e.clientX - drag.offset));
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      st.dragging = false;
      if (!drag.moved) {
        setCheer(true);
        window.setTimeout(() => setCheer(false), 1400);
      } else {
        window.localStorage.setItem("mascotX", String(Math.round(st.mascotX)));
      }
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      drag = null;
    };

    el?.addEventListener("pointerdown", onDown);
    el?.addEventListener("pointermove", onMove);
    el?.addEventListener("pointerup", onUp);
    el?.addEventListener("pointercancel", onUp);

    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener("pointerdown", onDown);
      el?.removeEventListener("pointermove", onMove);
      el?.removeEventListener("pointerup", onUp);
      el?.removeEventListener("pointercancel", onUp);
    };
  }, [active]);

  if (!active) return null;

  const bodyCells = cellsFrom(BODY, palette, 0);

  return (
    <>
      {/* The ball — its own element so it can fly and roll independently. */}
      <div
        ref={ballRef}
        aria-hidden="true"
        className="pointer-events-none fixed z-30 select-none"
        style={{ left: 130, bottom: BALL_BOTTOM, width: BALL_W, willChange: "left, bottom, transform" }}
      >
        <svg
          width={BALL_W}
          height={BALL_W}
          viewBox="0 0 8 8"
          shapeRendering="crispEdges"
          className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"
        >
          {cellsFrom(BALL, BALL_COLORS)}
        </svg>
      </div>

      {/* The footballer. */}
      <div
        ref={containerRef}
        className="pointer-events-none fixed z-30 select-none"
        style={{ left: 56, bottom: CHAR_BOTTOM, willChange: "left" }}
      >
        {cheer && (
          <div className="absolute -top-6 left-10 animate-bounce rounded-md bg-foreground px-2 py-0.5 text-[10px] font-bold text-background shadow">
            GOAL! ⚽
          </div>
        )}
        <button
          type="button"
          aria-label="Football mascot — drag to move, click to cheer"
          className="pointer-events-auto block cursor-grab touch-none opacity-90 transition-transform hover:scale-110 active:cursor-grabbing focus-visible:outline-none"
        >
          <svg
            ref={svgRef}
            width={CHAR_W}
            height={72}
            viewBox="0 0 16 18"
            shapeRendering="crispEdges"
            aria-hidden="true"
            className="drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
            style={{ willChange: "transform" }}
          >
            <g>{bodyCells}</g>
            {Object.keys(LEGS).map((name) => (
              <g
                key={name}
                ref={(node) => {
                  legRefs.current[name] = node;
                }}
                style={{ display: name === "idle" ? "" : "none" }}
              >
                {cellsFrom(LEGS[name], palette, 14)}
              </g>
            ))}
          </svg>
        </button>
      </div>
    </>
  );
}
