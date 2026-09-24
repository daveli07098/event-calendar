import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SeatMap3D } from "@/components/venue/SeatMap3D";
import { parseSeat } from "@/lib/seat-parse";
import { APPROXIMATE_BOWL } from "@/lib/venue-seatmap/bowl3d";
import { THEATRE_HEDGE } from "@/lib/venue-seatmap/geometry";
import { SEAT_LAYOUT_HEDGE } from "@/lib/venue-seatmap/seats3d";
import { aweLikeArena, coliseumLike, seatWith, theatreLike } from "../lib/venue-seatmap-layout-fixtures";

// Instances created by the stubs below, so tests can assert on disposal.
const created = vi.hoisted(() => ({
  renderers: [] as { dispose: ReturnType<typeof import("vitest").vi.fn> }[],
  composers: [] as { dispose: ReturnType<typeof import("vitest").vi.fn>; passes: unknown[] }[],
}));

// Partial mock: only WebGLRenderer is stubbed (it would otherwise fail to acquire a real GL
// context under jsdom), everything else (Vector3, PerspectiveCamera, Scene, materials,
// InstancedMesh, Raycaster, ...) is the real three.js implementation, so the component's own
// math (camera flight, instancing, raycasts) actually runs against real objects.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  const { vi: v } = await import("vitest");
  class StubWebGLRenderer {
    domElement: HTMLCanvasElement;
    dispose = v.fn();
    constructor({ canvas }: { canvas: HTMLCanvasElement }) {
      this.domElement = canvas;
      created.renderers.push(this);
    }
    setPixelRatio() {}
    setSize() {}
    render() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer: StubWebGLRenderer };
});

vi.mock("three/addons/controls/OrbitControls.js", async () => {
  const THREE = await import("three");
  class StubOrbitControls {
    target: InstanceType<typeof THREE.Vector3>;
    enableDamping = false;
    enabled = true;
    enableZoom = true;
    enablePan = true;
    maxPolarAngle = Math.PI;
    constructor() {
      this.target = new THREE.Vector3();
    }
    update() {}
    dispose() {}
    addEventListener() {}
    removeEventListener() {}
  }
  return { OrbitControls: StubOrbitControls };
});

// Post-processing stubs (the bloom path) — real passes need a live GL context.
vi.mock("three/addons/postprocessing/EffectComposer.js", async () => {
  const { vi: v } = await import("vitest");
  class EffectComposer {
    passes: unknown[] = [];
    dispose = v.fn();
    constructor() {
      created.composers.push(this);
    }
    addPass(pass: unknown) {
      this.passes.push(pass);
    }
    setPixelRatio() {}
    setSize() {}
    render() {}
  }
  return { EffectComposer };
});
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({
  RenderPass: class {
    dispose() {}
  },
}));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: class {
    dispose() {}
  },
}));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({
  OutputPass: class {
    dispose() {}
  },
}));

const KAI_TAK = "Kai Tak Stadium";

/** A block on Level 2's confirmed 201-240 range — resolves a full geometry with a known arc
 * position, so bowl3d.ts is expected to produce a non-null `seat`. */
const RESOLVABLE_SEAT = parseSeat("Gate F Level 2 Block 225 Row BB Seat 101");

/** Level 2's 101-110 sub-section: confirmed to belong to Level 2, but its arc position is
 * documented `positionConfidence: "unconfirmed"` (see venue-seatmap.test.ts) — bowl3d.ts must
 * never guess an eye position for it, so `seat` stays null. */
const UNCONFIRMED_BLOCK_SEAT = parseSeat("Level 2 Block 105 Row A Seat 1");

describe("SeatMap3D", () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom's canvas.getContext returns null by default; stub it truthy so the happy-path
    // tests actually take the WebGL branch instead of always hitting the fallback.
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => ({}) as unknown as RenderingContext);
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    created.renderers.length = 0;
    created.composers.length = 0;
  });

  /** Waits until the lazy three.js setup has built the scene and rendered its first frame. */
  async function renderedContainer() {
    const container = await screen.findByTestId("seat-map-3d-canvas-container");
    await waitFor(() => expect(container.dataset.rendered).toBe("1"), { timeout: 5000 });
    return container;
  }

  it("renders the canvas container, both camera buttons, and the model's hedge lines for a resolvable Kai Tak seat", async () => {
    render(<SeatMap3D venue={KAI_TAK} seat={RESOLVABLE_SEAT} />);

    const container = await screen.findByTestId("seat-map-3d-canvas-container");
    expect(container).toHaveAttribute("aria-label", "3D seat view of the venue bowl");

    // Every model always carries the schematic-simulation caveat (see bowl3d.ts's
    // `APPROXIMATE_BOWL.approximationNotice`) — proves the hedge list actually renders.
    expect(screen.getByText(APPROXIMATE_BOWL.approximationNotice)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Bowl view" })).toBeInTheDocument();
    const fromYourSeat = screen.getByRole("button", { name: "From your seat" });
    expect(fromYourSeat).toBeInTheDocument();
    // Block 225 sits in Level 2's documented, confirmed 201-240 range — bowl3d.ts should
    // resolve a real eye position for it, so the button must be enabled.
    expect(fromYourSeat).not.toBeDisabled();

    // Wait for the lazy `three`/OrbitControls import (and scene setup) to actually complete —
    // proves the mocked modules are exercised, not just declared, and that clicking through to
    // "From your seat" runs the real applyMode/Vector3 math against the stub controls without
    // throwing.
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());
    // Clicking runs the real applyMode/Vector3 (copy/lerpVectors) math against the stub
    // controls; asserting it doesn't throw and the button stays clickable afterward.
    fireEvent.click(fromYourSeat);
    expect(fromYourSeat).not.toBeDisabled();
  });

  it("disables 'From your seat' for an unconfirmed block (Level 2's 101-110 sub-section) and surfaces its unconfirmed-position hedge", async () => {
    render(<SeatMap3D venue={KAI_TAK} seat={UNCONFIRMED_BLOCK_SEAT} />);

    const container = await screen.findByTestId("seat-map-3d-canvas-container");
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());

    const fromYourSeat = screen.getByRole("button", { name: "From your seat" });
    expect(fromYourSeat).toBeDisabled();

    // geometry.ts's unconfirmed-position caveat for this exact block, passed through by
    // bowl3d.ts's `hedge: [approximationNotice, ...(geometry?.hedge ?? [])]`.
    expect(
      screen.getByText(/Block 105's position around the bowl is unconfirmed/i),
    ).toBeInTheDocument();
  });

  it("shows the WebGL-unavailable fallback and fires onUnavailable when no GL context can be acquired", async () => {
    getContextSpy.mockImplementation(() => null);
    const onUnavailable = vi.fn();

    render(<SeatMap3D venue={KAI_TAK} seat={RESOLVABLE_SEAT} onUnavailable={onUnavailable} />);

    expect(await screen.findByTestId("seat-map-3d-unavailable")).toHaveTextContent(
      "3D view unavailable on this device",
    );
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("seat-map-3d-canvas-container")).not.toBeInTheDocument();
  });

  it("renders the no-config hint for a venue with no seat-map config", () => {
    const seat = parseSeat("Section 118 Row 12 Seat 5");
    render(<SeatMap3D venue="Some Unmapped Arena" seat={seat} />);

    expect(screen.getByTestId("seat-map-3d-empty")).toHaveTextContent(
      "No 3D seat map available for this venue yet.",
    );
    expect(screen.queryByTestId("seat-map-3d-canvas-container")).not.toBeInTheDocument();
  });

  it("renders nothing meaningful when there's no seat at all", () => {
    const { container } = render(<SeatMap3D venue={KAI_TAK} seat={null} />);
    expect(screen.getByTestId("seat-map-3d-empty")).toBeInTheDocument();
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
  });
  it("renders an explicit config prop instead of name matching (AWE-like floor seat)", async () => {
    // The venue name matches nothing — only the config prop can make this render.
    render(<SeatMap3D venue="Some Unmapped Arena" config={aweLikeArena} seat={seatWith("B", "12")} />);

    const container = await screen.findByTestId("seat-map-3d-canvas-container");
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());
    const fromYourSeat = screen.getByRole("button", { name: "From your seat" });
    expect(fromYourSeat).not.toBeDisabled();
    fireEvent.click(fromYourSeat);
    expect(screen.getByText(/depth bands straight in front of the stage/)).toBeInTheDocument();
  });

  it("renders a centre-stage config with every block placed", async () => {
    render(<SeatMap3D venue={null} config={coliseumLike} seat={seatWith("62", "K")} />);
    const container = await screen.findByTestId("seat-map-3d-canvas-container");
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());
    expect(screen.getByRole("button", { name: "From your seat" })).not.toBeDisabled();
    expect(screen.getByText(/In-the-round staging/)).toBeInTheDocument();
  });

  it("renders the theatre hedge as a muted note (no canvas) for a theatre config", () => {
    const { container } = render(<SeatMap3D venue={null} config={theatreLike} seat={seatWith("Centre", "F")} />);
    expect(screen.getByTestId("seat-map-3d-theatre")).toHaveTextContent(THEATRE_HEDGE);
    expect(screen.queryByTestId("seat-map-3d-canvas-container")).not.toBeInTheDocument();
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
  });

  it("toggles the crowd on and off without rebuilding the scene", async () => {
    render(<SeatMap3D venue={KAI_TAK} seat={RESOLVABLE_SEAT} />);
    await renderedContainer();
    const crowd = screen.getByRole("button", { name: "Crowd" });
    expect(crowd).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(crowd);
    expect(crowd).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(crowd);
    expect(crowd).toHaveAttribute("aria-pressed", "true");
    expect(created.renderers).toHaveLength(1);
  });

  it("flies back to the bowl view on Escape in 'From your seat' mode, without letting Escape bubble out", async () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    try {
      render(<SeatMap3D venue={KAI_TAK} seat={RESOLVABLE_SEAT} />);
      const container = await renderedContainer();
      const bowl = screen.getByRole("button", { name: "Bowl view" });
      const fromYourSeat = screen.getByRole("button", { name: "From your seat" });
      fireEvent.click(fromYourSeat);
      expect(fromYourSeat).toHaveAttribute("aria-pressed", "true");

      fireEvent.keyDown(container, { key: "Escape" });
      expect(bowl).toHaveAttribute("aria-pressed", "true");
      expect(fromYourSeat).toHaveAttribute("aria-pressed", "false");
      expect(outer).not.toHaveBeenCalled();

      // In bowl mode Escape is left alone (e.g. for a surrounding dialog to close).
      fireEvent.keyDown(container, { key: "Escape" });
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", outer);
    }
  });

  it("renders the schematic-seating hedge and a per-level colour legend", async () => {
    render(<SeatMap3D venue={KAI_TAK} seat={RESOLVABLE_SEAT} />);
    await renderedContainer();
    expect(screen.getByText(SEAT_LAYOUT_HEDGE)).toBeInTheDocument();
    const legend = screen.getByTestId("seat-map-3d-legend");
    expect(legend).toHaveTextContent("Level 2");
    expect(legend).toHaveTextContent("Level 5");
    expect(legend).toHaveTextContent("Your seat");
  });

  it("uses the bloom composer on a wide desktop canvas and disposes it (and the renderer) on unmount", async () => {
    const widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    try {
      const { unmount } = render(<SeatMap3D venue={KAI_TAK} seat={RESOLVABLE_SEAT} />);
      await renderedContainer();
      expect(created.composers).toHaveLength(1);
      expect(created.composers[0].passes).toHaveLength(3); // render, bloom, output
      unmount();
      expect(created.composers[0].dispose).toHaveBeenCalledTimes(1);
      expect(created.renderers[0].dispose).toHaveBeenCalledTimes(1);
    } finally {
      widthSpy.mockRestore();
    }
  });

  it("skips bloom on a narrow (mobile-sized) canvas", async () => {
    render(<SeatMap3D venue={KAI_TAK} seat={RESOLVABLE_SEAT} />);
    await renderedContainer();
    expect(created.composers).toHaveLength(0);
  });
});
