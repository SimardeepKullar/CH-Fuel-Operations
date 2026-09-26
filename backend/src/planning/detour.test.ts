import { describe, expect, it } from "vitest";
import type { LatLng } from "../domain/planResponse.js";
import {
  RoutingProviderError,
  type MatrixRequest,
  type MatrixResult,
  type RoutingProvider,
  type TruckSpec,
} from "../routing/provider.js";
import {
  BRACKET_MILES,
  MAX_MATRIX_SIDE,
  bracketFor,
  detourEstimateError,
  measureDetours,
  type DetourSubject,
} from "./detour.js";
import { estimateDetourMiles } from "./detourEstimate.js";

/**
 * A fake one-way highway, so the tests state the road and not magic numbers.
 *
 * A point on the highway is `{ lat: mile, lng: 0 }`. A station is
 * `{ lat: exitMile, lng: connectorMiles }`: it hangs off the exit at `exitMile` by a
 * connector `connectorMiles` long. Driving is one way, like a controlled-access
 * highway a truck cannot turn round on: you can reach a station by riding forward to its
 * exit and taking the connector, and leave it by the connector and then forward. Anything
 * that would mean going backwards is unreachable — the pair is `null`.
 */
const highway = (mile: number): LatLng => ({ lat: mile, lng: 0 });
const stationAt = (exitMile: number, connectorMiles: number): LatLng => ({ lat: exitMile, lng: connectorMiles });
const isStation = (p: LatLng): boolean => p.lng !== 0;

function driveMiles(from: LatLng, to: LatLng): number | null {
  if (to.lat < from.lat) return null;
  const along = to.lat - from.lat;
  if (isStation(to)) return along + to.lng;
  if (isStation(from)) return from.lng + along;
  return along;
}

const SECONDS_PER_MILE = 60;
const ROUTE_MILES = 200;
const ROUTE_SECONDS = ROUTE_MILES * SECONDS_PER_MILE;

const truckSpec: TruckSpec = {
  grossWeightKg: 36000,
  heightCm: 411,
  widthCm: 259,
  lengthCm: 2200,
  axleCount: 5,
  hazmatClass: null,
};

function fakeProvider(matrix?: (req: MatrixRequest) => MatrixResult) {
  const requests: MatrixRequest[] = [];
  const provider: Pick<RoutingProvider, "name" | "matrix"> = {
    name: "ors",
    async matrix(req) {
      requests.push(req);
      if (matrix) return matrix(req);
      const distanceMiles = req.origins.map((o) => req.destinations.map((d) => driveMiles(o, d)));
      return {
        distanceMiles,
        durationSeconds: distanceMiles.map((row) => row.map((m) => (m === null ? 0 : m * SECONDS_PER_MILE))),
      };
    },
  };
  return { provider, requests };
}

/** A station whose nearest point on the route is `offset`, joined to the highway at `exitMile`. */
function subject(id: string, offset: number, exitMile: number, connectorMiles: number, routeMiles = ROUTE_MILES): DetourSubject {
  const b = bracketFor(offset, routeMiles);
  return {
    id,
    location: stationAt(exitMile, connectorMiles),
    before: highway(b.beforeMiles),
    after: highway(b.afterMiles),
    arcMiles: b.arcMiles,
    perpOffsetMiles: connectorMiles,
  };
}

const measure = (
  subjects: DetourSubject[],
  provider: Pick<RoutingProvider, "name" | "matrix">,
  extra: { routeDistanceMiles?: number; routeDurationSeconds?: number; maxMatrixSide?: number } = {},
) =>
  measureDetours({
    provider,
    truckSpec,
    subjects,
    routeDistanceMiles: extra.routeDistanceMiles ?? ROUTE_MILES,
    routeDurationSeconds: extra.routeDurationSeconds ?? ROUTE_SECONDS,
    ...(extra.maxMatrixSide === undefined ? {} : { maxMatrixSide: extra.maxMatrixSide }),
  });

describe("bracketFor (§15.4.1, route ends decided 2026-09-21)", () => {
  it("brackets a station ten miles either side, so the arc is 20", () => {
    expect(bracketFor(100, 200)).toEqual({ beforeMiles: 90, afterMiles: 110, arcMiles: 20 });
    expect(BRACKET_MILES).toBe(10);
  });

  it("clamps `before` to the origin near the start, and the arc is what is left, not 20", () => {
    expect(bracketFor(3, 200)).toEqual({ beforeMiles: 0, afterMiles: 13, arcMiles: 13 });
    expect(bracketFor(0, 200)).toEqual({ beforeMiles: 0, afterMiles: 10, arcMiles: 10 });
  });

  it("clamps `after` to the destination near the end", () => {
    expect(bracketFor(195, 200)).toEqual({ beforeMiles: 185, afterMiles: 200, arcMiles: 15 });
    expect(bracketFor(200, 200)).toEqual({ beforeMiles: 190, afterMiles: 200, arcMiles: 10 });
  });

  it("clamps both ends on a route shorter than 20 miles", () => {
    expect(bracketFor(6, 15)).toEqual({ beforeMiles: 0, afterMiles: 15, arcMiles: 15 });
  });

  it("clamps an offset a rounding error past the ends rather than bracketing off the route", () => {
    expect(bracketFor(200.0000001, 200).afterMiles).toBe(200);
    expect(bracketFor(-0.0000001, 200).beforeMiles).toBe(0);
  });

  it("rejects a route with no length and a non-finite offset", () => {
    expect(() => bracketFor(5, 0)).toThrow(RangeError);
    expect(() => bracketFor(Number.NaN, 200)).toThrow(RangeError);
  });
});

describe("measureDetours", () => {
  it("measures a station 0.25 mi off the route as a small detour, not tens of miles (the naive model's failure)", async () => {
    const { provider } = fakeProvider();
    const { measurements, exclusions } = await measure([subject("a", 100, 100, 0.25)], provider);

    expect(exclusions).toEqual([]);
    expect(measurements).toHaveLength(1);
    // Out on the connector and back: 2 x 0.25. It is nowhere near tens of miles.
    expect(measurements[0]!.measuredDetourMiles).toBeCloseTo(0.5, 9);
    expect(measurements[0]!.measuredDetourMiles).toBeLessThan(2);
  });

  it("measures a station 0.1 mi off the route the same way", async () => {
    const { provider } = fakeProvider();
    const { measurements } = await measure([subject("a", 100, 100, 0.1)], provider);
    expect(measurements[0]!.measuredDetourMiles).toBeCloseTo(0.2, 9);
  });

  it("does not care which interchange serves the station, only how long its connector is", async () => {
    const { provider } = fakeProvider();
    const { measurements } = await measure(
      [subject("here", 100, 100, 0.25), subject("earlier", 100, 94, 0.25), subject("later", 100, 107, 0.25)],
      provider,
    );
    for (const m of measurements) expect(m.measuredDetourMiles).toBeCloseTo(0.5, 9);
  });

  it("keeps the estimate beside the measurement: both are on the record, and neither replaces the other", async () => {
    const { provider } = fakeProvider();
    const { measurements } = await measure([subject("on", 100, 100, 0.1), subject("off", 100, 100, 0.25)], provider);
    const [on, off] = measurements;

    // 0.1 mi is under the 200 m floor, so the estimate says "on the route" while the truck still drives 0.2 mi.
    expect(on!.estimatedDetourMiles).toBe(0);
    expect(on!.measuredDetourMiles).toBeCloseTo(0.2, 9);
    expect(off!.estimatedDetourMiles).toBe(estimateDetourMiles(0.25));
    expect(off!.measuredDetourMiles).toBeCloseTo(0.5, 9);
    expect(off!.rawDetourMiles).toBeCloseTo(0.5, 9);
  });

  it("shows a larger detour for a station on the far side of a divided highway than for one on the near side", async () => {
    const { provider } = fakeProvider();
    // The far side reaches its exit the same way but has to cross over: a 1.5 mi connector, not 0.25.
    const { measurements } = await measure([subject("near", 100, 100, 0.25), subject("far", 100, 100, 1.5)], provider);
    const byId = new Map(measurements.map((m) => [m.id, m]));

    expect(byId.get("far")!.measuredDetourMiles).toBeGreaterThan(byId.get("near")!.measuredDetourMiles);
    expect(byId.get("far")!.measuredDetourMiles).toBeCloseTo(3, 9);
  });

  it("subtracts the clamped arc at the route ends, so a station near either end measures as small as any other", async () => {
    const { provider } = fakeProvider();
    const { measurements } = await measure(
      [subject("origin", 3, 3, 0.25), subject("destination", 195, 195, 0.25)],
      provider,
    );
    // With a fixed 20-mile arc these would come out at -6.5 and -4.5.
    for (const m of measurements) {
      expect(m.rawDetourMiles).toBeCloseTo(0.5, 9);
    }
    expect(measurements.map((m) => m.arcMiles)).toEqual([13, 15]);

    const short = await measure([subject("short", 6, 6, 0.25, 15)], provider, { routeDistanceMiles: 15, routeDurationSeconds: 900 });
    expect(short.measurements[0]!.rawDetourMiles).toBeCloseTo(0.5, 9);
  });

  it("costs the detour in hours against the route's own average speed", async () => {
    const { provider } = fakeProvider();
    const { measurements } = await measure([subject("a", 100, 100, 0.25)], provider);
    // 0.5 mi at 1 min/mi is 30 s.
    expect(measurements[0]!.detourHours).toBeCloseTo(30 / 3600, 9);
  });

  describe("two N x N calls, never one 2N x 2N", () => {
    const five = () => [10, 30, 50, 70, 90].map((mile, i) => subject(`s${i}`, mile, mile, 0.25));

    it("makes exactly two calls for a candidate set, each N x N", async () => {
      const { provider, requests } = fakeProvider();
      const subjects = five();
      const result = await measure(subjects, provider);

      expect(result.matrixCalls).toBe(2);
      expect(requests).toHaveLength(2);
      for (const req of requests) {
        expect(req.origins).toHaveLength(subjects.length);
        expect(req.destinations).toHaveLength(subjects.length);
      }
    });

    it("points the calls in opposite directions: before -> station, then station -> after", async () => {
      const { provider, requests } = fakeProvider();
      const subjects = five();
      await measure(subjects, provider);

      expect(requests[0]!.origins).toEqual(subjects.map((s) => s.before));
      expect(requests[0]!.destinations).toEqual(subjects.map((s) => s.location));
      expect(requests[1]!.origins).toEqual(subjects.map((s) => s.location));
      expect(requests[1]!.destinations).toEqual(subjects.map((s) => s.after));
      expect(requests[0]!.truckSpec).toBe(truckSpec);
    });

    it("never asks for the before -> after leg: that is the route's own arc, already known", async () => {
      const { provider, requests } = fakeProvider();
      const subjects = five();
      await measure(subjects, provider);
      const stationKeys = new Set(subjects.map((s) => JSON.stringify(s.location)));

      for (const req of requests) {
        // Every call has a station on exactly one side, never a highway point on both.
        const sides = [req.origins, req.destinations].map((points) => points.every((p) => stationKeys.has(JSON.stringify(p))));
        expect(sides.filter(Boolean)).toHaveLength(1);
      }
    });

    it("keeps to two calls up to the side limit, and chunks into diagonal blocks past it", async () => {
      const subjects = Array.from({ length: 7 }, (_, i) => subject(`s${i}`, 10 + i * 20, 10 + i * 20, 0.25));

      const atLimit = fakeProvider();
      const whole = await measure(subjects, atLimit.provider, { maxMatrixSide: 7 });
      expect(whole.matrixCalls).toBe(2);

      const chunked = fakeProvider();
      const result = await measure(subjects, chunked.provider, { maxMatrixSide: 3 });
      // 7 subjects in blocks of 3, 3, 1: two calls per block.
      expect(result.matrixCalls).toBe(2 * Math.ceil(7 / 3));
      expect(chunked.requests.map((r) => r.origins.length)).toEqual([3, 3, 3, 3, 1, 1]);
      for (const req of chunked.requests) {
        expect(req.origins.length).toBeLessThanOrEqual(3);
        expect(req.destinations.length).toBe(req.origins.length);
      }
      // Chunking changes what is asked, never what is answered.
      expect(result.measurements).toEqual(whole.measurements);
    });

    it("defaults the side limit to MAX_MATRIX_SIDE", async () => {
      const subjects = Array.from({ length: MAX_MATRIX_SIDE + 1 }, (_, i) => subject(`s${i}`, 10 + i, 10 + i, 0.25));
      const { provider, requests } = fakeProvider();
      const result = await measure(subjects, provider);

      expect(result.matrixCalls).toBe(4);
      expect(Math.max(...requests.map((r) => r.origins.length))).toBe(MAX_MATRIX_SIDE);
    });

    it("makes no call for no candidates", async () => {
      const { provider, requests } = fakeProvider();
      const result = await measure([], provider);
      expect(requests).toHaveLength(0);
      expect(result).toEqual({ measurements: [], exclusions: [], matrixCalls: 0 });
    });
  });

  describe("an unreachable pair is not a zero-mile detour", () => {
    it("names a station with a null cell in exclusions and measures the rest", async () => {
      const { provider } = fakeProvider();
      // Exit at mile 85 is behind the `before` point at 90: a truck cannot reverse to it.
      const { measurements, exclusions } = await measure([subject("ok", 100, 100, 0.25), subject("behind", 100, 85, 0.25)], provider);

      expect(measurements.map((m) => m.id)).toEqual(["ok"]);
      expect(exclusions).toEqual([{ id: "behind", reason: "detour_unmeasurable", estimatedDetourMiles: estimateDetourMiles(0.25) }]);
    });

    it("treats a null on either leg as unmeasurable", async () => {
      const { provider } = fakeProvider();
      // Exit at 115 is past `after` at 110: reachable from before, but the way back to `after` is null.
      const { measurements, exclusions } = await measure([subject("past", 100, 115, 0.25)], provider);
      expect(measurements).toEqual([]);
      expect(exclusions.map((e) => e.reason)).toEqual(["detour_unmeasurable"]);
    });

    it("treats a duration the provider did not give as unmeasurable, not zero hours", async () => {
      const { provider } = fakeProvider((req) => ({
        distanceMiles: req.origins.map(() => req.destinations.map(() => 10.25)),
        durationSeconds: req.origins.map(() => req.destinations.map(() => Number.NaN)),
      }));
      const { measurements, exclusions } = await measure([subject("a", 100, 100, 0.25)], provider);
      expect(measurements).toEqual([]);
      expect(exclusions.map((e) => e.reason)).toEqual(["detour_unmeasurable"]);
    });
  });

  it("floors a negative detour at 0 for the optimiser and keeps the raw figure beside it", async () => {
    // The router found a path between the snapped points shorter than the stored polyline.
    const { provider } = fakeProvider((req) => ({
      distanceMiles: req.origins.map(() => req.destinations.map(() => 8)),
      durationSeconds: req.origins.map(() => req.destinations.map(() => 8 * SECONDS_PER_MILE)),
    }));
    const { measurements, exclusions } = await measure([subject("a", 100, 100, 0.25)], provider);

    expect(exclusions).toEqual([]);
    expect(measurements[0]!.rawDetourMiles).toBeCloseTo(8 + 8 - 20, 9);
    expect(measurements[0]!.measuredDetourMiles).toBe(0);
    expect(measurements[0]!.detourHours).toBe(0);
  });

  it("rejects a matrix whose shape is not the one asked for", async () => {
    const { provider } = fakeProvider(() => ({ distanceMiles: [[1]], durationSeconds: [[60]] }));
    const subjects = [subject("a", 100, 100, 0.25), subject("b", 120, 120, 0.25)];
    await expect(measure(subjects, provider)).rejects.toBeInstanceOf(RoutingProviderError);
  });

  it("rejects a route with no length and a side limit that is not a positive integer", async () => {
    const { provider } = fakeProvider();
    await expect(measure([subject("a", 100, 100, 0.25)], provider, { routeDistanceMiles: 0 })).rejects.toThrow(RangeError);
    await expect(measure([subject("a", 100, 100, 0.25)], provider, { maxMatrixSide: 0 })).rejects.toThrow(RangeError);
    await expect(measure([subject("a", 100, 100, 0.25)], provider, { maxMatrixSide: 2.5 })).rejects.toThrow(RangeError);
  });
});

describe("detourEstimateError", () => {
  const set = [
    { estimatedDetourMiles: 0.675, rawDetourMiles: 0.5 },
    { estimatedDetourMiles: 0, rawDetourMiles: 0.2 },
    { estimatedDetourMiles: 5.4, rawDetourMiles: 8.4 },
  ];

  it("reports the gap between estimate and measurement across a candidate set", () => {
    const error = detourEstimateError(set);

    expect(error.count).toBe(3);
    // estimate - measured: +0.175, -0.2, -3.0
    expect(error.meanAbsoluteErrorMiles).toBeCloseTo((0.175 + 0.2 + 3) / 3, 9);
    expect(error.meanSignedErrorMiles).toBeCloseTo((0.175 - 0.2 - 3) / 3, 9);
    expect(error.worstUnderestimateMiles).toBeCloseTo(3, 9);
    expect(error.worstOverestimateMiles).toBeCloseTo(0.175, 9);
  });

  it("uses the raw measurement, so a floored detour does not hide an overestimate", () => {
    const error = detourEstimateError([{ estimatedDetourMiles: 2, rawDetourMiles: -1 }]);
    expect(error.meanSignedErrorMiles).toBe(3);
    expect(error.worstOverestimateMiles).toBe(3);
  });

  it("reports no underestimate as 0, not as unknown", () => {
    const error = detourEstimateError([{ estimatedDetourMiles: 2, rawDetourMiles: 1 }]);
    expect(error.worstUnderestimateMiles).toBe(0);
  });

  it("reports nothing measured as null, never as a perfect estimate", () => {
    expect(detourEstimateError([])).toEqual({
      count: 0,
      meanAbsoluteErrorMiles: null,
      meanSignedErrorMiles: null,
      worstUnderestimateMiles: null,
      worstOverestimateMiles: null,
    });
  });
});
