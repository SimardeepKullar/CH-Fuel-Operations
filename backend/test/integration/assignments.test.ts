import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  AssignmentRejected,
  editAssignmentDates,
  previewAssignmentChange,
  reassignTruck,
} from "../../src/catalog/assignments.js";
import { insertAssignment, insertDriver, insertTruck, scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const NIL = "00000000-0000-0000-0000-000000000000";

describe.skipIf(!hasDatabase)("assignment write paths (integration)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_assign"));
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function rowsFor(driverId: string) {
    const { rows } = await pool.query<{
      id: string;
      truck_id: string;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT id, truck_id, to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
              to_char(effective_to, 'YYYY-MM-DD') AS effective_to
         FROM truck_assignments WHERE driver_id = $1 ORDER BY effective_from`,
      [driverId],
    );
    return rows;
  }

  async function datesFor(driverId: string) {
    return (await rowsFor(driverId)).map((r) => [r.truck_id, r.effective_from, r.effective_to]);
  }

  async function rejection(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (err) {
      if (err instanceof AssignmentRejected) return err.reason;
      throw err;
    }
    throw new Error("expected the change to be rejected");
  }

  describe("reassignTruck", () => {
    it("closes the open row the day before `from` and opens the new one", async () => {
      const driverId = await insertDriver(pool, "D1");
      const t1 = await insertTruck(pool, "A1");
      const t4 = await insertTruck(pool, "A4");
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-09-03" });

      await reassignTruck(pool, { driverId, truckId: t4, from: "2026-09-05" });

      expect(await datesFor(driverId)).toEqual([
        [t1, "2026-09-03", "2026-09-04"],
        [t4, "2026-09-05", null],
      ]);
    });

    it("a driver with no open row just gets the new row", async () => {
      const driverId = await insertDriver(pool, "D2");
      const t2 = await insertTruck(pool, "A2");

      await reassignTruck(pool, { driverId, truckId: t2, from: "2026-09-03" });

      expect(await datesFor(driverId)).toEqual([[t2, "2026-09-03", null]]);
    });

    it("a driver whose last row is closed gets a new open row after it", async () => {
      const driverId = await insertDriver(pool, "D2b");
      const t1 = await insertTruck(pool, "A5");
      const t2 = await insertTruck(pool, "A6");
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-01-01", effectiveTo: "2026-02-28" });

      await reassignTruck(pool, { driverId, truckId: t2, from: "2026-04-01" });

      expect(await datesFor(driverId)).toEqual([
        [t1, "2026-01-01", "2026-02-28"],
        [t2, "2026-04-01", null],
      ]);
    });

    it("may be back-dated to any day after the open row's own start", async () => {
      const driverId = await insertDriver(pool, "D3");
      const t1 = await insertTruck(pool, "B1");
      const t4 = await insertTruck(pool, "B4");
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-01-01" });

      await reassignTruck(pool, { driverId, truckId: t4, from: "2026-01-02" });

      expect(await datesFor(driverId)).toEqual([
        [t1, "2026-01-01", "2026-01-01"],
        [t4, "2026-01-02", null],
      ]);
    });

    it("rejects an inactive truck", async () => {
      const driverId = await insertDriver(pool, "D4");
      const t1 = await insertTruck(pool, "C1");
      const dead = await insertTruck(pool, "C9");
      await pool.query("UPDATE trucks SET is_active = false WHERE id = $1", [dead]);
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-01-01" });

      expect(await rejection(reassignTruck(pool, { driverId, truckId: dead, from: "2026-02-01" }))).toBe(
        "truck_inactive",
      );
      expect(await datesFor(driverId)).toEqual([[t1, "2026-01-01", null]]);
    });

    it("rejects the driver's current truck — that is a date edit, not a reassignment", async () => {
      const driverId = await insertDriver(pool, "D5");
      const t1 = await insertTruck(pool, "D1X");
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-01-01" });

      expect(await rejection(reassignTruck(pool, { driverId, truckId: t1, from: "2026-02-01" }))).toBe("same_truck");
    });

    it("rejects a `from` on or before the open row's start, leaving the rows intact", async () => {
      const driverId = await insertDriver(pool, "D6");
      const t1 = await insertTruck(pool, "E1");
      const t4 = await insertTruck(pool, "E4");
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-03-01" });

      for (const from of ["2026-03-01", "2026-02-01"]) {
        expect(await rejection(reassignTruck(pool, { driverId, truckId: t4, from }))).toBe(
          "from_not_after_open_start",
        );
      }
      expect(await datesFor(driverId)).toEqual([[t1, "2026-03-01", null]]);
    });

    it("rejects an unknown driver or truck", async () => {
      const driverId = await insertDriver(pool, "D7");
      const t1 = await insertTruck(pool, "F1");
      expect(await rejection(reassignTruck(pool, { driverId: NIL, truckId: t1, from: "2026-01-01" }))).toBe(
        "driver_not_found",
      );
      expect(await rejection(reassignTruck(pool, { driverId, truckId: NIL, from: "2026-01-01" }))).toBe(
        "truck_not_found",
      );
    });

    it("rolls back the close when the insert fails — the old rows stay as they were", async () => {
      const driverId = await insertDriver(pool, "D8");
      const t1 = await insertTruck(pool, "G1");
      const t4 = await insertTruck(pool, "G4");
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-01-01" });

      // A pool whose clients fail the INSERT, after the close has run.
      const failing = {
        connect: async () => {
          const client = await pool.connect();
          const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
          (client as unknown as { query: unknown }).query = (text: unknown, ...rest: unknown[]) =>
            typeof text === "string" && text.includes("INSERT INTO truck_assignments")
              ? Promise.reject(new Error("boom"))
              : query(text, ...rest);
          return client;
        },
      } as unknown as Pool;

      await expect(reassignTruck(failing, { driverId, truckId: t4, from: "2026-06-01" })).rejects.toThrow("boom");

      expect(await datesFor(driverId)).toEqual([[t1, "2026-01-01", null]]);
    });
  });

  describe("editAssignmentDates", () => {
    async function twoRows() {
      const driverId = await insertDriver(pool, "E-D");
      const t1 = await insertTruck(pool, "H1");
      const t4 = await insertTruck(pool, "H4");
      const first = await insertAssignment(pool, {
        driverId,
        truckId: t1,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-02-28",
      });
      const second = await insertAssignment(pool, { driverId, truckId: t4, effectiveFrom: "2026-03-01" });
      return { driverId, t1, t4, first, second };
    }

    it("moves a start or an end, either way", async () => {
      const { driverId, t1, t4, first, second } = await twoRows();

      // Open a gap: end the first earlier, start the second later.
      await editAssignmentDates(pool, { assignmentId: first, effectiveFrom: "2026-01-01", effectiveTo: "2026-02-10" });
      await editAssignmentDates(pool, { assignmentId: second, effectiveFrom: "2026-03-15", effectiveTo: null });
      expect(await datesFor(driverId)).toEqual([
        [t1, "2026-01-01", "2026-02-10"],
        [t4, "2026-03-15", null],
      ]);

      // And back, earlier than before — the Example 2 back-date.
      await editAssignmentDates(pool, { assignmentId: second, effectiveFrom: "2026-02-11", effectiveTo: null });
      expect(await datesFor(driverId)).toEqual([
        [t1, "2026-01-01", "2026-02-10"],
        [t4, "2026-02-11", null],
      ]);
    });

    it("accepts a gap between assignments", async () => {
      const { driverId, t1, t4, first } = await twoRows();
      await editAssignmentDates(pool, { assignmentId: first, effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31" });
      expect(await datesFor(driverId)).toEqual([
        [t1, "2026-01-01", "2026-01-31"],
        [t4, "2026-03-01", null],
      ]);
    });

    it("rejects an overlap with the driver's other rows, leaving them intact", async () => {
      const { driverId, second } = await twoRows();
      const before = await datesFor(driverId);

      expect(
        await rejection(editAssignmentDates(pool, { assignmentId: second, effectiveFrom: "2026-02-01", effectiveTo: null })),
      ).toBe("overlap");
      expect(await datesFor(driverId)).toEqual(before);
    });

    it("rejects an end before the start, a second open row, and an unknown id", async () => {
      const { first, second } = await twoRows();
      expect(
        await rejection(editAssignmentDates(pool, { assignmentId: second, effectiveFrom: "2026-04-01", effectiveTo: "2026-03-01" })),
      ).toBe("invalid_dates");
      expect(
        await rejection(editAssignmentDates(pool, { assignmentId: first, effectiveFrom: "2026-01-01", effectiveTo: null })),
      ).toBe("second_open_assignment");
      expect(
        await rejection(editAssignmentDates(pool, { assignmentId: NIL, effectiveFrom: "2026-01-01", effectiveTo: null })),
      ).toBe("assignment_not_found");
    });
  });

  describe("previewAssignmentChange", () => {
    it("reports the row changes and writes nothing", async () => {
      const driverId = await insertDriver(pool, "P-D");
      const t1 = await insertTruck(pool, "J1");
      const t4 = await insertTruck(pool, "J4");
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-09-03" });
      const before = await rowsFor(driverId);

      const preview = await previewAssignmentChange(pool, {
        kind: "reassign",
        driverId,
        truckId: t4,
        from: "2026-09-05",
      });

      expect(preview.assignments.before.map((r) => [r.truckId, r.effectiveFrom, r.effectiveTo])).toEqual([
        [t1, "2026-09-03", null],
      ]);
      expect(preview.assignments.after.map((r) => [r.truckId, r.effectiveFrom, r.effectiveTo])).toEqual([
        [t1, "2026-09-03", "2026-09-04"],
        [t4, "2026-09-05", null],
      ]);
      expect(await rowsFor(driverId)).toEqual(before);
    });

    it("previews an edit of dates, and writes nothing", async () => {
      const driverId = await insertDriver(pool, "P-F");
      const t1 = await insertTruck(pool, "L1");
      const id = await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-09-04" });

      const preview = await previewAssignmentChange(pool, {
        kind: "editDates",
        assignmentId: id,
        effectiveFrom: "2026-09-03",
        effectiveTo: null,
      });

      expect(preview.assignments.after.map((r) => [r.effectiveFrom, r.effectiveTo])).toEqual([["2026-09-03", null]]);
      expect((await rowsFor(driverId))[0]!.effective_from).toBe("2026-09-04");
    });

    it("rejects a bad change as a real write would, and still writes nothing", async () => {
      const driverId = await insertDriver(pool, "P-E");
      const t1 = await insertTruck(pool, "K1");
      await insertAssignment(pool, { driverId, truckId: t1, effectiveFrom: "2026-09-03" });
      const before = await rowsFor(driverId);

      expect(
        await rejection(previewAssignmentChange(pool, { kind: "reassign", driverId, truckId: t1, from: "2026-09-05" })),
      ).toBe("same_truck");
      expect(await rowsFor(driverId)).toEqual(before);
    });
  });
});
