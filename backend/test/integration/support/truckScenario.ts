import type { Pool } from "pg";
import { runAnomalies } from "../../../src/anomaly/runAnomalies.js";
import { resolveTruckForStop } from "../../../src/resolve/resolveTruck.js";
import { insertCard, insertDriver, insertInvoice, insertStop, insertTruck } from "./actualsFixtures.js";

/** A driver with a card, and the stops they fuel — each resolved the way
 * `importInvoice` resolves one (card → driver → the assignment in force on its
 * date), with the flags the engine writes for it. */
export interface Scenario {
  invoiceId: string;
  driverId: string;
  cardId: string;
  /** A stop on `date` (`YYYY-MM-DD`, noon UTC) with `unitRaw` entered, as an import would store it. */
  addStop(date: string, unitRaw: string, invoiceId?: string): Promise<string>;
  /** Re-runs the engine for the invoice, as an import does after writing its stops. */
  flag(invoiceId?: string): Promise<void>;
}

/** Pass `invoiceId` to put a second driver on an existing invoice — one invoice
 * per billing week and currency. */
export async function newScenario(pool: Pool, name: string, opts: { invoiceId?: string } = {}): Promise<Scenario> {
  const invoiceId =
    opts.invoiceId ??
    (await insertInvoice(pool, { number: `${name}-1`, periodStart: "2026-09-01", periodEnd: "2026-09-09" }));
  const driverId = await insertDriver(pool, name);
  const cardId = await insertCard(pool, { cardNumber: `CARD-${name}`, driverId });

  return {
    invoiceId,
    driverId,
    cardId,
    async addStop(date, unitRaw, forInvoice = invoiceId) {
      const occurredAt = `${date}T12:00:00Z`;
      const resolution = await resolveTruckForStop(pool, cardId, new Date(occurredAt), unitRaw);
      return insertStop(pool, {
        invoiceId: forInvoice,
        cardId,
        occurredAt,
        driverId: resolution.driverId,
        truckId: resolution.truckId,
        unitRaw,
        lines: [{ code: "TA", gallons: 100, billed: 3.5 }],
      });
    },
    async flag(forInvoice = invoiceId) {
      await runAnomalies(pool, forInvoice);
    },
  };
}

export { insertTruck };

/** The truck unit a stop is stored under, or `null`. */
export async function truckOf(pool: Pool, stopId: string): Promise<string | null> {
  const { rows } = await pool.query<{ unit_number: string | null }>(
    `SELECT t.unit_number FROM fuel_stops fs LEFT JOIN trucks t ON t.id = fs.truck_id WHERE fs.id = $1`,
    [stopId],
  );
  return rows[0]?.unit_number ?? null;
}

/** The flags a stop carries, as `rule` or `rule:reason` for No truck on file, sorted. */
export async function flagsOf(pool: Pool, stopId: string): Promise<string[]> {
  const { rows } = await pool.query<{ rule: string; detail: { reason?: string } }>(
    `SELECT rule, detail FROM anomalies
      WHERE subject_type = 'fuel_stop' AND subject_id = $1
        AND rule IN ('unit_mismatch', 'no_truck_on_file', 'not_on_roster')
      ORDER BY rule`,
    [stopId],
  );
  return rows.map((r) => (r.rule === "no_truck_on_file" ? `${r.rule}:${r.detail.reason}` : r.rule));
}
