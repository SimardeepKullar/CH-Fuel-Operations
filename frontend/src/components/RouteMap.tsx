import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MaplibreMap, MapLayerMouseEvent } from "maplibre-gl";
import type { CompletedPlanResponse, StationLocationSummary } from "@ch/core/domain/planResponse";
import {
  formatCurrency,
  formatDistanceMiles,
  formatGallons,
  formatPricePerGallon,
} from "../lib/format";
import {
  buildMapSources,
  EMPTY_SOURCES,
  type HighlightedStation,
  highlightCollection,
  LAYER,
  MAP_LAYERS,
  planBounds,
  sheetStationsCollection,
  SOURCE,
} from "../map/layers";
import { BASE_MAP_ATTRIBUTION, BASE_MAP_STYLE_URL, INITIAL_BOUNDS } from "../map/style";

interface RouteMapProps {
  /** `null` until a completed plan is loaded — the map still shows the base layer. */
  plan: CompletedPlanResponse | null;
  /** "Show in-corridor not selected" — `candidateStations[]`, already toggled by visibility. */
  showCandidates: boolean;
  /** "Show all sheet stations" (UI-DATA-CONTRACT §3.8) — a visibility flip only; PlanTab owns the fetch so its button label can show the real count. */
  showSheetStations?: boolean;
  /** The fetched "all sheet stations" layer's data, from PlanTab's `useSheetStations`. */
  sheetStations?: StationLocationSummary[];
  /**
   * A "Cheapest along route" row being hovered in PlanTab (T-23 follow-up) —
   * shows that one station's pin/dot and its usual hover card even if its
   * own layer's toggle is off, without waiting for a real mouse hover on the
   * map itself.
   */
  hoveredStationId?: string | null;
  /** Covers the map with an in-flight overlay while a solve is running (§8). */
  loading?: boolean;
}

/** Shared by the render-time lookup and the map.project() effect below. */
function findHighlightedStation(
  plan: CompletedPlanResponse | null,
  id: string | null | undefined,
): HighlightedStation | null {
  if (!id || !plan) return null;
  const stop = plan.stops.find((s) => s.station.id === id);
  if (stop) return { id: stop.station.id, kind: "stop", location: stop.station.location };
  const candidate = plan.candidateStations.find((c) => c.id === id);
  if (candidate) return { id: candidate.id, kind: "candidate", location: candidate.location };
  return null;
}

/**
 * Why the base map is not drawing. `unsupported` and `failed` replace the
 * canvas with an empty state; `tiles` keeps the map (the route, pins and
 * attribution are local GeoJSON and still draw) and adds a notice over it.
 */
type BaseMapProblem = "unsupported" | "failed" | "tiles" | null;

const PROBLEM_TEXT: Record<Exclude<BaseMapProblem, null>, string> = {
  unsupported: "This browser can’t draw the map (WebGL is unavailable).",
  failed: "The base map couldn’t load.",
  tiles: "Some base-map tiles didn’t load.",
};

/**
 * What the pointer is over, by key only — the card reads the record from
 * `plan` at render, so it can never show a stale copy of a stop. `planId`
 * drops a card left over from the previous plan.
 */
type Hover =
  | { kind: "stop"; planId: string; seq: number; x: number; y: number; flip: boolean }
  | { kind: "candidate"; planId: string; id: string; x: number; y: number; flip: boolean };

/** Per-gallon prices are 4 dp (house rule). */
const PRICE_DECIMALS = 4;

export default function RouteMap({
  plan,
  showCandidates,
  showSheetStations = false,
  sheetStations = [],
  hoveredStationId = null,
  loading = false,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  // Read by MapLibre event handlers, which are registered once on load.
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<BaseMapProblem>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [listHoverScreen, setListHoverScreen] = useState<{ x: number; y: number; flip: boolean } | null>(null);

  // Mount once. maplibre-gl is imported here, not at module scope: it needs
  // `window` and WebGL, and loading it lazily keeps it off the server render
  // and out of the first chunk.
  useEffect(() => {
    let cancelled = false;
    let map: MaplibreMap | null = null;

    void import("maplibre-gl")
      .then(({ default: maplibregl }) => {
        if (cancelled || !containerRef.current) return;
        let styleLoaded = false;
        try {
          map = new maplibregl.Map({
            container: containerRef.current,
            style: BASE_MAP_STYLE_URL,
            bounds: INITIAL_BOUNDS,
            // Attribution is rendered by this component, beside the API's own
            // (see below) — one strip, not two.
            attributionControl: false,
            // The default; stated because the panel is a flex child whose size
            // changes without a window resize — MapLibre's ResizeObserver on
            // the container is what keeps the canvas matched to it.
            trackResize: true,
          });
        } catch {
          setProblem("unsupported");
          return;
        }
        const m = map;
        mapRef.current = m;
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

        // `style.load`, not `load`: `load` waits for the first tiles, so a
        // tile outage would hold the route and pins back (or never draw them).
        // Our layers are local GeoJSON and need only the style.
        m.on("style.load", () => {
          if (styleLoaded) return;
          styleLoaded = true;
          for (const [id, data] of Object.entries(EMPTY_SOURCES)) m.addSource(id, { type: "geojson", data });
          for (const layer of MAP_LAYERS) m.addLayer(layer);

          const place = (e: MapLayerMouseEvent) => {
            const feature = e.features?.[0];
            const current = planRef.current;
            if (!feature || !current || feature.geometry.type !== "Point") return null;
            const [lng, lat] = feature.geometry.coordinates as [number, number];
            const { x, y } = m.project([lng, lat]);
            const canvas = m.getCanvas();
            canvas.style.cursor = "pointer";
            // Open the card away from the nearer edge.
            const flip = x > canvas.clientWidth / 2;
            return { planId: current.planId, x, y, flip, props: feature.properties ?? {} };
          };
          m.on("mousemove", LAYER.selected, (e) => {
            const p = place(e);
            if (p) setHover({ kind: "stop", planId: p.planId, seq: Number(p.props.seq), x: p.x, y: p.y, flip: p.flip });
          });
          m.on("mousemove", LAYER.candidate, (e) => {
            const p = place(e);
            if (p) setHover({ kind: "candidate", planId: p.planId, id: String(p.props.id), x: p.x, y: p.y, flip: p.flip });
          });
          for (const layerId of [LAYER.selected, LAYER.candidate]) {
            m.on("mouseleave", layerId, () => {
              m.getCanvas().style.cursor = "";
              setHover(null);
            });
          }
          // A card pinned to a point would drift off it as the map pans.
          m.on("movestart", () => setHover(null));

          setReady(true);
        });
        m.on("error", () => {
          // Before `style.load`, the style itself failed: there is no map to draw
          // on. After it, a base tile did — our own layers are local and unaffected.
          setProblem((p) => p ?? (styleLoaded ? "tiles" : "failed"));
        });
      })
      .catch(() => {
        if (!cancelled) setProblem("unsupported");
      });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // A new plan (or none): redraw every source and fit the camera to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const [id, data] of Object.entries(buildMapSources(plan))) {
      (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    }
    const bounds = planBounds(plan);
    if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 11 });
  }, [plan, ready]);

  // The candidate toggle is a visibility flip on data already drawn — never a refetch.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty(LAYER.candidate, "visibility", showCandidates ? "visible" : "none");
  }, [showCandidates, ready]);

  // Sheet-stations data is fetched by PlanTab (useSheetStations), not here —
  // just drawn whenever the prop changes. Also redrawn on a new `plan`: the
  // plan-effect above always resets every source via buildMapSources(), which
  // deliberately leaves SOURCE.sheet empty (comment in layers.ts) since this
  // effect is meant to own it — but that means a re-plan wipes it unless this
  // effect also fires afterward to put the same data back.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource(SOURCE.sheet) as GeoJSONSource | undefined)?.setData(sheetStationsCollection(sheetStations));
  }, [sheetStations, plan, ready]);

  // The sheet-stations toggle is a visibility flip, like the candidate toggle above.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty(LAYER.sheet, "visibility", showSheetStations ? "visible" : "none");
  }, [showSheetStations, ready]);

  // Hovering a "Cheapest along route" row (T-23 follow-up): draw that one
  // station regardless of any layer's own toggle, and project its screen
  // position for the same hover card the map's own mousemove handlers use.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const station = findHighlightedStation(plan, hoveredStationId);
    (map.getSource(SOURCE.highlight) as GeoJSONSource | undefined)?.setData(highlightCollection(station));
    if (!station) {
      setListHoverScreen(null);
      return;
    }
    const { x, y } = map.project([station.location.lng, station.location.lat]);
    const canvas = map.getCanvas();
    setListHoverScreen({ x, y, flip: x > canvas.clientWidth / 2 });
  }, [hoveredStationId, plan, ready]);

  const blocked = problem === "unsupported" || problem === "failed";
  // A real mouse hover on the map wins over a list-hovered row — the two can
  // never actually target different stations at once (the pointer can't be
  // over both the map and a price-bar row), but priority still has to be
  // explicit somewhere.
  const card = hover && plan && hover.planId === plan.planId ? hover : null;
  const listHoverStation = findHighlightedStation(plan, hoveredStationId);
  const listCardActive = !card && !!listHoverStation && !!listHoverScreen;

  const hoveredStop = card?.kind === "stop"
    ? plan!.stops.find((s) => s.seq === card.seq)
    : listCardActive && listHoverStation!.kind === "stop"
      ? plan!.stops.find((s) => s.station.id === listHoverStation!.id)
      : undefined;
  const hoveredCandidate = card?.kind === "candidate" && showCandidates
    ? plan!.candidateStations.find((c) => c.id === card.id)
    : listCardActive && listHoverStation!.kind === "candidate"
      ? plan!.candidateStations.find((c) => c.id === listHoverStation!.id)
      : undefined;
  const cardPos = card ?? (listCardActive ? listHoverScreen : null);
  const cardStyle = cardPos
    ? {
        left: cardPos.x,
        top: cardPos.y,
        transform: `translate(${cardPos.flip ? "calc(-100% - 16px)" : "16px"}, -50%)`,
      }
    : undefined;
  const hasCityTier = plan?.stops.some((s) => s.station.resolution === "city") ?? false;

  return (
    <div className="map-panel">
      <div ref={containerRef} className="map-canvas" data-testid="map-canvas" hidden={blocked} />

      {loading && (
        <div className="map-loading" data-testid="map-loading" role="status" aria-live="polite">
          <span className="map-loading-spinner" aria-hidden="true" />
          Solving the route…
        </div>
      )}

      {blocked && (
        <div className="map-empty" role="status">
          <div className="map-empty-title">Map unavailable</div>
          <p>{PROBLEM_TEXT[problem]}</p>
          {plan && <p>The plan’s stops and totals are still listed alongside.</p>}
        </div>
      )}
      {problem === "tiles" && (
        <div className="map-notice" role="status">
          {PROBLEM_TEXT.tiles}
        </div>
      )}

      {hoveredStop && (
        <div className="map-tip map-tip-stop" role="tooltip" style={cardStyle}>
          <div className="map-tip-title">
            {hoveredStop.seq}. {hoveredStop.station.name}
          </div>
          <div className="map-tip-place">
            {hoveredStop.station.city}, {hoveredStop.station.state}
            {hoveredStop.station.resolution === "city" &&
              ` · located to town, ±${formatDistanceMiles(hoveredStop.station.uncertaintyMiles)}`}
          </div>
          <dl className="map-tip-rows">
            <dt>Price</dt>
            <dd>{formatPricePerGallon(hoveredStop.unitPriceUsd, PRICE_DECIMALS)}/gal</dd>
            <dt>Buy</dt>
            <dd>{formatGallons(hoveredStop.purchaseGallons)}</dd>
            <dt>Arrive with</dt>
            <dd>{formatGallons(hoveredStop.arrivalGallons)}</dd>
            <dt>Detour</dt>
            <dd>{formatDistanceMiles(hoveredStop.detourMiles)}</dd>
            <dt>Cumulative</dt>
            <dd>{formatDistanceMiles(hoveredStop.cumulativeDistanceMiles)}</dd>
            <dt>Stop cost</dt>
            <dd>{formatCurrency(hoveredStop.stopCostUsd)}</dd>
          </dl>
        </div>
      )}

      {hoveredCandidate && (
        <div className="map-tip map-tip-candidate" role="tooltip" style={cardStyle}>
          <div className="map-tip-title">{hoveredCandidate.name}</div>
          <div className="map-tip-place">
            {hoveredCandidate.city}, {hoveredCandidate.state}
          </div>
          <dl className="map-tip-rows">
            <dt>Price</dt>
            <dd>{formatPricePerGallon(hoveredCandidate.unitPriceUsd, PRICE_DECIMALS)}/gal</dd>
            <dt>Along route</dt>
            <dd>{formatDistanceMiles(hoveredCandidate.distanceAlongRouteMiles)}</dd>
            <dt>Detour</dt>
            <dd>{formatDistanceMiles(hoveredCandidate.detourMiles)}</dd>
          </dl>
          <div className="map-tip-note">Not selected by the optimiser.</div>
        </div>
      )}

      {plan && (
        <div className="map-legend">
          <span>
            <i className="key-line" />
            planned route
          </span>
          <span>
            <i className="key-line key-line-direct" />
            direct route
          </span>
          <span>
            <i className="key-stop" />
            fuel stop
          </span>
          {showSheetStations && (
            <span>
              <i className="key-sheet" />
              priced station, this sheet
            </span>
          )}
          {showCandidates && (
            <span>
              <i className="key-candidate" />
              in corridor, not selected
            </span>
          )}
          {hasCityTier && (
            <span>
              <i className="key-uncertainty" />
              located to town only
            </span>
          )}
        </div>
      )}

      {/* ODbL: attribution is a licence condition, and it ships in the API response so it cannot be left off. */}
      <div className="map-attribution" data-testid="map-attribution">
        <span>{BASE_MAP_ATTRIBUTION}</span>
        {plan && <span>Routing {plan.attribution.routing}</span>}
        {plan && <span>Stations {plan.attribution.placeData}</span>}
      </div>
    </div>
  );
}
