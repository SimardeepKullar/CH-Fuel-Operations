import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { TruckDetail, TruckRosterResult, TrucksResult } from "../../src/actuals/trucks.js";
import {
  insertAssignment,
  insertCard,
  insertDriver,
  insertInvoice,
  insertStation,
  insertStop,
  insertTruck,
  scopedSchema,
  teardown,
} from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const UNKNOWN_UUID = "3f2b7c1e-8a44-4f5b-9c1d-2e6a7b8c9d0e";

/**
 * A reassignment mid-period. Driver Ann drives truck T1 through 2026-03-10
 * (`effective_to`, inclusive) and truck T2 from 2026-03-11.
 *
 *   invoice P1  2026-03-01 .. 2026-03-10   Ann's stop on 03-10 — stored truck_id T1
 *   invoice P2  2026-03-11 .. 2026-03-17   Ann's stop on 03-11 — stored truck_id T2
 *
 * The stops carry the truck the importer resolved *then* (T-26/D19). The
 * endpoints read that column, never today's assignment — the reassignment row
 * is even rewritten after the fact below to prove it.
 */
describe.skipIf(!hasDatabase)("GET /trucks, /trucks/{id} (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;
  let ids: {
    t1: string;
    t2: string;
    ann: string;
    ben: string;
    cardAnn: string;
    cardBen: string;
    cardOrphan: string;
    stopOld: string;
    stopNew: string;
  };

  async function get<T>(pathAndQuery: string, status = 200): Promise<T> {
    const response = await app.handle(new Request(`http://localhost/api/v1${pathAndQuery}`));
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  }

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await scopedSchema("test_trucks"));
    app = createApp({ pool: scopedPool });

    const [t1, t2] = await Promise.all([insertTruck(scopedPool, "T37-T1"), insertTruck(scopedPool, "T37-T2")]);
    const [ann, ben] = await Promise.all([insertDriver(scopedPool, "T37 ANN"), insertDriver(scopedPool, "T37 BEN")]);
    // Ben's earlier, replaced card is inactive; his current one is active.
    await insertCard(scopedPool, { cardNumber: "T37-BEN-OLD", driverId: ben, status: "inactive" });
    const [cardAnn, cardBen, cardOrphan] = await Promise.all([
      insertCard(scopedPool, { cardNumber: "T37-ANN", driverId: ann }),
      insertCard(scopedPool, { cardNumber: "T37-BEN", driverId: ben }),
      insertCard(scopedPool, { cardNumber: "T37-ORPHAN", driverId: null }),
    ]);

    // Ann: T1 until 03-10, T2 from 03-11. Ben rode T1 before Ann did.
    await insertAssignment(scopedPool, { driverId: ben, truckId: t1, effectiveFrom: "2026-01-01", effectiveTo: "2026-02-28" });
    await insertAssignment(scopedPool, { driverId: ann, truckId: t1, effectiveFrom: "2026-03-01", effectiveTo: "2026-03-10" });
    await insertAssignment(scopedPool, { driverId: ann, truckId: t2, effectiveFrom: "2026-03-11", effectiveTo: null });

    const p1 = await insertInvoice(scopedPool, { number: "T37-P1", periodStart: "2026-03-01", periodEnd: "2026-03-10" });
    const p2 = await insertInvoice(scopedPool, { number: "T37-P2", periodStart: "2026-03-11", periodEnd: "2026-03-17" });
    const station = await insertStation(scopedPool, { siteRef: "T37-S", nameRaw: "LOVES #9" });

    const stopOld = await insertStop(scopedPool, {
      invoiceId: p1,
      cardId: cardAnn,
      driverId: ann,
      truckId: t1,
      stationId: station,
      occurredAt: "2026-03-10T15:00:00Z",
      receiptStatus: "confirmed",
      lines: [
        { code: "TA", gallons: 100, billed: 5 },
        { code: "DF", gallons: 4, billed: 4 },
      ],
    });
    const stopNew = await insertStop(scopedPool, {
      invoiceId: p2,
      cardId: cardAnn,
      driverId: ann,
      truckId: t2,
      stationId: station,
      occurredAt: "2026-03-11T15:00:00Z",
      lines: [{ code: "TA", gallons: 50, billed: 6 }],
    });
    // A stop on a card whose truck never resolved: no truck row, but still the invoice's.
    await insertStop(scopedPool, {
      invoiceId: p2,
      cardId: cardOrphan,
      occurredAt: "2026-03-12T15:00:00Z",
      lines: [{ code: "TA", gallons: 50, billed: 8 }],
    });

    ids = { t1, t2, ann, ben, cardAnn, cardBen, cardOrphan, stopOld, stopNew };
  });

  afterEach(async () => {
    await teardown(adminPool, scopedPool, schema);
  });

  describe("detail: assignment history", () => {
    it("returns every assignment of the truck, oldest to newest, each with its driver and card", async () => {
      const detail = await get<TruckDetail>(`/trucks/${ids.t1}?week=2026-03-10`);

      expect(detail.truck).toEqual({ id: ids.t1, unitNumber: "T37-T1" });
      expect(detail.assignments.map((a) => [a.driver.displayName, a.effectiveFrom, a.effectiveTo])).toEqual([
        ["T37 BEN", "2026-01-01", "2026-02-28"],
        ["T37 ANN", "2026-03-01", "2026-03-10"],
      ]);
      // Ben has two cards; the assignment shows his active one.
      expect(detail.assignments[0]!.card).toMatchObject({ id: ids.cardBen, cardNumber: "T37-BEN", status: "active" });
      expect(detail.assignments[1]!.card).toMatchObject({ id: ids.cardAnn, cardNumber: "T37-ANN" });
    });

    it("assigned card: in force on the effective_to day itself (inclusive), gone the day after", async () => {
      // P1 ends 03-10 — the last day of Ann's assignment to T1.
      const onLastDay = await get<TruckDetail>(`/trucks/${ids.t1}?week=2026-03-10`);
      expect(onLastDay.asOf).toBe("2026-03-10");
      expect(onLastDay.assignedCard).toMatchObject({ cardNumber: "T37-ANN" });
      expect(onLastDay.assignments.map((a) => a.inForce)).toEqual([false, true]);

      // P2 ends 03-17: Ann has left T1, so it has no card in force, but the history is unchanged.
      const dayAfter = await get<TruckDetail>(`/trucks/${ids.t1}?week=2026-03-17`);
      expect(dayAfter.asOf).toBe("2026-03-17");
      expect(dayAfter.assignedCard).toBeNull();
      expect(dayAfter.assignments).toHaveLength(2);
      expect(dayAfter.assignments.every((a) => !a.inForce)).toBe(true);
    });

    it("the new truck's assignment is in force from its effective_from day, and not before", async () => {
      const inP2 = await get<TruckDetail>(`/trucks/${ids.t2}?week=2026-03-17`);
      expect(inP2.assignedCard).toMatchObject({ cardNumber: "T37-ANN" });
      expect(inP2.assignments).toHaveLength(1);
      expect(inP2.assignments[0]).toMatchObject({ effectiveFrom: "2026-03-11", effectiveTo: null, inForce: true });

      // In P1 (ends 03-10) T2's assignment has not started.
      const inP1 = await get<TruckDetail>(`/trucks/${ids.t2}?week=2026-03-10`);
      expect(inP1.assignedCard).toBeNull();
      expect(inP1.assignments[0]!.inForce).toBe(false);
    });

    it("a truck with no assignments has an empty history and no assigned card — not an error", async () => {
      const lonely = await insertTruck(scopedPool, "T37-LONELY");

      const detail = await get<TruckDetail>(`/trucks/${lonely}?week=2026-03-10`);

      expect(detail.assignments).toEqual([]);
      expect(detail.assignedCard).toBeNull();
    });
  });

  describe("detail: stops resolve against the assignment in force then", () => {
    it("a stop dated before the reassignment still belongs to the OLD truck; the day after belongs to the new one", async () => {
      const oldTruck = await get<TruckDetail>(`/trucks/${ids.t1}?week=2026-03-10`);
      const newTruck = await get<TruckDetail>(`/trucks/${ids.t2}?week=2026-03-17`);

      // 03-10 is Ann's last day on T1 (effective_to, inclusive): T1's stop.
      expect(oldTruck.summary).toMatchObject({ stopCount: 1, total: 516, qty: 100, defQty: 4 });
      // 03-11 is her first day on T2: T2's stop.
      expect(newTruck.summary).toMatchObject({ stopCount: 1, total: 300, qty: 50 });
    });

    it("neither truck shows the other's stop in the other's period", async () => {
      const t1InP2 = await get<TruckDetail>(`/trucks/${ids.t1}?week=2026-03-17`);
      const t2InP1 = await get<TruckDetail>(`/trucks/${ids.t2}?week=2026-03-10`);

      expect(t1InP2.summary.stopCount).toBe(0);
      expect(t2InP1.summary.stopCount).toBe(0);
    });

    it("the stored truck_id is what is read — rewriting the assignment afterwards does not move a past stop", async () => {
      // Today's assignment now says Ann is on T2 for all of March; stopOld still carries T1.
      await scopedPool.query("DELETE FROM truck_assignments WHERE driver_id = $1", [ids.ann]);
      await insertAssignment(scopedPool, { driverId: ids.ann, truckId: ids.t2, effectiveFrom: "2026-03-01", effectiveTo: null });

      const t1 = await get<TruckDetail>(`/trucks/${ids.t1}?week=2026-03-10`);
      const t2 = await get<TruckDetail>(`/trucks/${ids.t2}?week=2026-03-10`);

      expect(t1.summary.stopCount).toBe(1);
      expect(t2.summary.stopCount).toBe(0);
    });

    it("carries the same rollup as a driver: weighted average against the fleet, DEF ratio, favoured stations", async () => {
      const detail = await get<TruckDetail>(`/trucks/${ids.t1}?week=2026-03-10`);

      expect(detail.summary.avgBilledPerUnit).toBeCloseTo(5, 10);
      expect(detail.summary.defRatio).toBeCloseTo(0.04, 10);
      expect(detail.summary.receiptCompliance).toEqual({ confirmed: 1, total: 1, pct: 100 });
      expect(detail.fleet.avgBilledPerUnit).toBeCloseTo(5, 10);
      expect(detail.avgVsFleetPerUnit).toBeCloseTo(0, 10);
      expect(detail.favouredStations.stations.map((s) => [s.station.nameRaw, s.stopCount])).toEqual([["LOVES #9", 1]]);
    });

    it("a truck with no stops in the period returns zeros — not a 404", async () => {
      const detail = await get<TruckDetail>(`/trucks/${ids.t1}?week=2026-03-17`);

      expect(detail.summary).toMatchObject({ stopCount: 0, total: 0, qty: 0, anomalyCount: 0 });
      expect(detail.summary.avgBilledPerUnit).toBeNull();
      expect(detail.summary.defRatio).toBeNull();
      expect(detail.avgVsFleetPerUnit).toBeNull();
    });

    it("a period with no invoice returns zeros for a real truck, and still the full assignment history", async () => {
      const detail = await get<TruckDetail>(`/trucks/${ids.t1}?week=2027-01-07`);

      expect(detail.invoiceId).toBeNull();
      expect(detail.asOf).toBe("2027-01-07");
      expect(detail.summary.stopCount).toBe(0);
      expect(detail.assignments).toHaveLength(2);
    });

    it("404s a well-formed id that names no truck, and a malformed one, as problem+json", async () => {
      for (const id of [UNKNOWN_UUID, "072"]) {
        const response = await app.handle(new Request(`http://localhost/api/v1/trucks/${id}?week=2026-03-10`));
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
      }
    });

    it("400s a missing period", async () => {
      await get(`/trucks/${ids.t1}`, 400);
    });
  });

  describe("list", () => {
    it("groups by the stored truck_id: one row per truck with its own stops, and the truckless stop held apart", async () => {
      const result = await get<TrucksResult>("/trucks?week=2026-03-17");
      const t2 = result.rows.find((r) => r.truck.id === ids.t2)!;
      const t1 = result.rows.find((r) => r.truck.id === ids.t1)!;

      expect(result.invoiceId).not.toBeNull();
      expect(t2).toMatchObject({ truck: { unitNumber: "T37-T2" }, stopCount: 1, total: 300, qty: 50 });
      expect(t1.stopCount).toBe(0);
      expect(t1.avgBilledPerUnit).toBeNull();
      expect(result.unresolved).toMatchObject({ stopCount: 1, total: 400, qty: 50 });
      // Nothing vanishes: trucks + the unresolved bucket are the whole invoice.
      expect(result.fleet.stopCount).toBe(2);
      expect(result.fleet.total).toBe(700);
      expect(result.fleet.avgBilledPerUnit).toBeCloseTo(700 / 100, 10);
    });

    it("lists rows spend-descending", async () => {
      const spend = (await get<TrucksResult>("/trucks?week=2026-03-17")).rows.map((r) => r.total);

      expect(spend).toEqual([...spend].sort((a, b) => b - a));
    });

    it("a period with no invoice is empty with zero totals", async () => {
      const result = await get<TrucksResult>("/trucks?week=2027-01-07");

      expect(result.rows).toEqual([]);
      expect(result.fleet).toMatchObject({ stopCount: 0, total: 0, avgBilledPerUnit: null });
    });

    it("400s a malformed period through the app", async () => {
      await get("/trucks?week=nope", 400);
    });
  });

  describe("list: roster (D23, no period)", () => {
    it("returns the plain roster, sorted by unit_number, with no invoice/spend data", async () => {
      const result = await get<TruckRosterResult>("/trucks");

      const t1Row = result.rows.find((r) => r.id === ids.t1);
      const t2Row = result.rows.find((r) => r.id === ids.t2);
      // T-56: the roster row also carries the truck's own mpg/tank spec
      // (Dev Tools' preview) — null here since insertTruck seeds none.
      expect(t1Row).toEqual({ id: ids.t1, unitNumber: "T37-T1", tankGallons: null, avgMpg: null, reserveFraction: null });
      expect(t2Row).toEqual({ id: ids.t2, unitNumber: "T37-T2", tankGallons: null, avgMpg: null, reserveFraction: null });

      const unitNumbers = result.rows.map((r) => r.unitNumber);
      expect(unitNumbers).toEqual([...unitNumbers].sort());

      // No invoice-scoped fields at all — not even a null placeholder for them.
      expect(result).not.toHaveProperty("period");
      expect(result).not.toHaveProperty("invoiceId");
      expect(result).not.toHaveProperty("fleet");
    });

    it("still touches the database — a truck added mid-test appears", async () => {
      const before = await get<TruckRosterResult>("/trucks");
      const added = await insertTruck(scopedPool, "T37-NEW");

      const after = await get<TruckRosterResult>("/trucks");

      expect(after.rows.length).toBe(before.rows.length + 1);
      expect(after.rows.find((r) => r.id === added)).toEqual({
        id: added,
        unitNumber: "T37-NEW",
        tankGallons: null,
        avgMpg: null,
        reserveFraction: null,
      });
    });
  });
});
