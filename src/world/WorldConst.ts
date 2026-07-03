/** World dimensions and shared constants. */

/** Playable half-extent in meters (playable area is 1.6 km × 1.6 km). */
export const PLAY_HALF = 800;
/** Far scenery extends to this radius (4 km horizon composition). */
export const FAR_RADIUS = 3600;
/** Village center = capture crossroads at the origin. */
export const VILLAGE_RADIUS = 240;
/** Capture zone radius around the crossroads (meters). */
export const CAPTURE_RADIUS = 30;
/** Nav/cover grid cell size in meters (Phase 2 consumes this). */
export const GRID_CELL = 2;
/** Sun direction reference: azimuth/elevation for late afternoon. */
export const SUN_AZIMUTH = 2.35;
export const SUN_ELEVATION = 0.42;
