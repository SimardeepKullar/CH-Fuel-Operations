import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { runMigrations } from "../../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../../migrations/synthetic");

/** A throwaway schema with every migration applied — and so the seeded 27-card
 * driver/truck roster (0004) already in it. Tests find their own rows by id.
 * Pass `migrationsDir` (synthetic, the default) or `realMigrationsDir` from
 * the calling test file when it needs the real roster (T-58). */
export async function scopedSchema(
  prefix: string,
  dir: string = migrationsDir,
): Promise<{ adminPool: Pool; scopedPool: Pool; schema: string }> {
  const schema = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const scopedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
  });
  await runMigrations(scopedPool, dir);
  return { adminPool, scopedPool, schema };
}

export async function teardown(adminPool: Pool, scopedPool: Pool, schema: string): Promise<void> {
  await scopedPool.end();
  await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await adminPool.end();
}

export async function insertInvoice(
  pool: Pool,
  invoice: { number: string; periodStart: string; periodEnd: string },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO invoices (invoice_number, period_start, period_end, invoice_date, due_date, currency, qty_unit, grand_total, status, file_sha256)
     VALUES ($1, $2::date, $3::date, $3::date, $3::date, 'USD', 'gal', 0, 'imported', $4)
     RETURNING id`,
    [invoice.number, invoice.periodStart, invoice.periodEnd, createHash("sha256").update(invoice.number).digest("hex")],
  );
  return rows[0]!.id;
}

export async function insertDriver(pool: Pool, displayName: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("INSERT INTO drivers (display_name) VALUES ($1) RETURNING id", [
    displayName,
  ]);
  return rows[0]!.id;
}

export async function insertCard(
  pool: Pool,
  card: { cardNumber: string; driverId?: string | null; status?: "active" | "inactive" },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO fuel_cards (card_number, driver_id, status) VALUES ($1, $2, $3) RETURNING id",
    [card.cardNumber, card.driverId ?? null, card.status ?? "active"],
  );
  return rows[0]!.id;
}

export async function insertTruck(pool: Pool, unitNumber: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("INSERT INTO trucks (unit_number) VALUES ($1) RETURNING id", [
    unitNumber,
  ]);
  return rows[0]!.id;
}

export async function insertAssignment(
  pool: Pool,
  assignment: { driverId: string; truckId: string; effectiveFrom: string; effectiveTo?: string | null },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to)
     VALUES ($1, $2, $3::date, $4::date) RETURNING id`,
    [assignment.driverId, assignment.truckId, assignment.effectiveFrom, assignment.effectiveTo ?? null],
  );
  return rows[0]!.id;
}

export async function insertStation(
  pool: Pool,
  station: { siteRef: string; nameRaw: string; cityRaw?: string; stateUsps?: string },
): Promise<string> {
  const city = station.cityRaw ?? "Testville";
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps)
     VALUES ('BVD', $1, $2, $3, upper($3), $4) RETURNING id`,
    [station.siteRef, station.nameRaw, city, station.stateUsps ?? "MO"],
  );
  return rows[0]!.id;
}

export interface FixtureLine {
  code: "TA" | "DF";
  gallons: number;
  billed: number;
}

export interface FixtureStop {
  invoiceId: string;
  cardId: string;
  occurredAt: string;
  lines: FixtureLine[];
  driverId?: string | null;
  truckId?: string | null;
  stationId?: string | null;
  receiptStatus?: "pending" | "confirmed" | "missing";
  /** Defaults to the sum of the lines' amounts. */
  totalUsd?: number;
}

let authCode = 0;

/** A stop and its lines as `importInvoice` would leave them: the resolved
 * driver/truck/station ids already stored, never re-derived by the endpoints. */
export async function insertStop(pool: Pool, stop: FixtureStop): Promise<string> {
  const amounts = stop.lines.map((l) => Math.round(l.gallons * l.billed * 100) / 100);
  const total = stop.totalUsd ?? amounts.reduce((a, b) => a + b, 0);
  authCode += 1;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO fuel_stops
       (invoice_id, base_auth_code, occurred_at, card_id, truck_id, driver_id, unit_raw, driver_name_raw,
        station_id, total, receipt_status)
     VALUES ($1, $2, $3::timestamptz, $4, $5, $6, '', '', $7, $8, $9)
     RETURNING id`,
    [
      stop.invoiceId,
      `AUTH${authCode}`,
      stop.occurredAt,
      stop.cardId,
      stop.truckId ?? null,
      stop.driverId ?? null,
      stop.stationId ?? null,
      total,
      stop.receiptStatus ?? "pending",
    ],
  );
  const stopId = rows[0]!.id;

  for (const [i, line] of stop.lines.entries()) {
    await pool.query(
      `INSERT INTO fuel_stop_lines (fuel_stop_id, product_code, qty, retail_per_unit, billed_per_unit, amount)
       VALUES ($1, $2, $3, $4, $4, $5)`,
      [stopId, line.code, line.gallons, line.billed, amounts[i]],
    );
  }
  return stopId;
}

export async function insertAnomaly(
  pool: Pool,
  anomaly: { fuelStopId: string; rule: string; severity: "amber" | "red"; dismissed?: boolean },
): Promise<void> {
  await pool.query(
    `INSERT INTO anomalies (subject_type, subject_id, rule, severity, dismissed_at)
     VALUES ('fuel_stop', $1, $2, $3, $4)`,
    [anomaly.fuelStopId, anomaly.rule, anomaly.severity, anomaly.dismissed ? new Date() : null],
  );
}

let priceImport = 0;

/** A published-price row as v1's price ingest leaves it: a `price_imports` row
 * and one `station_prices` row (product_type `highway_diesel`, what an
 * invoice's TA code maps to) valid on exactly `validOn`. */
export async function insertPublishedPrice(
  pool: Pool,
  price: { stationId: string; validOn: string; yourPrice: number },
): Promise<void> {
  priceImport += 1;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
     VALUES ('BVD', $1, $2, $3::date, 'completed') RETURNING id`,
    [`fixture-${priceImport}.csv`, createHash("sha256").update(`price-import-${priceImport}-${Date.now()}`).digest("hex"), price.validOn],
  );
  await pool.query(
    `INSERT INTO station_prices (station_id, import_id, raw_product, product_type, your_price, valid_on)
     VALUES ($1, $2, 'ULSD', 'highway_diesel', $3, $4::date)`,
    [price.stationId, rows[0]!.id, price.yourPrice, price.validOn],
  );
}
