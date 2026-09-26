import { describe, expect, it } from "vitest";
import type { TruckSpec } from "../routing/provider.js";
import { computeRouteRequestHash, computeViaHash } from "./routePersistence.js";

const TRUCK_SPEC: TruckSpec = { grossWeightKg: null, heightCm: null, widthCm: null, lengthCm: null, axleCount: null, hazmatClass: null };
const ORIGIN = { lat: 41.85, lng: -87.65 };
const DESTINATION = { lat: 32.78, lng: -96.8 };

describe("computeRouteRequestHash", () => {
  it("is stable for the same identity", () => {
    const identity = { provider: "ors", origin: ORIGIN, destination: DESTINATION, via: [], truckSpec: TRUCK_SPEC };
    expect(computeRouteRequestHash(identity)).toBe(computeRouteRequestHash({ ...identity }));
  });

  it("is 64 lowercase hex characters, matching the routes.request_hash char(64) column", () => {
    const hash = computeRouteRequestHash({ provider: "ors", origin: ORIGIN, destination: DESTINATION, via: [], truckSpec: TRUCK_SPEC });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when the via sequence differs, even with the same endpoints", () => {
    const base = { provider: "ors", origin: ORIGIN, destination: DESTINATION, truckSpec: TRUCK_SPEC };
    const noStops = computeRouteRequestHash({ ...base, via: [] });
    const oneStop = computeRouteRequestHash({ ...base, via: [{ lat: 37, lng: -92 }] });
    const differentOrder = computeRouteRequestHash({
      ...base,
      via: [
        { lat: 37, lng: -92 },
        { lat: 36, lng: -91 },
      ],
    });
    const reordered = computeRouteRequestHash({
      ...base,
      via: [
        { lat: 36, lng: -91 },
        { lat: 37, lng: -92 },
      ],
    });
    expect(noStops).not.toBe(oneStop);
    expect(differentOrder).not.toBe(reordered);
  });

  it("differs when the truck spec differs, so a route under one truck's restrictions never serves another's", () => {
    const base = { provider: "ors", origin: ORIGIN, destination: DESTINATION, via: [] };
    const light = computeRouteRequestHash({ ...base, truckSpec: TRUCK_SPEC });
    const heavy = computeRouteRequestHash({ ...base, truckSpec: { ...TRUCK_SPEC, grossWeightKg: 36287 } });
    expect(light).not.toBe(heavy);
  });

  it("differs across providers, since ors and here are different cache lines", () => {
    const base = { origin: ORIGIN, destination: DESTINATION, via: [], truckSpec: TRUCK_SPEC };
    expect(computeRouteRequestHash({ ...base, provider: "ors" })).not.toBe(computeRouteRequestHash({ ...base, provider: "here" }));
  });
});

describe("computeViaHash", () => {
  it("is null for a via-less (baseline) route", () => {
    expect(computeViaHash([])).toBeNull();
  });

  it("is 64 lowercase hex characters for a routed set of stops", () => {
    expect(computeViaHash([{ lat: 37, lng: -92 }])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is order-sensitive", () => {
    const a = computeViaHash([
      { lat: 37, lng: -92 },
      { lat: 36, lng: -91 },
    ]);
    const b = computeViaHash([
      { lat: 36, lng: -91 },
      { lat: 37, lng: -92 },
    ]);
    expect(a).not.toBe(b);
  });
});
