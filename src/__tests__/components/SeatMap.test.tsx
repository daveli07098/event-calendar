import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeatMap } from "@/components/venue/SeatMap";
import { parseSeat } from "@/lib/seat-parse";
import { THEATRE_HEDGE } from "@/lib/venue-seatmap/geometry";
import { aweLikeArena, coliseumLike, seatWith, theatreLike } from "../lib/venue-seatmap-layout-fixtures";

describe("SeatMap (2D)", () => {
  it("still renders Kai Tak by venue name, with a stage and a marker", () => {
    const { container } = render(<SeatMap venue="Kai Tak Stadium" seat={parseSeat("Level 5 Block 519B Row M Seat 1")} />);
    expect(screen.getByTestId("seat-map")).toBeInTheDocument();
    expect(screen.getByTestId("seat-map-stage")).toBeInTheDocument();
    expect(container.querySelector("circle")).not.toBeNull();
    expect(screen.queryAllByTestId("seat-map-floor-block")).toHaveLength(0);
  });

  it("draws the AWE-like floor blocks from the config prop, highlighting the seat's block", () => {
    const { container } = render(<SeatMap venue="Some Unmapped Arena" config={aweLikeArena} seat={seatWith("C", "4")} />);
    const blocks = screen.getAllByTestId("seat-map-floor-block");
    expect(blocks.map((b) => b.textContent)).toEqual(["A", "B", "C", "D"]);
    expect(blocks[2].querySelector("rect")?.getAttribute("class")).toContain("fill-primary");
    expect(blocks[0].querySelector("rect")?.getAttribute("class")).not.toContain("fill-primary");
    expect(container.querySelector("circle")).not.toBeNull();
    expect(screen.getByText("Floor")).toBeInTheDocument(); // level label in the caption
  });

  it("places the centre-stage stage box in the middle of the plan", () => {
    render(<SeatMap venue={null} config={coliseumLike} seat={seatWith("44", "B")} />);
    const stage = screen.getByTestId("seat-map-stage");
    const { outer } = coliseumLike.plan!;
    const x = Number(stage.getAttribute("x")) + Number(stage.getAttribute("width")) / 2;
    const y = Number(stage.getAttribute("y")) + Number(stage.getAttribute("height")) / 2;
    expect(x).toBeCloseTo(24 + outer.width / 2);
    expect(y).toBeCloseTo(24 + outer.height / 2);
  });

  it("renders the theatre hedge instead of a map", () => {
    const { container } = render(<SeatMap venue={null} config={theatreLike} seat={seatWith("Left", "C")} />);
    expect(screen.getByTestId("seat-map-theatre")).toHaveTextContent(THEATRE_HEDGE);
    expect(container.querySelector("svg")).toBeNull();
  });
});
