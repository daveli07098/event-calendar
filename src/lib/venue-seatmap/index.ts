/** Barrel export for the venue seat-map lib layer. See geometry.ts for the main entry point
 * (`resolveSeatGeometry`) and types.ts for the full data-shape documentation. */

export * from "./types";
export { resolveSeatGeometry, DEFAULT_STAGE_POSITION } from "./geometry";
export type { ResolveSeatGeometryOptions } from "./geometry";
export { matchVenueConfig, getVenueSeatMapConfigById, listVenueSeatMapConfigs } from "./registry";
export { DEFAULT_ROW_SEQUENCE, defaultRowDepthFraction, bankedRowDepthFraction } from "./rows";
export { pointOnPerimeter, pointAtDepth, sampleArc, pointsToPolylinePath, bandPath } from "./perimeter";
export type { RectSize, Point } from "./perimeter";
export { kaiTakStadium } from "./venues/kai-tak";
