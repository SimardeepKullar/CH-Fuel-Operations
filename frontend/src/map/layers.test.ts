import { describe, expect, it } from "vitest";
import type { LineString, Point, Polygon } from "geojson";
import type { CompletedPlanResponse } from "@ch/core/domain/planResponse";
import {
  buildMapSources,
  circlePolygon,
  EMPTY_SOURCES,
  highlightCollection,
  LAYER,
  MAP_LAYERS,
  planBounds,
  sheetStationsCollection,
  SOURCE,
  uncertaintyRadiusMeters,
} from "./layers";
import { decodePolyline } from "./polyline";
import { BASELINE_LINE, COMPLETED_PLAN, encodePolyline, OPTIMIZED_LINE } from "./testing/planFixture";

const layer = (id: string) => MAP_LAYERS.find((l) => l.id === id)!;

/** Haversine, metres — an independent check on circlePolygon's radius. */
function groundDistanceMeters([lng1, lat1]: number[], [lng2, lat2]: number[]): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(a));
}

describe("MAP_LAYERS — the five §9.3 layers", () => {
  it("names every §9.3 layer", () => {
    const ids = MAP_LAYERS.map((l) => l.id);
    for (const id of ["route-baseline", "route-optimized", "stations-selected", "stations-candidate", "endpoints"]) {
      expect(ids).toContain(id);
    }
  });

  it("baseline is muted and dashed; optimised is prominent and solid", () => {
    const baseline = layer(LAYER.baseline);
    const optimized = layer(LAYER.optimized);
    expect(baseline.type).toBe("line");
    expect(optimized.type).toBe("line");
    expect(baseline.paint).toHaveProperty("line-dasharray");
    expect(optimized.paint).not.toHaveProperty("line-dasharray");
    const width = (l: typeof baseline) => (l.paint as Record<string, number>)["line-width"]!;
    expect(width(optimized)).toBeGreaterThan(width(baseline));
    expect((optimized.paint as Record<string, string>)["line-color"]).not.toBe(
      (baseline.paint as Record<string, string>)["line-color"],
    );
  });

  it("draws the optimised route above the baseline, and numbers above their pins", () => {
    const order = MAP_LAYERS.map((l) => l.id);
    expect(order.indexOf(LAYER.optimized)).toBeGreaterThan(order.indexOf(LAYER.baseline));
    expect(order.indexOf(LAYER.selectedLabel)).toBeGreaterThan(order.indexOf(LAYER.selected));
    expect(order.indexOf(LAYER.selected)).toBeGreaterThan(order.indexOf(LAYER.uncertaintyFill));
  });

  it("numbers each selected pin with its seq", () => {
    expect(layer(LAYER.selectedLabel).layout).toMatchObject({ "text-field": ["to-string", ["get", "seq"]] });
  });

  it("candidates start hidden; the toggle reveals them", () => {
    expect(layer(LAYER.candidate).layout).toMatchObject({ visibility: "none" });
  });
});

describe("the two-layer map toggle (T-23 step 23.2, UI-DATA-CONTRACT §3.8)", () => {
  it("the sheet layer starts hidden too, and draws small solid dots", () => {
    const sheet = layer(LAYER.sheet);
    expect(sheet.layout).toMatchObject({ visibility: "none" });
    expect(sheet.type).toBe("circle");
    const paint = sheet.paint as Record<string, unknown>;
    expect(paint["circle-color"]).toBeTypeOf("string");
    expect(paint).not.toHaveProperty("circle-stroke-width");
  });

  it("the in-corridor layer draws the same size solid dot as the sheet layer, in a different colour", () => {
    const candidatePaint = layer(LAYER.candidate).paint as Record<string, unknown>;
    const sheetPaint = layer(LAYER.sheet).paint as Record<string, unknown>;
    expect(candidatePaint["circle-radius"]).toBe(sheetPaint["circle-radius"]);
    expect(candidatePaint).not.toHaveProperty("circle-stroke-width");
    expect(candidatePaint["circle-color"]).not.toBe(sheetPaint["circle-color"]);
  });

  it("draws the sheet layer under the in-corridor layer, so real candidates aren't buried", () => {
    const order = MAP_LAYERS.map((l) => l.id);
    expect(order.indexOf(LAYER.candidate)).toBeGreaterThan(order.indexOf(LAYER.sheet));
  });
});

describe("sheetStationsCollection", () => {
  it("plots every station it's given, keyed by id", () => {
    const fc = sheetStationsCollection([
      {
        id: "st-1",
        name: "Love's #1",
        storeNumber: 1,
        city: "Reno",
        state: "NV",
        location: { lat: 39.5, lng: -119.8 },
        resolution: "exact",
        uncertaintyMiles: 0,
        truckAccessible: "operator_verified",
      },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties!.id).toBe("st-1");
    expect((fc.features[0]!.geometry as Point).coordinates).toEqual([-119.8, 39.5]);
  });

  it("no stations: an empty collection", () => {
    expect(sheetStationsCollection([]).features).toHaveLength(0);
  });
});

describe("the 'Cheapest along route' hover highlight (T-23 follow-up)", () => {
  it("highlightCollection makes one feature carrying id and kind", () => {
    const fc = highlightCollection({ id: "st-1", kind: "candidate", location: { lat: 39.5, lng: -119.8 } });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties).toEqual({ id: "st-1", kind: "candidate" });
    expect((fc.features[0]!.geometry as Point).coordinates).toEqual([-119.8, 39.5]);
  });

  it("highlightCollection(null): an empty collection", () => {
    expect(highlightCollection(null).features).toHaveLength(0);
  });

  it("the highlight dot only draws for a candidate — a hovered stop already has its own pin", () => {
    const dot = layer(LAYER.highlightDot) as unknown as { filter?: unknown };
    expect(dot.filter).toEqual(["==", ["get", "kind"], "candidate"]);
  });

  it("the highlight ring has no filter — it draws for either kind — and is hollow so it never hides the pin/dot", () => {
    const ring = layer(LAYER.highlightRing) as unknown as { filter?: unknown; paint: Record<string, unknown> };
    expect(ring.filter).toBeUndefined();
    expect(ring.paint["circle-opacity"]).toBe(0);
    expect(ring.paint).toHaveProperty("circle-stroke-color");
  });

  it("draws the highlight above every other layer, so it's never buried under a real pin", () => {
    const order = MAP_LAYERS.map((l) => l.id);
    for (const id of order.slice(0, -2)) {
      expect(order.indexOf(LAYER.highlightRing)).toBeGreaterThan(order.indexOf(id));
    }
  });
});

describe("buildMapSources", () => {
  it("decodes both routes from their polylines", () => {
    const sources = buildMapSources(COMPLETED_PLAN);
    const line = (id: string) => (sources[id as keyof typeof sources].features[0]!.geometry as LineString).coordinates;
    expect(line(SOURCE.optimized)).toEqual(OPTIMIZED_LINE);
    expect(line(SOURCE.baseline)).toEqual(BASELINE_LINE);
  });

  it("places numbered pins at stops[].station.location, in seq order", () => {
    const features = buildMapSources(COMPLETED_PLAN)[SOURCE.selected].features;
    // The fixture lists seq 2 before seq 1.
    expect(features.map((f) => f.properties!.seq)).toEqual([1, 2]);
    expect((features[0]!.geometry as Point).coordinates).toEqual([-119.7871, 36.7378]);
    expect((features[1]!.geometry as Point).coordinates).toEqual([-121.4944, 38.5816]);
  });

  it("marks the city-tier pin as approximate, so it reads as a town even where its circle is smaller than the pin", () => {
    const features = buildMapSources(COMPLETED_PLAN)[SOURCE.selected].features;
    expect(features.map((f) => [f.properties!.seq, f.properties!.approx])).toEqual([
      [1, false],
      [2, true],
    ]);
    const paint = layer(LAYER.selected).paint as Record<string, unknown>;
    expect(paint["circle-color"]).toEqual(["case", ["get", "approx"], expect.any(String), expect.any(String)]);
  });

  it("draws an uncertainty circle for the city-tier stop only", () => {
    const features = buildMapSources(COMPLETED_PLAN)[SOURCE.uncertainty].features;
    expect(features.map((f) => f.properties!.seq)).toEqual([2]);

    // Radius on the ground is the stop's uncertaintyMiles, in metres.
    const ring = (features[0]!.geometry as Polygon).coordinates[0]!;
    const center = [-121.4944, 38.5816];
    for (const vertex of ring) {
      expect(groundDistanceMeters(center, vertex)).toBeCloseTo(3.2 * 1609.344, 0);
    }
  });

  it("an exact-tier stop draws no circle, even with a non-zero uncertainty", () => {
    const plan: CompletedPlanResponse = {
      ...COMPLETED_PLAN,
      stops: COMPLETED_PLAN.stops.map((s) => ({ ...s, station: { ...s.station, resolution: "exact", uncertaintyMiles: 0.1 } })),
    };
    expect(buildMapSources(plan)[SOURCE.uncertainty].features).toHaveLength(0);
  });

  it("puts every candidate on the candidate layer, keyed by id", () => {
    const features = buildMapSources(COMPLETED_PLAN)[SOURCE.candidate].features;
    expect(features.map((f) => f.properties!.id)).toEqual(["st-madera", "st-stockton"]);
    expect((features[0]!.geometry as Point).coordinates).toEqual([-120.0607, 36.9613]);
  });

  it("marks origin and destination distinctly", () => {
    const features = buildMapSources(COMPLETED_PLAN)[SOURCE.endpoints].features;
    expect(features.map((f) => [f.properties!.role, (f.geometry as Point).coordinates])).toEqual([
      ["origin", [-119.0187, 35.3733]],
      ["destination", [-119.8138, 39.5296]],
    ]);
  });

  it("a null polyline draws no line but keeps the pins", () => {
    const plan: CompletedPlanResponse = {
      ...COMPLETED_PLAN,
      optimized: { ...COMPLETED_PLAN.optimized, polyline: null },
    };
    const sources = buildMapSources(plan);
    expect(sources[SOURCE.optimized].features).toHaveLength(0);
    expect(sources[SOURCE.selected].features).toHaveLength(2);
  });

  it("a truncated polyline draws nothing rather than a route that stops short", () => {
    const encoded = encodePolyline(OPTIMIZED_LINE);
    const plan: CompletedPlanResponse = {
      ...COMPLETED_PLAN,
      optimized: { ...COMPLETED_PLAN.optimized, polyline: encoded.slice(0, -1) },
    };
    expect(buildMapSources(plan)[SOURCE.optimized].features).toHaveLength(0);
  });

  it("no plan: every source is empty", () => {
    expect(buildMapSources(null)).toBe(EMPTY_SOURCES);
    for (const fc of Object.values(EMPTY_SOURCES)) expect(fc.features).toHaveLength(0);
  });
});

describe("uncertaintyRadiusMeters — the renderer's one conversion", () => {
  it("converts miles to metres exactly", () => {
    expect(uncertaintyRadiusMeters(1)).toBe(1609.344);
    expect(uncertaintyRadiusMeters(3.2)).toBeCloseTo(5149.9008, 6);
  });
});

describe("circlePolygon", () => {
  it("returns a closed ring", () => {
    const ring = circlePolygon([-100, 40], 1000, 16).coordinates[0]!;
    expect(ring).toHaveLength(17);
    expect(ring.at(-1)).toEqual(ring[0]);
  });
});

describe("planBounds", () => {
  it("fits the optimised route's own bounds", () => {
    expect(planBounds(COMPLETED_PLAN)).toEqual([
      [-121.4944, 35.3733],
      [-119.0187, 39.5296],
    ]);
  });

  it("zeroed bounds (no route row) fall back to the drawn geometry, never to 0,0", () => {
    const plan: CompletedPlanResponse = {
      ...COMPLETED_PLAN,
      optimized: { ...COMPLETED_PLAN.optimized, bounds: { north: 0, south: 0, east: 0, west: 0 } },
    };
    const box = planBounds(plan)!;
    expect(box).toEqual([
      [-121.4944, 35.3733],
      [-119.0187, 39.5296],
    ]);
  });

  it("no plan: no bounds", () => {
    expect(planBounds(null)).toBeNull();
  });

  it("fixture sanity: the encoded polyline round-trips", () => {
    expect(decodePolyline(encodePolyline(OPTIMIZED_LINE))).toEqual(OPTIMIZED_LINE);
  });
});

