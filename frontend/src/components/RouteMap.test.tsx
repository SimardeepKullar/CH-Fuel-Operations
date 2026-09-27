// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { StationLocationSummary } from "@ch/core/domain/planResponse";
import {
  failNextMapConstruction,
  type FakeMap,
  lastMap,
  mapInstances,
  resetFakeMaplibre,
} from "../map/testing/fakeMaplibre";
import { BASELINE_LINE, COMPLETED_PLAN, OPTIMIZED_LINE } from "../map/testing/planFixture";
import { LAYER, MAP_LAYERS, SOURCE } from "../map/layers";
import { BASE_MAP_STYLE_URL } from "../map/style";

vi.mock("maplibre-gl", async () => (await import("../map/testing/fakeMaplibre")).fakeMaplibreModule);

const { default: RouteMap } = await import("./RouteMap");

afterEach(() => {
  cleanup();
  resetFakeMaplibre();
});

const features = (map: FakeMap, sourceId: string) => (map.getSource(sourceId)!.data as FeatureCollection).features;

async function loadedMap(
  showCandidates = false,
  showSheetStations = false,
  sheetStations: StationLocationSummary[] = [],
) {
  const utils = render(
    <RouteMap
      plan={COMPLETED_PLAN}
      showCandidates={showCandidates}
      showSheetStations={showSheetStations}
      sheetStations={sheetStations}
    />,
  );
  const map = await mountedMap();
  act(() => map.fire("style.load"));
  return { map, ...utils };
}

async function mountedMap() {
  await waitFor(() => expect(mapInstances()).toHaveLength(1));
  return lastMap();
}

describe("RouteMap — base map (T-22 step 22.1)", () => {
  it("mounts one MapLibre map on the panel's own element, styled from OpenFreeMap", async () => {
    render(<RouteMap plan={null} showCandidates={false} />);
    const map = await mountedMap();

    expect(map.options.container).toBe(screen.getByTestId("map-canvas"));
    expect(map.options.style).toBe(BASE_MAP_STYLE_URL);
    expect(BASE_MAP_STYLE_URL).toBe("https://tiles.openfreemap.org/styles/positron");
  });

  it("tracks its container's size rather than only the window's", async () => {
    render(<RouteMap plan={null} showCandidates={false} />);
    const map = await mountedMap();
    // MapLibre's ResizeObserver on the container is on by default; this pins
    // it on. The actual resize is verified in a browser — jsdom has no layout.
    expect(map.options.trackResize).toBe(true);
  });

  it("a style failure before style.load replaces the canvas with a visible empty state", async () => {
    render(<RouteMap plan={null} showCandidates={false} />);
    const map = await mountedMap();

    act(() => map.fire("error", { error: new Error("style fetch failed") }));

    expect(screen.getByRole("status").textContent).toMatch(/Map unavailable/);
    expect(screen.getByRole("status").textContent).toMatch(/base map couldn.t load/i);
    expect(screen.getByTestId("map-canvas").hidden).toBe(true);
  });

  it("a tile failure after the map has loaded keeps the map and adds a notice", async () => {
    render(<RouteMap plan={null} showCandidates={false} />);
    const map = await mountedMap();

    act(() => map.fire("style.load"));
    act(() => map.fire("error", { error: new Error("tile 404"), sourceId: "openmaptiles" }));

    expect(screen.getByRole("status").textContent).toMatch(/tiles didn.t load/);
    expect(screen.queryByText("Map unavailable")).toBeNull();
    expect(screen.getByTestId("map-canvas").hidden).toBe(false);
  });

  it("a tile failure before the first full render keeps the map: load waits on tiles, style.load does not", async () => {
    // Found in a real browser: MapLibre fires `load` only once the first
    // tiles have arrived, so a failed tile lands after `style.load` but before
    // `load`. That is a tile problem, not a missing map.
    render(<RouteMap plan={COMPLETED_PLAN} showCandidates={false} />);
    const map = await mountedMap();

    act(() => map.fire("style.load"));
    act(() => map.fire("error", { error: new Error("tile aborted"), sourceId: "openmaptiles" }));

    expect(screen.getByRole("status").textContent).toMatch(/tiles didn.t load/);
    expect(screen.queryByText("Map unavailable")).toBeNull();
    expect(screen.getByTestId("map-canvas").hidden).toBe(false);
    // The plan still draws on the untiled map.
    expect(map.getSource(SOURCE.selected)).toBeDefined();
  });

  it("no WebGL: the constructor throwing shows the empty state instead of a blank panel", async () => {
    failNextMapConstruction();
    render(<RouteMap plan={null} showCandidates={false} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/WebGL is unavailable/));
    expect(mapInstances()).toHaveLength(0);
  });

  it("shows the base map's attribution before any plan is loaded", async () => {
    render(<RouteMap plan={null} showCandidates={false} />);
    await mountedMap();
    expect(screen.getByText(/OpenFreeMap/).textContent).toMatch(/OpenStreetMap/);
  });

  it("removes the map on unmount", async () => {
    const { unmount } = render(<RouteMap plan={null} showCandidates={false} />);
    const map = await mountedMap();
    unmount();
    expect(map.removed).toBe(true);
  });
});

describe("RouteMap — layers and interaction (T-22 step 22.2)", () => {
  it("adds every layer in MAP_LAYERS, on sources that exist", async () => {
    const { map } = await loadedMap();
    expect(map.layers.map((l) => l.id)).toEqual(MAP_LAYERS.map((l) => l.id));
    for (const layer of map.layers) expect(map.getSource(layer.source as string)).toBeDefined();
  });

  it("both routes render in their distinct styles, and the camera fits the optimised route", async () => {
    const { map } = await loadedMap();

    const coords = (id: string) => (features(map, id)[0]!.geometry as LineString).coordinates;
    expect(coords(SOURCE.optimized)).toEqual(OPTIMIZED_LINE);
    expect(coords(SOURCE.baseline)).toEqual(BASELINE_LINE);
    expect(map.getLayer(LAYER.baseline)!.paint).toHaveProperty("line-dasharray");
    expect(map.getLayer(LAYER.optimized)!.paint).not.toHaveProperty("line-dasharray");

    expect(map.fitBoundsCalls.at(-1)!.bounds).toEqual([
      [-121.4944, 35.3733],
      [-119.0187, 39.5296],
    ]);
  });

  it("numbered pins sit at stops[].station.location, in seq order", async () => {
    const { map } = await loadedMap();
    const pins = features(map, SOURCE.selected);
    expect(pins.map((f) => f.properties!.seq)).toEqual([1, 2]);
    expect(pins.map((f) => (f.geometry as Point).coordinates)).toEqual([
      [-119.7871, 36.7378],
      [-121.4944, 38.5816],
    ]);
    expect(map.getLayer(LAYER.selectedLabel)!.layout).toMatchObject({ "text-field": ["to-string", ["get", "seq"]] });
  });

  it("the hover card shows all six §3.2 rows, read from stops[]", async () => {
    const { map } = await loadedMap();

    act(() =>
      map.fire(
        "mousemove",
        { features: [{ geometry: { type: "Point", coordinates: [-121.4944, 38.5816] }, properties: { seq: 2 } }] },
        LAYER.selected,
      ),
    );

    const card = screen.getByRole("tooltip");
    expect(card.querySelector(".map-tip-title")!.textContent).toBe("2. Love's #412");
    expect(card.querySelector(".map-tip-place")!.textContent).toMatch(/^Sacramento, CA/);
    const rows = [...card.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
    expect(rows).toEqual([
      ["Price", "$4.0125/gal"],
      ["Buy", "88.4 gal"],
      ["Arrive with", "61.3 gal"],
      ["Detour", "2.6 mi"],
      ["Cumulative", "402.7 mi"],
      ["Stop cost", "$354.71"],
    ]);
    expect(map.canvasCursor).toBe("pointer");

    act(() => map.fire("mouseleave", undefined, LAYER.selected));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(map.canvasCursor).toBe("");
  });

  it("a city-tier pin draws its uncertainty circle; an exact pin does not", async () => {
    const { map } = await loadedMap();
    // Stop 2 (Sacramento) is city-tier; stop 1 (Fresno) is exact.
    expect(features(map, SOURCE.uncertainty).map((f) => f.properties!.seq)).toEqual([2]);
    expect(map.getLayer(LAYER.uncertaintyFill)!.source).toBe(SOURCE.uncertainty);
    expect(screen.getByText("located to town only")).toBeTruthy();
  });

  it("candidate dots toggle by visibility, without a refetch or a redraw", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const { map, rerender } = await loadedMap(false);
      const candidateData = map.getSource(SOURCE.candidate)!.data;
      expect(features(map, SOURCE.candidate)).toHaveLength(2);
      expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");

      rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={true} />);
      expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("visible");

      rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={false} />);
      expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");

      expect(map.getSource(SOURCE.candidate)!.data).toBe(candidateData);
      expect(mapInstances()).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("a visible candidate has its own hover card", async () => {
    const { map } = await loadedMap(true);
    act(() =>
      map.fire(
        "mousemove",
        { features: [{ geometry: { type: "Point", coordinates: [-120.0607, 36.9613] }, properties: { id: "st-madera" } }] },
        LAYER.candidate,
      ),
    );
    const card = screen.getByRole("tooltip");
    expect(card.textContent).toMatch(/Love's #501/);
    expect(card.textContent).toMatch(/\$3\.9544\/gal/);
    expect(card.textContent).toMatch(/131\.2 mi/);
    expect(card.textContent).toMatch(/Not selected by the optimiser/);
  });

  it("attribution from the API response is present in the DOM", async () => {
    await loadedMap();
    const strip = screen.getByTestId("map-attribution").textContent!;
    expect(strip).toContain(COMPLETED_PLAN.attribution.routing);
    expect(strip).toContain(COMPLETED_PLAN.attribution.placeData);
    expect(strip).toContain("OpenFreeMap");
  });

  it("clearing the plan empties every layer and drops a stale hover card", async () => {
    const { map, rerender } = await loadedMap();
    act(() =>
      map.fire(
        "mousemove",
        { features: [{ geometry: { type: "Point", coordinates: [-119.7871, 36.7378] }, properties: { seq: 1 } }] },
        LAYER.selected,
      ),
    );
    expect(screen.getByRole("tooltip")).toBeTruthy();

    rerender(<RouteMap plan={null} showCandidates={false} />);
    for (const id of Object.values(SOURCE)) expect(features(map, id)).toHaveLength(0);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("RouteMap — all sheet stations layer (T-23 step 23.2)", () => {
  // PlanTab owns the fetch (useSheetStations) so its button label can show the
  // real count before the layer is ever toggled on; RouteMap only draws
  // whatever it's handed and flips visibility — see PlanTab.test.tsx for the
  // fetch/paging behaviour itself.
  const SHEET_STATION: StationLocationSummary = {
    id: "st-sheet-1",
    name: "Love's #900",
    storeNumber: 900,
    city: "Modesto",
    state: "CA",
    location: { lat: 37.6391, lng: -120.9969 },
    resolution: "exact",
    uncertaintyMiles: 0,
    truckAccessible: "operator_verified",
  };

  it("draws the sheetStations prop on its own layer and toggles it independently of the candidate layer", async () => {
    const { map, rerender } = await loadedMap(false, false, [SHEET_STATION]);
    expect(map.getLayoutProperty(LAYER.sheet, "visibility")).toBe("none");
    expect(features(map, SOURCE.sheet)).toHaveLength(1);
    expect(features(map, SOURCE.sheet)[0]!.properties!.id).toBe("st-sheet-1");

    rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={false} showSheetStations={true} sheetStations={[SHEET_STATION]} />);
    expect(map.getLayoutProperty(LAYER.sheet, "visibility")).toBe("visible");
    // The candidate (in-corridor) layer is untouched by this toggle.
    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");
  });

  it("redraws the layer when the sheetStations prop changes, without touching other sources", async () => {
    const { map, rerender } = await loadedMap(false, true, []);
    expect(features(map, SOURCE.sheet)).toHaveLength(0);
    const candidateData = map.getSource(SOURCE.candidate)!.data;

    rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={false} showSheetStations={true} sheetStations={[SHEET_STATION]} />);
    expect(features(map, SOURCE.sheet)).toHaveLength(1);
    expect(map.getSource(SOURCE.candidate)!.data).toBe(candidateData);
  });

  it("survives a re-plan: sheet dots stay drawn when a new plan replaces the current one", async () => {
    // Regression: buildMapSources() always resets SOURCE.sheet to empty as
    // part of redrawing every source for a new plan (layers.ts leaves it
    // empty on purpose, since this layer is meant to be owned by its own
    // effect). useSheetStations fetches once and hands RouteMap a stable
    // array, so without `plan` in this effect's own deps, a second plan
    // would wipe the dots and nothing would ever redraw them.
    // Same array reference across both renders, like the real
    // useSheetStations hook hands RouteMap — a fresh `[SHEET_STATION]`
    // literal on the rerender would make React see the prop as "changed"
    // and mask the bug this test exists to catch.
    const sheetStationsArr = [SHEET_STATION];
    const { map, rerender } = await loadedMap(false, true, sheetStationsArr);
    expect(features(map, SOURCE.sheet)).toHaveLength(1);

    const secondPlan = { ...COMPLETED_PLAN, planId: "plan-map-2" };
    rerender(
      <RouteMap plan={secondPlan} showCandidates={false} showSheetStations={true} sheetStations={sheetStationsArr} />,
    );
    expect(features(map, SOURCE.sheet)).toHaveLength(1);
    expect(features(map, SOURCE.sheet)[0]!.properties!.id).toBe("st-sheet-1");
  });
});

describe("RouteMap — 'Cheapest along route' hover highlight (T-23 follow-up)", () => {
  it("hovering an unselected candidate's id draws it and its card, even with the candidate layer's own toggle off", async () => {
    const { map, rerender } = await loadedMap(false);
    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");
    expect(features(map, SOURCE.highlight)).toHaveLength(0);

    rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={false} hoveredStationId="st-madera" />);
    await waitFor(() => expect(features(map, SOURCE.highlight)).toHaveLength(1));
    expect(features(map, SOURCE.highlight)[0]!.properties).toEqual({ id: "st-madera", kind: "candidate" });
    // The toggle itself is untouched — this is a peek, not a flip.
    expect(map.getLayoutProperty(LAYER.candidate, "visibility")).toBe("none");

    const card = screen.getByRole("tooltip");
    expect(card.textContent).toMatch(/Love's #501/);
    expect(card.textContent).toMatch(/\$3\.9544\/gal/);
    expect(card.textContent).toMatch(/Not selected by the optimiser/);
  });

  it("hovering an already-chosen stop's id shows its usual card, without a duplicate dot (it already has a pin)", async () => {
    const { map, rerender } = await loadedMap(false);

    rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={false} hoveredStationId="st-fresno" />);
    await waitFor(() => expect(features(map, SOURCE.highlight)).toHaveLength(1));
    expect(features(map, SOURCE.highlight)[0]!.properties).toEqual({ id: "st-fresno", kind: "stop" });
    // The highlight dot layer is filtered to candidates only — see layers.test.ts.

    const card = screen.getByRole("tooltip");
    expect(card.textContent).toMatch(/Love's #368/);
    expect(card.textContent).toMatch(/Stop cost/);
  });

  it("clearing the hovered id clears the highlight and the card", async () => {
    const { map, rerender } = await loadedMap(false);
    rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={false} hoveredStationId="st-madera" />);
    await waitFor(() => expect(features(map, SOURCE.highlight)).toHaveLength(1));

    rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={false} hoveredStationId={null} />);
    await waitFor(() => expect(features(map, SOURCE.highlight)).toHaveLength(0));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a real mouse hover on the map wins over a stale hovered-row id", async () => {
    const { map, rerender } = await loadedMap(true);
    rerender(<RouteMap plan={COMPLETED_PLAN} showCandidates={true} hoveredStationId="st-madera" />);
    await waitFor(() => expect(features(map, SOURCE.highlight)).toHaveLength(1));

    act(() =>
      map.fire(
        "mousemove",
        { features: [{ geometry: { type: "Point", coordinates: [-119.7871, 36.7378] }, properties: { seq: 1 } }] },
        LAYER.selected,
      ),
    );
    // The real mouse hover (stop 1) shows, not the list-hovered candidate.
    expect(screen.getByRole("tooltip").textContent).toMatch(/Love's #368/);
  });
});

describe("RouteMap — solve-in-flight overlay (§8)", () => {
  it("shows only while loading, and doesn't block the base map underneath", async () => {
    const { rerender } = render(<RouteMap plan={null} showCandidates={false} />);
    await mountedMap();
    expect(screen.queryByTestId("map-loading")).toBeNull();

    rerender(<RouteMap plan={null} showCandidates={false} loading={true} />);
    expect(screen.getByTestId("map-loading").textContent).toMatch(/Solving the route/);
    expect(screen.getByTestId("map-canvas").hidden).toBe(false);

    rerender(<RouteMap plan={null} showCandidates={false} loading={false} />);
    expect(screen.queryByTestId("map-loading")).toBeNull();
  });
});
