import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson";
import type { LayerSpecification } from "maplibre-gl";
import { milesToMeters } from "@ch/core/domain/units";
import type { CompletedPlanResponse, RouteBounds, StationLocationSummary } from "@ch/core/domain/planResponse";
import { decodePolyline } from "./polyline";
import { LABEL_FONT } from "./style";

/**
 * The five §9.3 layers, as pure data: MapLibre layer specs plus the GeoJSON
 * each draws, built from one plan payload. No map, no DOM — RouteMap hands
 * these to MapLibre, and the tests assert on them directly.
 */

/** Source ids. A source and its main layer share a name; MapLibre keeps them in separate namespaces. */
export const SOURCE = {
  baseline: "route-baseline",
  optimized: "route-optimized",
  uncertainty: "stations-uncertainty",
  candidate: "stations-candidate",
  sheet: "stations-sheet",
  endpoints: "endpoints",
  selected: "stations-selected",
  highlight: "stations-highlight",
} as const;

export const LAYER = {
  baseline: "route-baseline",
  optimized: "route-optimized",
  uncertaintyFill: "stations-uncertainty-fill",
  uncertaintyOutline: "stations-uncertainty-outline",
  sheet: "stations-sheet",
  candidate: "stations-candidate",
  endpoints: "endpoints",
  selected: "stations-selected",
  selectedLabel: "stations-selected-label",
  highlightDot: "stations-highlight-dot",
  highlightRing: "stations-highlight-ring",
} as const;

// MapLibre paint properties cannot read CSS custom properties; these mirror
// App.css's tokens by value and must move with them.
const COLOR = {
  accent: "#00a6e2", // --color-accent
  navy: "#16205c", // --color-accent-800
  muted: "#7b869e", // --color-muted
  candidate: "#2f7d4f", // --color-candidate
  amber: "#f5a623", // --color-amber — bright, distinct from the muted sheet-archived accent
  white: "#ffffff",
  // --color-highlight — the "Cheapest along route" hover ring. Deliberately not
  // accent blue: that's already the route line and every selected pin's colour,
  // so a same-coloured ring around one didn't read as a separate highlight.
  highlight: "#7c3aed",
};

/**
 * Draw order, bottom to top: routes, then every priced sheet station (the
 * widest, least specific layer), then the in-corridor candidates, then
 * uncertainty under the selected points, then the points, numbers last.
 */
export const MAP_LAYERS: LayerSpecification[] = [
  {
    id: LAYER.baseline,
    type: "line",
    source: SOURCE.baseline,
    layout: { "line-join": "round", "line-cap": "butt" },
    paint: { "line-color": COLOR.muted, "line-width": 2.5, "line-opacity": 0.85, "line-dasharray": [2, 2] },
  },
  {
    id: LAYER.optimized,
    type: "line",
    source: SOURCE.optimized,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": COLOR.accent, "line-width": 4.5 },
  },
  {
    id: LAYER.uncertaintyFill,
    type: "fill",
    source: SOURCE.uncertainty,
    paint: { "fill-color": COLOR.accent, "fill-opacity": 0.12 },
  },
  {
    id: LAYER.uncertaintyOutline,
    type: "line",
    source: SOURCE.uncertainty,
    paint: { "line-color": COLOR.accent, "line-width": 1, "line-dasharray": [3, 2] },
  },
  {
    id: LAYER.sheet,
    type: "circle",
    source: SOURCE.sheet,
    // Hidden until the "Show all sheet stations" toggle shows it —
    // UI-DATA-CONTRACT §3.8's small solid dots.
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 4.5,
      "circle-color": COLOR.candidate,
      "circle-opacity": 0.9,
    },
  },
  {
    id: LAYER.candidate,
    type: "circle",
    source: SOURCE.candidate,
    // Hidden until the "Show in-corridor not selected" toggle shows it — toggled
    // by visibility, never by refetching. Same size as the sheet layer's dots,
    // solid amber instead of green so the two stay visually distinct.
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 4.5,
      "circle-color": COLOR.amber,
      "circle-opacity": 0.9,
    },
  },
  {
    id: LAYER.endpoints,
    type: "circle",
    source: SOURCE.endpoints,
    // Origin a hollow ring, destination solid — the wireframe's two endpoint marks.
    paint: {
      "circle-radius": 7,
      "circle-color": ["match", ["get", "role"], "origin", COLOR.white, COLOR.navy],
      "circle-stroke-color": COLOR.navy,
      "circle-stroke-width": 3,
    },
  },
  {
    id: LAYER.selected,
    type: "circle",
    source: SOURCE.selected,
    // A city-tier pin (`approx`) is drawn hollow. Its true-scale uncertainty
    // circle is smaller than the pin at route zoom, so the pin itself has to
    // say "town, not forecourt" until the dispatcher zooms in.
    paint: {
      "circle-radius": 10,
      "circle-color": ["case", ["get", "approx"], COLOR.white, COLOR.accent],
      "circle-stroke-color": ["case", ["get", "approx"], COLOR.accent, COLOR.white],
      "circle-stroke-width": ["case", ["get", "approx"], 2.5, 2],
    },
  },
  {
    id: LAYER.selectedLabel,
    type: "symbol",
    source: SOURCE.selected,
    layout: {
      "text-field": ["to-string", ["get", "seq"]],
      "text-font": LABEL_FONT,
      "text-size": 11,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": ["case", ["get", "approx"], COLOR.accent, COLOR.white] },
  },
  {
    id: LAYER.highlightDot,
    type: "circle",
    source: SOURCE.highlight,
    // Empty until a "Cheapest along route" row is hovered (T-23 follow-up).
    // Only drawn for a candidate — a hovered stop already has its own pin,
    // so this would just double it.
    filter: ["==", ["get", "kind"], "candidate"],
    paint: {
      "circle-radius": 4.5,
      "circle-color": COLOR.amber,
      "circle-opacity": 0.9,
    },
  },
  {
    id: LAYER.highlightRing,
    type: "circle",
    source: SOURCE.highlight,
    // Drawn for either kind, on top of everything — the "you're pointing at
    // this one" ring, hollow so it never hides the pin/dot underneath.
    paint: {
      "circle-radius": 10,
      "circle-color": COLOR.white,
      "circle-opacity": 0,
      "circle-stroke-color": COLOR.highlight,
      "circle-stroke-width": 3,
    },
  },
];

/** Layers the pointer can hover for a card. */
export const HOVERABLE_LAYERS = [LAYER.selected, LAYER.candidate] as const;

/**
 * The fourth conversion edge (CLAUDE.md): the map renderer. Storage and the
 * API are miles (T-52); geodesic geometry is drawn in metres, so a city-tier
 * pin's `uncertaintyMiles` is converted here, at render, and nowhere else in
 * the frontend. The metres never leave this module.
 */
export function uncertaintyRadiusMeters(uncertaintyMiles: number): number {
  return milesToMeters(uncertaintyMiles);
}

/** WGS-84 mean radius, metres — the sphere the circle is drawn on. */
const EARTH_RADIUS_METERS = 6_371_008.8;

/**
 * A geodesic circle as a closed polygon ring. MapLibre's `circle` layer sizes
 * in screen pixels, which would draw a 5-mile town as the same dot at every
 * zoom; a polygon keeps the radius true to the ground.
 */
export function circlePolygon(center: [number, number], radiusMeters: number, steps = 64): Polygon {
  const [lng, lat] = center;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const δ = radiusMeters / EARTH_RADIUS_METERS;
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  ring.push(ring[0]!);
  return { type: "Polygon", coordinates: [ring] };
}

function collection(features: Feature<Geometry>[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

/**
 * A route's line, or no feature. A null polyline is a provider that returned
 * no geometry (§17) — the pins still draw. A malformed one is not drawn
 * short: decodePolyline throws rather than truncating, and the line is left off.
 */
export function routeLine(polyline: string | null): [number, number][] {
  if (!polyline) return [];
  try {
    return decodePolyline(polyline);
  } catch {
    return [];
  }
}

function lineCollection(coordinates: [number, number][]): FeatureCollection {
  return collection(
    coordinates.length >= 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }] : [],
  );
}

export type MapSources = Record<(typeof SOURCE)[keyof typeof SOURCE], FeatureCollection>;

export const EMPTY_SOURCES: MapSources = {
  [SOURCE.baseline]: collection([]),
  [SOURCE.optimized]: collection([]),
  [SOURCE.uncertainty]: collection([]),
  [SOURCE.candidate]: collection([]),
  [SOURCE.sheet]: collection([]),
  [SOURCE.endpoints]: collection([]),
  [SOURCE.selected]: collection([]),
  [SOURCE.highlight]: collection([]),
};

/**
 * The "all sheet stations" layer's source (T-23 step 23.2) — built from a
 * bbox-paged `GET /stations` fetch, not from the plan response, so it is a
 * separate helper rather than a `buildMapSources` field.
 */
export function sheetStationsCollection(stations: StationLocationSummary[]): FeatureCollection {
  return collection(
    stations.map((s) => ({
      type: "Feature",
      properties: { id: s.id },
      geometry: { type: "Point", coordinates: [s.location.lng, s.location.lat] },
    })),
  );
}

export interface HighlightedStation {
  id: string;
  kind: "stop" | "candidate";
  location: { lat: number; lng: number };
}

/**
 * The "hovering a Cheapest-along-route row" layer's source (T-23 follow-up)
 * — at most one feature, set from `RouteMap`'s own lookup into `plan.stops`/
 * `plan.candidateStations` by id, not from the plan response directly.
 */
export function highlightCollection(station: HighlightedStation | null): FeatureCollection {
  if (!station) return collection([]);
  return collection([
    {
      type: "Feature",
      properties: { id: station.id, kind: station.kind },
      geometry: { type: "Point", coordinates: [station.location.lng, station.location.lat] },
    },
  ]);
}

/**
 * Every source's data for one plan. Features carry only the key the hover
 * card looks the full record up by (`seq`, `id`) — the card reads
 * `plan.stops[]` itself, so the pins, the card and the Recommended-order list
 * stay three renderings of one array (UI contract §1).
 */
export function buildMapSources(plan: CompletedPlanResponse | null): MapSources {
  if (!plan) return EMPTY_SOURCES;
  const stops = [...plan.stops].sort((a, b) => a.seq - b.seq);
  const point = (lat: number, lng: number) => ({ type: "Point" as const, coordinates: [lng, lat] });

  return {
    [SOURCE.baseline]: lineCollection(routeLine(plan.baseline.polyline)),
    [SOURCE.optimized]: lineCollection(routeLine(plan.optimized.polyline)),
    [SOURCE.uncertainty]: collection(
      stops
        .filter((s) => s.station.resolution === "city" && s.station.uncertaintyMiles > 0)
        .map((s) => ({
          type: "Feature",
          properties: { seq: s.seq },
          geometry: circlePolygon(
            [s.station.location.lng, s.station.location.lat],
            uncertaintyRadiusMeters(s.station.uncertaintyMiles),
          ),
        })),
    ),
    [SOURCE.candidate]: collection(
      plan.candidateStations.map((c) => ({
        type: "Feature",
        properties: { id: c.id },
        geometry: point(c.location.lat, c.location.lng),
      })),
    ),
    // Left empty here: unlike every other source, the sheet layer isn't
    // derived from the plan response at all — RouteMap sets its data itself,
    // from a bbox-paged GET /stations fetch, only while its toggle is on.
    [SOURCE.sheet]: collection([]),
    // Also set by RouteMap itself, from whichever "Cheapest along route" row
    // is currently hovered — nothing to derive from the plan alone.
    [SOURCE.highlight]: collection([]),
    [SOURCE.endpoints]: collection([
      { type: "Feature", properties: { role: "origin" }, geometry: point(plan.origin.location.lat, plan.origin.location.lng) },
      {
        type: "Feature",
        properties: { role: "destination" },
        geometry: point(plan.destination.location.lat, plan.destination.location.lng),
      },
    ]),
    [SOURCE.selected]: collection(
      stops.map((s) => ({
        type: "Feature",
        properties: { seq: s.seq, approx: s.station.resolution === "city" },
        geometry: point(s.station.location.lat, s.station.location.lng),
      })),
    ),
  };
}

/** `[[west, south], [east, north]]`, as `fitBounds` takes it. */
export type LngLatBox = [[number, number], [number, number]];

/**
 * `planPersistence.boundsFromRow` coerces absent bounds to four zeros, so a
 * zero-area box is "no bounds", not a real point in the Gulf of Guinea.
 */
function isRealBounds(b: RouteBounds): boolean {
  return b.north > b.south && b.east > b.west;
}

/**
 * The box the camera fits: the optimised route's own `bounds` (§14), widened
 * to take in both endpoints and every stop so no pin sits off-screen. With no
 * usable bounds, the extent of whatever the plan has to draw.
 */
export function planBounds(plan: CompletedPlanResponse | null): LngLatBox | null {
  if (!plan) return null;
  const points: [number, number][] = [
    [plan.origin.location.lng, plan.origin.location.lat],
    [plan.destination.location.lng, plan.destination.location.lat],
    ...plan.stops.map((s): [number, number] => [s.station.location.lng, s.station.location.lat]),
  ];
  const b = plan.optimized.bounds;
  if (isRealBounds(b)) {
    points.push([b.west, b.south], [b.east, b.north]);
  } else {
    points.push(...routeLine(plan.optimized.polyline));
  }
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

