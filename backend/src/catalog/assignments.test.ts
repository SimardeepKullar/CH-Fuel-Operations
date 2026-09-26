import { describe, expect, it } from "vitest";
import { resolveAssignmentFromRows, resolveTruckAtInstant, type TruckAssignmentForMatch } from "./assignments.js";

const OLD_TRUCK = "truck-old";
const NEW_TRUCK = "truck-new";
const DRIVER = "driver-1";

// Old assignment covers through 2026-02-28 inclusive; the new one starts
// 2026-03-01 — the only shape the schema's EXCLUDE constraint allows for a
// back-to-back reassignment (see assignments.ts's comment on resolveTruckAtInstant).
const REASSIGNMENT: readonly TruckAssignmentForMatch[] = [
  {
    driverId: DRIVER,
    truckId: OLD_TRUCK,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: new Date("2026-02-28"),
  },
  {
    driverId: DRIVER,
    truckId: NEW_TRUCK,
    effectiveFrom: new Date("2026-03-01"),
    effectiveTo: null,
  },
];

describe("resolveTruckAtInstant", () => {
  it("resolves to the old truck one second before the boundary", () => {
    const at = new Date("2026-02-28T23:59:59Z");
    expect(resolveTruckAtInstant(DRIVER, REASSIGNMENT, at)).toBe(OLD_TRUCK);
  });

  it("resolves to the new truck one second after the boundary", () => {
    const at = new Date("2026-03-01T00:00:01Z");
    expect(resolveTruckAtInstant(DRIVER, REASSIGNMENT, at)).toBe(NEW_TRUCK);
  });

  it("does not let a later reassignment change how an earlier stop resolves", () => {
    const at = new Date("2026-01-15T12:00:00Z");
    expect(resolveTruckAtInstant(DRIVER, REASSIGNMENT, at)).toBe(OLD_TRUCK);
  });

  it("resolves an open-ended assignment for any later instant", () => {
    const farFuture = new Date("2030-06-01T00:00:00Z");
    expect(resolveTruckAtInstant(DRIVER, REASSIGNMENT, farFuture)).toBe(NEW_TRUCK);
  });

  it("returns null for a gap with no assignment, not the nearest one", () => {
    const gapped: TruckAssignmentForMatch[] = [
      {
        driverId: DRIVER,
        truckId: OLD_TRUCK,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-01-31"),
      },
      {
        driverId: DRIVER,
        truckId: NEW_TRUCK,
        effectiveFrom: new Date("2026-03-01"),
        effectiveTo: null,
      },
    ];
    const inTheGap = new Date("2026-02-15T00:00:00Z");
    expect(resolveTruckAtInstant(DRIVER, gapped, inTheGap)).toBeNull();
  });

  it("returns null for a null driver id rather than erroring", () => {
    expect(resolveTruckAtInstant(null, REASSIGNMENT, new Date())).toBeNull();
  });

  it("still resolves a truck id that has no profile metadata attached — the id is the key", () => {
    // truckId here is opaque to this function; it never looks at truck_profiles.
    const at = new Date("2026-01-15T00:00:00Z");
    expect(resolveTruckAtInstant(DRIVER, REASSIGNMENT, at)).toBe(OLD_TRUCK);
  });
});

describe("resolveAssignmentFromRows", () => {
  it("resolves both driver and truck for a card with a driver", () => {
    const at = new Date("2026-01-15T00:00:00Z");
    expect(resolveAssignmentFromRows({ driverId: DRIVER }, REASSIGNMENT, at)).toEqual({
      driverId: DRIVER,
      truckId: OLD_TRUCK,
    });
  });

  it("resolves a null driver and null truck for a card with no driver_id, not an error", () => {
    const at = new Date("2026-01-15T00:00:00Z");
    expect(resolveAssignmentFromRows({ driverId: null }, REASSIGNMENT, at)).toEqual({
      driverId: null,
      truckId: null,
    });
  });

  it("resolves a null driver and null truck for an unknown card, not an error", () => {
    const at = new Date("2026-01-15T00:00:00Z");
    expect(resolveAssignmentFromRows(undefined, REASSIGNMENT, at)).toEqual({
      driverId: null,
      truckId: null,
    });
  });
});
