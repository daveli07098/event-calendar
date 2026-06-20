"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { getEventTheme } from "@/lib/event-themes";
import { getTeamKit } from "@/lib/team-kits";
import { getTeamFlag } from "@/lib/team-flags";
import { useWorldCupMatches } from "@/lib/use-worldcup-matches";

// Pre-baked confetti burst (fixed offsets/colours so it never re-randomizes on
// re-render). Each piece flies up-and-out then falls; see `confettiBurst` in CSS.
const CONFETTI: { dx: number; color: string; delay: number }[] = [
  { dx: -34, color: "#dc2626", delay: 0 },
  { dx: -22, color: "#fcd116", delay: 40 },
  { dx: -10, color: "#2563eb", delay: 90 },
  { dx: 2, color: "#16a34a", delay: 20 },
  { dx: 14, color: "#f97316", delay: 70 },
  { dx: 26, color: "#a855f7", delay: 30 },
  { dx: 38, color: "#06b6d4", delay: 110 },
  { dx: -28, color: "#ec4899", delay: 130 },
  { dx: 8, color: "#fcd116", delay: 150 },
];

/** True when the ISO timestamp falls on the local "today". */
function isTodayLocal(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

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
const JUGGLE_UP = 380; // px/s upward bounce for keepie-uppies (higher pops)
const DRIBBLE_MS = 7000; // time spent running/dribbling before switching
const JUGGLE_MS = 4500; // time spent juggling the ball up and down
const IDLE_MS = 4000; // time spent standing idle
const RALLY_MS = 6800; // time spent rallying (fits 2-3 longer chants)
const RALLY_CHANT_MS = 2300; // each rally chant stays on screen this long
const RALLY_CHANCE = 0.22; // chance a mode switch becomes a rally (seldom)
const IDLE_CHANCE = 0.28; // chance a mode switch becomes a quiet idle stand
const CASUAL_MIN_MS = 5000; // passing cheers fire at a random gap in this range…
const CASUAL_MAX_MS = 15000; // …so they sprinkle across every move, unpredictably

// Chants shown while rallying, picked at random. `%s` → the supported team name.
const CHANTS = [
  "加油! 💪",
  "Let's go %s! ⚽",
  "We are the champions! 🏆",
  "%s 必勝! 🔥",
  "GO GO GO! 📣",
  "射門得分! ⚽",
  "Olé olé olé! 🎶",
  "誰是冠軍? %s! 👑",
  "衝呀! 全力以赴! 🏃",
  "World Cup fever! 🌍",
  "Come on %s! 💚",
  "勝利在望! ✨",
  "Score! Score! Score! 🥅",
  "永不放棄! 🙌",
  "全場最強 %s! 💯",
  "Believe in the team! 🌟",
  "頂住! 加油加油! 📣",
  "冠軍是我們的! 🏆",
  "Unstoppable %s! ⚡",
  "一球入魂! ⚽🔥",
];

/** Pick a random chant, fill in the team name and tidy spacing. */
function pickChant(team: string): string {
  const idx = Math.floor(Math.random() * CHANTS.length);
  return CHANTS[idx].replace("%s", team).replace(/\s+([!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/**
 * A small supporting fan that pops in beside the mascot during a rally and
 * vanishes in a Pokémon-style white flash when it ends. Pure CSS animation —
 * no physics. Wears the same team kit.
 */
function MiniFan({ palette, side, exiting }: { palette: Record<string, string>; side: "left" | "right"; exiting: boolean }) {
  const body = cellsFrom(BODY, palette, 0);
  const legs = cellsFrom(LEGS.idle, palette, 14);
  return (
    <div
      aria-hidden="true"
      className="absolute bottom-0 select-none"
      style={{
        left: side === "left" ? -44 : 70,
        animation: exiting ? "pokemonFlash 0.6s ease-in forwards" : "friendPop 0.35s ease-out both",
      }}
    >
      <svg
        width={18} height={22} viewBox="0 0 15 17" shapeRendering="crispEdges"
        className="absolute drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"
        style={{ left: side === "left" ? -6 : 32, bottom: 22, transformOrigin: "left center", animation: "flagWave 1.1s ease-in-out infinite" }}
      >
        <rect x={1} y={0} width={1} height={17} fill="#6b4f2a" />
        <rect x={2} y={1} width={11} height={6} fill={palette.j} />
        <rect x={2} y={3} width={11} height={2} fill={palette.p} />
      </svg>
      <svg
        width={42} height={47} viewBox="0 0 16 18" shapeRendering="crispEdges"
        className="drop-shadow-[0_2px_2px_rgba(0,0,0,0.3)]"
        style={{ animation: "mascotBob 1.9s ease-in-out infinite" }}
      >
        <g>{body}</g>
        <g>{legs}</g>
      </svg>
    </div>
  );
}

export function FootballMascot() {
  const { theme } = useTheme();
  const [cheer, setCheer] = useState(false);
  // Mirror of the animation loop's mode (set only on transitions, not per frame)
  // so the flag / drum / chant can render declaratively.
  const [displayMode, setDisplayMode] = useState<"dribble" | "juggle" | "rally" | "idle">("dribble");
  const [chant, setChant] = useState<string | null>(null);
  // Supporting friends: "in" while rallying, "out" for the flash-fade, then hidden.
  const [friendsPhase, setFriendsPhase] = useState<"hidden" | "in" | "out">("hidden");

  const active = getEventTheme(theme.eventTheme)?.id === "worldcup";

  // The mascot wears the kit of the team the user supports (or a default red).
  const kit = getTeamKit(theme.favouriteTeam);
  const palette: Record<string, string> = { ...COLORS, j: kit.jersey, p: kit.shorts, n: kit.trim };
  const teamName = theme.favouriteTeam ?? "";

  // Match-day awareness: does the supported team play today? If so the mascot
  // flies a national-flag pennant. Best-effort — no team or no fixtures → off.
  const { matches } = useWorldCupMatches(active && !!theme.favouriteTeam);
  const teamFlag = getTeamFlag(theme.favouriteTeam);
  const matchDay =
    !!theme.favouriteTeam &&
    matches.some(
      (m) =>
        (m.home === theme.favouriteTeam || m.away === theme.favouriteTeam) &&
        isTodayLocal(m.kickoff),
    );

  // While rallying, rotate through chants every ~1.6s (and clear when it ends).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing animation mode → chant text
    if (displayMode !== "rally") { setChant(null); return; }
    // While standing with friends, say just a few sentences, each lingering.
    setChant(pickChant(teamName));
    const id = window.setInterval(() => setChant(pickChant(teamName)), RALLY_CHANT_MS);
    return () => window.clearInterval(id);
  }, [displayMode, teamName]);

  // Current mode, mirrored to a ref so the cheer timer below can read it without
  // resubscribing on every mode change (which would keep resetting the timer).
  const modeRef = useRef(displayMode);
  useEffect(() => { modeRef.current = displayMode; }, [displayMode]);

  // Passing cheers sprinkled across every move at a random gap. Independent of
  // mode changes so the timer actually fires; skips the rally (its own chants).
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const schedule = () => {
      const delay = CASUAL_MIN_MS + Math.random() * (CASUAL_MAX_MS - CASUAL_MIN_MS);
      timer = window.setTimeout(() => {
        if (modeRef.current !== "rally") {
          setChant(pickChant(teamName));
          window.setTimeout(() => setChant(null), 2400);
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [active, teamName]);

  // Friends appear during a rally and flash out (Pokémon-style) when it ends.
  useEffect(() => {
    if (displayMode === "rally") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mode → friends visibility
      setFriendsPhase("in");
      return;
    }
    setFriendsPhase((p) => (p === "in" ? "out" : p));
    const t = window.setTimeout(() => setFriendsPhase("hidden"), 650);
    return () => window.clearTimeout(t);
  }, [displayMode]);

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
      mode: "dribble" as "dribble" | "juggle" | "rally" | "idle",
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

      // Cycle modes: running (dribble) ↔ juggle, plus occasional idle and rally.
      if (st.modeUntil === 0) st.modeUntil = now + DRIBBLE_MS;
      if (now >= st.modeUntil) {
        const next: "dribble" | "juggle" | "rally" | "idle" =
          st.mode === "rally"
            ? "dribble" // always settle back to running after a rally
            : (() => {
                const r = Math.random();
                if (r < RALLY_CHANCE) return "rally";
                if (r < RALLY_CHANCE + IDLE_CHANCE) return "idle";
                return st.mode === "dribble" ? "juggle" : "dribble";
              })();
        st.mode = next;
        if (next === "juggle") {
          st.modeUntil = now + JUGGLE_MS;
          st.airborne = false;
          st.kicking = false;
          st.ballVX = 0;
          st.ballX = st.mascotX + CHAR_W / 2 - BALL_W / 2; // gather the ball
          st.ballY = 0.1;
          st.ballVY = JUGGLE_UP; // pop it up to start juggling
        } else if (next === "rally") {
          st.modeUntil = now + RALLY_MS;
          st.airborne = false;
          st.kicking = false;
          st.ballVX = 0;
          st.ballVY = 0;
          st.ballY = 0;
        } else if (next === "idle") {
          st.modeUntil = now + IDLE_MS;
          st.airborne = false;
          st.kicking = false;
          st.ballVX = 0;
          st.ballVY = 0;
          st.ballY = 0;
        } else {
          st.modeUntil = now + DRIBBLE_MS;
          st.ballVY = 0;
          st.ballY = 0;
          st.cooldownUntil = now + 300;
        }
        setDisplayMode(next); // mirror to React for flag/drum/chant rendering
      }

      // ── Rally / idle: stand still, ball resting at the feet ──
      if (st.mode === "rally" || st.mode === "idle") {
        isWalking = false;
        st.facing = 1;
        const center = st.mascotX + CHAR_W / 2;
        st.ballX += ((center - BALL_W / 2) - st.ballX) * Math.min(1, dt * 8); // ball rests at feet
        st.ballY = 0;
        showLeg("idle");
        render(now);
        raf = requestAnimationFrame(tick);
        return;
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

        {/* Confetti burst on the GOAL cheer */}
        {cheer && (
          <div className="pointer-events-none absolute left-1/2 top-2" aria-hidden="true">
            {CONFETTI.map((c, i) => (
              <span
                key={i}
                className="ec-confetti"
                style={{
                  backgroundColor: c.color,
                  // CSS custom prop consumed by the confettiBurst keyframes
                  ["--dx" as string]: `${c.dx}px`,
                  animationDelay: `${c.delay}ms`,
                }}
              />
            ))}
          </div>
        )}

        {/* Match-day pennant: supported team's national flag flies above him.
            Shown only in the calm dribble/juggle state — suppressed while
            cheering or rallying (chant bubble, waving flag, drum and friends
            already occupy the space above him) to avoid overlapping. */}
        {matchDay && teamFlag && !cheer && !chant && displayMode !== "rally" && friendsPhase === "hidden" && (
          <div
            className="absolute -top-7 left-8 flex items-center gap-1 rounded-full bg-foreground px-1.5 py-0.5 text-[9px] font-bold text-background shadow"
            style={{ animation: "mascotBob 1.6s ease-in-out infinite" }}
          >
            <span className="text-[11px] leading-none">{teamFlag}</span>
            MATCH DAY
          </div>
        )}

        {/* Rally: chant bubble, a waving team flag, and a drum to beat */}
        {chant && (
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 animate-bounce whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-[10px] font-bold text-background shadow">
            {chant}
          </div>
        )}
        {displayMode === "rally" && (
          <>
            {/* Team flag on a pole, waving */}
            <svg
              width={30}
              height={34}
              viewBox="0 0 15 17"
              shapeRendering="crispEdges"
              aria-hidden="true"
              className="absolute drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"
              style={{ left: 50, bottom: 28, transformOrigin: "left center", animation: "flagWave 1.1s ease-in-out infinite" }}
            >
              <rect x={1} y={0} width={1} height={17} fill="#6b4f2a" />
              <rect x={2} y={1} width={11} height={6} fill={kit.jersey} />
              <rect x={2} y={3} width={11} height={2} fill={kit.shorts} />
            </svg>
            {/* Drum at the mascot's feet, beating */}
            <span
              aria-hidden="true"
              className="absolute text-base leading-none"
              style={{ left: 36, bottom: -2, transformOrigin: "center bottom", animation: "drumBeat 0.5s ease-in-out infinite" }}
            >
              🥁
            </span>
          </>
        )}
        {/* Supporting friends — cheer together, then vanish in a flash */}
        {friendsPhase !== "hidden" && (
          <>
            <MiniFan palette={palette} side="left" exiting={friendsPhase === "out"} />
            <MiniFan palette={palette} side="right" exiting={friendsPhase === "out"} />
          </>
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
