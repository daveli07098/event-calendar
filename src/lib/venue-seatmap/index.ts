/** Barrel export for the venue seat-map lib layer. See geometry.ts for the main entry point
 * (`resolveSeatGeometry`) and types.ts for the full data-shape documentation. */

export * from "./types";
export {
  resolveSeatGeometry,
  DEFAULT_STAGE_POSITION,
  THEATRE_HEDGE,
  layoutOf,
  isFloorLevel,
  locateBlock,
  floorPositionFraction,
} from "./geometry";
export type { ResolveSeatGeometryOptions, BlockLocation } from "./geometry";
export { matchVenueConfig, configForVenue, getVenueSeatMapConfigById, listVenueSeatMapConfigs } from "./registry";
export { DEFAULT_ROW_SEQUENCE, defaultRowDepthFraction, bankedRowDepthFraction, numericRowDepthFraction } from "./rows";
export {
  pointOnPerimeter,
  pointOnFullPerimeter,
  pointAtDepth,
  sampleArc,
  arcSamples,
  pointsToPolylinePath,
  bandPath,
  ringPath,
  planRectsFor,
  perimeterKindFor,
  floorBandRect,
  seatPlanPoint,
} from "./perimeter";
export type { RectSize, Point, PerimeterKind } from "./perimeter";
export { kaiTakStadium } from "./venues/kai-tak";
export { buildBowl3D, APPROXIMATE_BOWL, hasConfirmedRange } from "./bowl3d";
export type { Vec3, Bowl3DSlab, Bowl3DFloorBlock, Bowl3DModel } from "./bowl3d";
export { buildSeatLayout3D, describeSeat, nearestSeatInBlock, SEAT_LAYOUT, SEAT_DENSITY, SEAT_LAYOUT_HEDGE } from "./seats3d";
export type { SeatBlock3D, OwnSeat3D, SeatLayout3D, SeatLayoutOptions } from "./seats3d";
