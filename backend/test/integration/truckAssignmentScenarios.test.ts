import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { editAssignmentDates, previewAssignmentChange, reassignTruck } from "../../src/catalog/assignments.js";
import { reresolve } from "../../src/resolve/reresolve.js";
import { insertAssignment, insertTruck, scopedSchema, teardown } from "./support/actualsFixtures.js";
import { flagsOf, newScenario, truckOf } from "./support/truckScenario.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * T-78's two worked examples, row by row. The unit entered at the pump is
 * compared with the truck the driver had *on the stop's date*; a borrow is a
 * Unit mismatch and stays one; no truck on that date is No truck on file.
 */
describe.skipIf(!hasDatabase)("truck assignment scenarios (T-78, Examples 1 and 2)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_scenarios"));
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function detailOf(stopId: string, rule: string): Promise<unknown> {
    const { rows } = await pool.query<{ detail: unknown }>(
      "SELECT detail FROM anomalies WHERE subject_type = 'fuel_stop' AND subject_id = $1 AND rule = $2",
      [stopId, rule],
    );
    return rows[0]?.detail;
  }

  describe("Example 1 — borrow, then reassignment, then decommission", () => {
    /** Driver 1 is assigned truck 1 from Sep 3 and fuels Sep 3, 4 and 5. */
    async function driver1() {
      const s = await newScenario(pool, "DRIVER-1");
      const t1 = await insertTruck(pool, "1");
      const t4 = await insertTruck(pool, "4");
      await insertAssignment(pool, { driverId: s.driverId, truckId: t1, effectiveFrom: "2026-09-03" });
      return { s, t1, t4 };
    }

    it("Sep 3: entered 1, assigned 1 — a match, no flag", async () => {
      const { s } = await driver1();
      const sep3 = await s.addStop("2026-09-03", "1");
      await s.flag();

      expect(await truckOf(pool, sep3)).toBe("1");
      expect(await flagsOf(pool, sep3)).toEqual([]);
    });

    it("Sep 4: entered 77 (truck 1 undriveable) — Unit mismatch 77 vs 1, recorded under the driver's own truck", async () => {
      const { s } = await driver1();
      const sep4 = await s.addStop("2026-09-04", "77");
      await s.flag();

      expect(await truckOf(pool, sep4)).toBe("1");
      expect(await flagsOf(pool, sep4)).toEqual(["unit_mismatch"]);
      expect(await detailOf(sep4, "unit_mismatch")).toEqual({ unitRaw: "77", truckUnitNumber: "1" });
    });

    it("Sep 5: entered 4, reassigned to 4 from Sep 5 — a match, no flag", async () => {
      const { s, t4 } = await driver1();
      await reassignTruck(pool, { driverId: s.driverId, truckId: t4, from: "2026-09-05" });
      const sep5 = await s.addStop("2026-09-05", "4");
      await s.flag();

      expect(await truckOf(pool, sep5)).toBe("4");
      expect(await flagsOf(pool, sep5)).toEqual([]);
    });

    it("after decommissioning truck 1 and a full reresolve, Sep 4 still shows 77 vs 1; a second run changes nothing", async () => {
      const { s, t1, t4 } = await driver1();
      const sep3 = await s.addStop("2026-09-03", "1");
      const sep4 = await s.addStop("2026-09-04", "77");
      await s.flag();
      await reassignTruck(pool, { driverId: s.driverId, truckId: t4, from: "2026-09-05" });
      const sep5 = await s.addStop("2026-09-05", "4");
      await s.flag();
      await pool.query("UPDATE trucks SET is_active = false WHERE id = $1", [t1]);

      const first = await reresolve(pool);
      const second = await reresolve(pool);

      expect(first.changes).toEqual([]);
      expect(second.changes).toEqual([]);
      expect(second.flags).toEqual([]);
      expect([await truckOf(pool, sep3), await truckOf(pool, sep4), await truckOf(pool, sep5)]).toEqual(["1", "1", "4"]);
      expect(await flagsOf(pool, sep3)).toEqual([]);
      expect(await flagsOf(pool, sep4)).toEqual(["unit_mismatch"]);
      expect(await detailOf(sep4, "unit_mismatch")).toEqual({ unitRaw: "77", truckUnitNumber: "1" });
      expect(await flagsOf(pool, sep5)).toEqual([]);
    });

    describe("the reassignment is recorded late, on Sep 10, after Sep 5-9 were imported against truck 1", () => {
      async function lateRecorded() {
        const { s, t1, t4 } = await driver1();
        const days = ["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"];
        const stops: string[] = [];
        for (const day of days) {
          stops.push(await s.addStop(day, "4")); // driver was already in truck 4
        }
        await s.flag();
        return { s, t1, t4, stops };
      }

      it("before saving, all five are Unit mismatches against truck 1", async () => {
        const { stops } = await lateRecorded();
        for (const stop of stops) {
          expect(await flagsOf(pool, stop)).toEqual(["unit_mismatch"]);
        }
      });

      it("from = Sep 5: Sep 5-9 move to truck 4 and their mismatches clear — the preview says so first", async () => {
        const { s, t1, t4, stops } = await lateRecorded();
        const change = { kind: "reassign" as const, driverId: s.driverId, truckId: t4, from: "2026-09-05" };

        const preview = await previewAssignmentChange(pool, change);
        expect(preview.stops.map((m) => [m.before, m.after])).toEqual(stops.map(() => [t1, t4]));
        expect(preview.flags.cleared).toHaveLength(5);
        expect(preview.flags.cleared.every((f) => f.rule === "unit_mismatch")).toBe(true);
        expect(preview.flags.appeared).toEqual([]);
        expect(await truckOf(pool, stops[0]!)).toBe("1"); // the preview wrote nothing

        await reassignTruck(pool, { driverId: s.driverId, truckId: t4, from: "2026-09-05" });
        for (const stop of stops) {
          expect(await truckOf(pool, stop)).toBe("4");
          expect(await flagsOf(pool, stop)).toEqual([]);
        }
      });

      it("from = Sep 10: Sep 5-9 stay on truck 1 and keep their flags — the preview moves nothing", async () => {
        const { s, t4, stops } = await lateRecorded();

        const preview = await previewAssignmentChange(pool, {
          kind: "reassign",
          driverId: s.driverId,
          truckId: t4,
          from: "2026-09-10",
        });
        expect(preview.stops).toEqual([]);
        expect(preview.flags).toEqual({ cleared: [], appeared: [], changed: [] });

        await reassignTruck(pool, { driverId: s.driverId, truckId: t4, from: "2026-09-10" });
        for (const stop of stops) {
          expect(await truckOf(pool, stop)).toBe("1");
          expect(await flagsOf(pool, stop)).toEqual(["unit_mismatch"]);
        }
      });
    });
  });

  describe("Example 2 — no assignment yet", () => {
    /** Driver 2 has no assignment and enters truck 2 on Sep 3. */
    async function driver2() {
      const s = await newScenario(pool, "DRIVER-2");
      const t2 = await insertTruck(pool, "2");
      const sep3 = await s.addStop("2026-09-03", "2");
      await s.flag();
      return { s, t2, sep3 };
    }

    it("Sep 3: No truck on file (no_assignment, unitRaw 2) — never also a Unit mismatch", async () => {
      const { sep3 } = await driver2();

      expect(await truckOf(pool, sep3)).toBeNull();
      expect(await flagsOf(pool, sep3)).toEqual(["no_truck_on_file:no_assignment"]);
      expect(await detailOf(sep3, "no_truck_on_file")).toEqual({ reason: "no_assignment", unitRaw: "2" });
    });

    it("dispatch forgot the assignment: add truck 2 from Sep 3 — Sep 3 resolves to 2, matches, the flag clears", async () => {
      const { s, t2, sep3 } = await driver2();

      await reassignTruck(pool, { driverId: s.driverId, truckId: t2, from: "2026-09-03" });

      expect(await truckOf(pool, sep3)).toBe("2");
      expect(await flagsOf(pool, sep3)).toEqual([]);
    });

    it("it was a borrow: nothing added — the flag stays, through a full reresolve too", async () => {
      const { sep3 } = await driver2();

      const report = await reresolve(pool);

      expect(report.changes).toEqual([]);
      expect(await flagsOf(pool, sep3)).toEqual(["no_truck_on_file:no_assignment"]);
    });

    it("truck 2 assigned from Sep 4: Sep 3 stays No truck on file, Sep 4 onward matches; back-dating to Sep 3 clears Sep 3", async () => {
      const { s, t2, sep3 } = await driver2();
      const sep4 = await s.addStop("2026-09-04", "2");
      await s.flag();
      expect(await flagsOf(pool, sep4)).toEqual(["no_truck_on_file:no_assignment"]);

      const { assignmentId } = await reassignTruck(pool, { driverId: s.driverId, truckId: t2, from: "2026-09-04" });

      expect(await truckOf(pool, sep3)).toBeNull();
      expect(await flagsOf(pool, sep3)).toEqual(["no_truck_on_file:no_assignment"]);
      expect(await truckOf(pool, sep4)).toBe("2");
      expect(await flagsOf(pool, sep4)).toEqual([]);

      await editAssignmentDates(pool, { assignmentId, effectiveFrom: "2026-09-03", effectiveTo: null });

      expect(await truckOf(pool, sep3)).toBe("2");
      expect(await flagsOf(pool, sep3)).toEqual([]);
      expect(await truckOf(pool, sep4)).toBe("2");
    });
  });

  describe("team drivers", () => {
    it("both drivers of a shared truck compare against it, and moving one leaves the other where they were", async () => {
      const a = await newScenario(pool, "TEAM-A");
      const b = await newScenario(pool, "TEAM-B", { invoiceId: a.invoiceId });
      const shared = await insertTruck(pool, "S72");
      const other = await insertTruck(pool, "S73");
      await insertAssignment(pool, { driverId: a.driverId, truckId: shared, effectiveFrom: "2026-01-01" });
      await insertAssignment(pool, { driverId: b.driverId, truckId: shared, effectiveFrom: "2026-01-01" });
      const aMatch = await a.addStop("2026-09-05", "S72");
      const bMismatch = await b.addStop("2026-09-05", "0");
      await a.flag();

      expect(await truckOf(pool, aMatch)).toBe("S72");
      expect(await truckOf(pool, bMismatch)).toBe("S72");
      expect(await flagsOf(pool, aMatch)).toEqual([]);
      expect(await flagsOf(pool, bMismatch)).toEqual(["unit_mismatch"]);

      await reassignTruck(pool, { driverId: b.driverId, truckId: other, from: "2026-09-05" });

      expect(await truckOf(pool, aMatch)).toBe("S72");
      expect(await truckOf(pool, bMismatch)).toBe("S73");
    });
  });
});
