import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReresolveCli } from "../../src/cli/reresolve.js";
import { insertAssignment, insertInvoice, insertTruck } from "./support/actualsFixtures.js";
import { flagsOf, newScenario, truckOf } from "./support/truckScenario.js";
import { runMigrations } from "../../src/db/migrate.js";
import { getCardByNumber } from "../../src/catalog/cards.js";
import { reresolve } from "../../src/resolve/reresolve.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

interface Fixture {
  fuelStopId: string;
  originalTruckId: string;
  correctedTruckId: string;
  driverId: string;
}

async function seedFuelStop(pool: Pool): Promise<Fixture> {
  const card = await getCardByNumber(pool, "9000005"); // JORDAN -> truck 072
  const { rows: driverRows } = await pool.query<{ id: string }>(
    "SELECT driver_id AS id FROM fuel_cards WHERE id = $1",
    [card!.id],
  );
  const driverId = driverRows[0]!.id;
  const { rows: originalTruckRows } = await pool.query<{ id: string }>(
    "SELECT id FROM trucks WHERE unit_number = '072'",
  );
  const originalTruckId = originalTruckRows[0]!.id;

  const { rows: invoiceRows } = await pool.query<{ id: string }>(
    `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date, currency, qty_unit, grand_total, status, file_sha256)
     VALUES ('re-resolve-test', '2026-09-01', '2026-09-07', '2026-09-07', '2026-09-08', '2026-09-09', 'USD', 'gal', 100.00, 'imported', repeat('a', 64))
     RETURNING id`,
  );

  const { rows: fuelStopRows } = await pool.query<{ id: string }>(
    `INSERT INTO fuel_stops
       (invoice_id, base_auth_code, occurred_at, card_id, truck_id, driver_id, unit_raw, driver_name_raw, total)
     VALUES ($1, 'B900001-TA', '2026-09-03T05:35:00Z', $2, $3, $4, '072', 'JORDAN', 100.00)
     RETURNING id`,
    [invoiceRows[0]!.id, card!.id, originalTruckId, driverId],
  );

  // A late correction: the truck actually assigned to JORDAN for this
  // period turns out to be a different unit than originally recorded.
  const { rows: correctedTruckRows } = await pool.query<{ id: string }>(
    "INSERT INTO trucks (unit_number) VALUES ('9999') RETURNING id",
  );

  return {
    fuelStopId: fuelStopRows[0]!.id,
    originalTruckId,
    correctedTruckId: correctedTruckRows[0]!.id,
    driverId,
  };
}

describe.skipIf(!hasDatabase)("reresolve (integration, T-29)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_reresolve_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("does not change a stored stop when an assignment is edited — only the job does that", async () => {
    const fixture = await seedFuelStop(scopedPool);

    await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [
      fixture.correctedTruckId,
      fixture.driverId,
    ]);

    const { rows } = await scopedPool.query<{ truck_id: string }>(
      "SELECT truck_id FROM fuel_stops WHERE id = $1",
      [fixture.fuelStopId],
    );
    expect(rows[0]?.truck_id).toBe(fixture.originalTruckId);
  });

  it("re-resolves affected stops when run, and names the change in its diff", async () => {
    const fixture = await seedFuelStop(scopedPool);
    await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [
      fixture.correctedTruckId,
      fixture.driverId,
    ]);

    const report = await reresolve(scopedPool);

    expect(report.changes).toEqual([
      expect.objectContaining({
        subjectType: "fuel_stop",
        subjectId: fixture.fuelStopId,
        field: "truck_id",
        before: fixture.originalTruckId,
        after: fixture.correctedTruckId,
      }),
    ]);

    const { rows } = await scopedPool.query<{ truck_id: string }>(
      "SELECT truck_id FROM fuel_stops WHERE id = $1",
      [fixture.fuelStopId],
    );
    expect(rows[0]?.truck_id).toBe(fixture.correctedTruckId);
  });

  it("is a no-op on a second run with no intervening edit", async () => {
    const fixture = await seedFuelStop(scopedPool);
    await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [
      fixture.correctedTruckId,
      fixture.driverId,
    ]);

    await reresolve(scopedPool);
    const second = await reresolve(scopedPool);

    expect(second.changes).toEqual([]);
  });

  it("never touches unit_raw while re-resolving truck_id", async () => {
    const fixture = await seedFuelStop(scopedPool);
    await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [
      fixture.correctedTruckId,
      fixture.driverId,
    ]);

    await reresolve(scopedPool);

    const { rows } = await scopedPool.query<{ unit_raw: string }>(
      "SELECT unit_raw FROM fuel_stops WHERE id = $1",
      [fixture.fuelStopId],
    );
    expect(rows[0]?.unit_raw).toBe("072");
  });

  describe("flags rebuilt, dry run, per-invoice transaction (T-78)", () => {
    /** A driver whose stops were flagged against truck 1; the assignment is then
     * corrected to truck 4 *directly* (as a bad edit or a seed change would), so
     * the stored stops and their flags are stale until `reresolve` runs. */
    async function staleDriver() {
      const s = await newScenario(scopedPool, "STALE");
      const t1 = await insertTruck(scopedPool, "1");
      const t4 = await insertTruck(scopedPool, "4");
      await insertAssignment(scopedPool, { driverId: s.driverId, truckId: t1, effectiveFrom: "2026-09-03" });
      const stop = await s.addStop("2026-09-05", "4");
      await s.flag();
      await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [t4, s.driverId]);
      return { s, t1, t4, stop };
    }

    it("rebuilds the invoice's flags: a stale Unit mismatch goes once the truck is re-resolved", async () => {
      const { stop } = await staleDriver();
      expect(await flagsOf(scopedPool, stop)).toEqual(["unit_mismatch"]);

      const report = await reresolve(scopedPool);

      expect(await truckOf(scopedPool, stop)).toBe("4");
      expect(await flagsOf(scopedPool, stop)).toEqual([]);
      expect(report.flags.map((f) => [f.change, f.rule, f.stopId])).toContainEqual(["cleared", "unit_mismatch", stop]);
    });

    it("clears a flag that was stale before any assignment changed", async () => {
      const s = await newScenario(scopedPool, "ALREADYSTALE");
      const t4 = await insertTruck(scopedPool, "4");
      await insertAssignment(scopedPool, { driverId: s.driverId, truckId: t4, effectiveFrom: "2026-09-03" });
      const stop = await s.addStop("2026-09-05", "4");
      // A flag left behind by an earlier rule set — nothing says it is still true.
      await scopedPool.query(
        `INSERT INTO anomalies (subject_type, subject_id, rule, severity, detail)
         VALUES ('fuel_stop', $1, 'unit_mismatch', 'amber', '{"unitRaw":"050","truckUnitNumber":"4"}')`,
        [stop],
      );

      await reresolve(scopedPool);

      expect(await flagsOf(scopedPool, stop)).toEqual([]);
    });

    it("--dry-run writes nothing and reports the diff", async () => {
      const { stop } = await staleDriver();

      const report = await reresolve(scopedPool, { dryRun: true });

      expect(report.dryRun).toBe(true);
      expect(report.stopMoves.map((m) => m.stopId)).toEqual([stop]);
      expect(report.flags.map((f) => [f.change, f.rule])).toContainEqual(["cleared", "unit_mismatch"]);
      // Nothing written: the stop keeps truck 1 and its flag.
      expect(await truckOf(scopedPool, stop)).toBe("1");
      expect(await flagsOf(scopedPool, stop)).toEqual(["unit_mismatch"]);
    });

    it("a second real run is a no-op: no changes, the same flags", async () => {
      const { stop } = await staleDriver();
      await reresolve(scopedPool);
      const flags = await flagsOf(scopedPool, stop);

      const second = await reresolve(scopedPool);

      expect(second.changes).toEqual([]);
      expect(second.flags).toEqual([]);
      expect(await flagsOf(scopedPool, stop)).toEqual(flags);
    });

    it("scoped to one driver, touches only that driver", async () => {
      const { s, stop } = await staleDriver();
      const other = await newScenario(scopedPool, "BYSTANDER", { invoiceId: s.invoiceId });
      const t9 = await insertTruck(scopedPool, "9");
      const t8 = await insertTruck(scopedPool, "8");
      await insertAssignment(scopedPool, { driverId: other.driverId, truckId: t9, effectiveFrom: "2026-09-01" });
      const otherStop = await other.addStop("2026-09-05", "9");
      await other.flag();
      await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [t8, other.driverId]);

      await reresolve(scopedPool, { driverId: s.driverId });

      expect(await truckOf(scopedPool, stop)).toBe("4");
      expect(await truckOf(scopedPool, otherStop)).toBe("9");
    });

    it("is per-invoice transactional: a failure rolls back its invoice and keeps the ones before it", async () => {
      const first = await newScenario(scopedPool, "TX1");
      const secondInvoice = await insertInvoice(scopedPool, {
        number: "TX2-1",
        periodStart: "2026-09-10",
        periodEnd: "2026-09-16",
      });
      const second = await newScenario(scopedPool, "TX2", { invoiceId: secondInvoice });
      const a = await insertTruck(scopedPool, "A");
      const b = await insertTruck(scopedPool, "B");
      const aNew = await insertTruck(scopedPool, "A2");
      const bNew = await insertTruck(scopedPool, "B2");
      await insertAssignment(scopedPool, { driverId: first.driverId, truckId: a, effectiveFrom: "2026-09-01" });
      await insertAssignment(scopedPool, { driverId: second.driverId, truckId: b, effectiveFrom: "2026-09-01" });
      const stopA = await first.addStop("2026-09-05", "A");
      const stopB = await second.addStop("2026-09-12", "B");
      await first.flag();
      await second.flag();
      await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [aNew, first.driverId]);
      await scopedPool.query("UPDATE truck_assignments SET truck_id = $1 WHERE driver_id = $2", [bNew, second.driverId]);

      // Invoices run in id order; fail the second one's flag rebuild.
      let rebuilds = 0;
      const failing = {
        query: scopedPool.query.bind(scopedPool),
        connect: async () => {
          const client = await scopedPool.connect();
          const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
          (client as unknown as { query: unknown }).query = (text: unknown, ...rest: unknown[]) =>
            typeof text === "string" && text.includes("DELETE FROM anomalies") && ++rebuilds === 2
              ? Promise.reject(new Error("boom"))
              : query(text, ...rest);
          return client;
        },
      } as unknown as Pool;

      await expect(reresolve(failing)).rejects.toThrow("boom");

      const byInvoice = [
        { invoiceId: first.invoiceId, stop: stopA, before: "A", after: "A2" },
        { invoiceId: secondInvoice, stop: stopB, before: "B", after: "B2" },
      ].sort((x, y) => x.invoiceId.localeCompare(y.invoiceId));
      expect(await truckOf(scopedPool, byInvoice[0]!.stop)).toBe(byInvoice[0]!.after);
      expect(await truckOf(scopedPool, byInvoice[1]!.stop)).toBe(byInvoice[1]!.before);
    });

    it("the CLI's --dry-run prints the diff, returns 0 and writes nothing", async () => {
      const { stop } = await staleDriver();
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      const exitCode = await runReresolveCli(["--dry-run"], scopedPool);

      const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
      log.mockRestore();
      expect(exitCode).toBe(0);
      expect(printed).toContain("dry run");
      expect(printed).toContain("1 cleared");
      expect(await truckOf(scopedPool, stop)).toBe("1");
      expect(await flagsOf(scopedPool, stop)).toEqual(["unit_mismatch"]);
    });
  });
});
