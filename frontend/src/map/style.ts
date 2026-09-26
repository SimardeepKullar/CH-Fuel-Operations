/**
 * The base map (PROJECT-SCOPE §9.3): OpenFreeMap — free, keyless, no account,
 * OSM-derived. Swapping to MapTiler or Protomaps later is a change to this
 * file only: the style URL and the attribution that licence requires. The
 * routing provider never touches it (§9.2).
 *
 * URL pattern and attribution wording are OpenFreeMap's own
 * (openfreemap.org/quick_start). Positron is its muted light style, so the
 * route and pins drawn over it stay the loudest thing on the map.
 */
export const BASE_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Shown alongside the API's own `attribution` — the tiles carry their own licence. */
export const BASE_MAP_ATTRIBUTION = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";

/** The style's glyph server serves these; a symbol layer naming any other font draws nothing. */
export const LABEL_FONT = ["Noto Sans Bold"];

/** Contiguous US — the view before a plan arrives. `[west, south, east, north]`. */
export const INITIAL_BOUNDS: [number, number, number, number] = [-125, 24, -66.9, 49.5];
