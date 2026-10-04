import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { InvoiceCurrency } from "../db/types.js";
import { runAnomalies } from "../anomaly/runAnomalies.js";
import { getCardByNumber } from "../catalog/cards.js";
import { getTruckByUnitNumber } from "../catalog/trucks.js";
import { qtyUnitFor } from "../actuals/units.js";
import { resolveExpressDriver, type ExpressDriverResolution } from "../resolve/resolveDriver.js";
import { resolveStation } from "../resolve/resolveStation.js";
import { resolveTruckForStop } from "../resolve/resolveTruck.js";
import { groupByAuthCode, type FuelStopGroup } from "./groupByAuthCode.js";
import { parseInvoiceCsv, type ParsedInvoice } from "./parseInvoiceCsv.js";
import type { ExpressRow } from "./parseExpressRows.js";
import { DEFAULT_INVOICE_PRODUCT_CODES, type InvoiceProductType } from "./productCode.js";
import { reconcile } from "./reconcile.js";
import { buildImportReport, type ImportReport } from "./report.js";

/** Raw BVD product codes that reconcile against a printed row of the same
 * name. "C" (cash) is the one exception — see reconcile.ts's
 * `PRINTED_ROW_LABEL`; a cash line still belongs in `invoice_totals` under
 * its own code, not the printed label it reconciled against. */
const KNOWN_PRODUCT_CODES = new Set(DEFAULT_INVOICE_PRODUCT_CODES.keys());

export interface ImportInvoiceMeta {
  sourceFilename: string;
}

export interface ImportInvoiceOptions {
  productCodes?: ReadonlyMap<string, InvoiceProductType>;
  /**
   * Defaults to `parseInvoiceCsv`. Callers holding the emailed PDF inject
   * `parseInvoicePdf`, which is the fuller export — it alone carries the
   * invoice's own header dates and the express tractor/driver columns.
   *
   * `sourceFilename` is passed through because the CSV export contains no
   * invoice number anywhere in its contents; `parseInvoicePdf` reads one from
   * the document and ignores the argument.
   */
  parse?: (
    buffer: Buffer,
    productCodes: ReadonlyMap<string, InvoiceProductType>,
    sourceFilename: string,
  ) => ParsedInvoice | Promise<ParsedInvoice>;
}

export type ImportInvoiceResult =
  | { status: "imported"; invoiceId: string; report: ImportReport }
  | { status: "quarantined"; invoiceId: string; report: ImportReport }
  | { status: "duplicate"; invoiceId: string; report: ImportReport }
  | {
      status: "conflict";
      /** `invoice_number`: same number, different file. `billing_week`: another
       * imported invoice of this currency already holds the week (D26). */
      reason: "invoice_number" | "billing_week";
      existingInvoiceId: string;
      message: string;
    };

interface ExistingInvoiceRow {
  id: string;
  file_sha256: string;
}

/** Invoice timestamps carry no timezone offset (parseInvoiceCsv's
 * "2026-09-09T00:41:38"); treated as UTC for storage into a `timestamptz`
 * column, matching this schema's other UTC-anchored comparisons
 * (resolveAssignment's `AT TIME ZONE 'UTC'` cast). */
function asUtcTimestamp(occurredAt: string): string {
  return `${occurredAt}Z`;
}

async function findExistingBySha256(pool: Pool, fileSha256: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM invoices WHERE file_sha256 = $1",
    [fileSha256],
  );
  return rows[0]?.id ?? null;
}

async function findExistingByInvoiceNumber(
  pool: Pool,
  invoiceNumber: string,
): Promise<ExistingInvoiceRow | null> {
  const { rows } = await pool.query<ExistingInvoiceRow>(
    "SELECT id, file_sha256 FROM invoices WHERE invoice_number = $1",
    [invoiceNumber],
  );
  return rows[0] ?? null;
}

/** The imported invoice, if any, already holding this currency's billing week. */
async function findImportedInWeek(
  pool: Pool,
  weekEnd: string,
  currency: InvoiceCurrency,
): Promise<{ id: string; invoice_number: string } | null> {
  const { rows } = await pool.query<{ id: string; invoice_number: string }>(
    `SELECT id, invoice_number FROM invoices
     WHERE billing_week_end = $1::date AND currency = $2 AND status = 'imported'`,
    [weekEnd, currency],
  );
  return rows[0] ?? null;
}

async function resolveCardMisses(
  pool: Pool,
  groups: readonly FuelStopGroup[],
): Promise<{ cardIds: Map<string, string>; misses: FuelStopGroup[] }> {
  const cardIds = new Map<string, string>();
  const misses: FuelStopGroup[] = [];
  for (const group of groups) {
    if (cardIds.has(group.cardNumber)) {
      continue;
    }
    const card = await getCardByNumber(pool, group.cardNumber);
    if (card) {
      cardIds.set(group.cardNumber, card.id);
    } else {
      misses.push(group);
    }
  }
  return { cardIds, misses };
}

/**
 * A genuinely blank tractor/unit (D20) has no truck to resolve and is never
 * a miss — `express_charges.truck_id`/`unit_raw` are nullable for exactly
 * this, the same way a blank driver name resolves to a null `driver_id`
 * without ever quarantining (`resolveExpressDriver`). Only a *present*
 * unit number this fleet doesn't recognise lands in `misses`.
 */
async function resolveTruckUnitMisses(
  pool: Pool,
  expressRows: readonly ExpressRow[],
): Promise<{ truckIds: Map<string, string>; misses: ExpressRow[] }> {
  const truckIds = new Map<string, string>();
  const misses: ExpressRow[] = [];
  for (const row of expressRows) {
    if (row.unitRaw === null) {
      continue;
    }
    if (truckIds.has(row.unitRaw)) {
      continue;
    }
    const truck = await getTruckByUnitNumber(pool, row.unitRaw);
    if (truck) {
      truckIds.set(row.unitRaw, truck.id);
    } else {
      misses.push(row);
    }
  }
  return { truckIds, misses };
}

interface FuelStopResolution {
  truckId: string | null;
  driverId: string | null;
  stationId: string | null;
}

/**
 * T-29: the truck/driver come from the card's assignment (never `unit_raw`),
 * the station from the entered site text (never BVD's `SITE` field). Neither
 * miss quarantines the invoice — a card with no assignment at the stop's
 * instant, or a station with no recognisable/known store number, leaves the
 * field null and is named in the report instead (CLAUDE.md: never a guess,
 * never silently dropped). Only groups whose card resolved are looked up
 * here; an unresolved card is already a quarantining rejection on its own.
 */
async function resolveFuelStopFields(
  pool: Pool,
  groups: readonly FuelStopGroup[],
  cardIds: ReadonlyMap<string, string>,
): Promise<{
  resolutions: ReadonlyMap<string, FuelStopResolution>;
  stationMisses: string[];
  truckAssignmentMisses: string[];
}> {
  const resolutions = new Map<string, FuelStopResolution>();
  const stationMisses: string[] = [];
  const truckAssignmentMisses: string[] = [];

  for (const group of groups) {
    const cardId = cardIds.get(group.cardNumber);
    if (!cardId) {
      continue;
    }

    const occurredAt = new Date(asUtcTimestamp(group.occurredAt));
    const truck = await resolveTruckForStop(pool, cardId, occurredAt, group.unitRaw);
    if (truck.truckId === null) {
      truckAssignmentMisses.push(group.cardNumber);
    }

    const stationId = await resolveStation(pool, group.siteNumber, group.stationNameRaw);
    if (stationId === null) {
      stationMisses.push(group.stationNameRaw);
    }

    resolutions.set(group.baseAuthCode, { truckId: truck.truckId, driverId: truck.driverId, stationId });
  }

  return { resolutions, stationMisses, truckAssignmentMisses };
}

/** T-29: express-charge driver names resolve through the same alias table as
 * fuel stops, independently per row — order-aligned with `expressRows` since
 * `express_code` carries no uniqueness guarantee to key a map on. */
async function resolveExpressChargeDrivers(
  pool: Pool,
  expressRows: readonly ExpressRow[],
): Promise<ExpressDriverResolution[]> {
  const resolutions: ExpressDriverResolution[] = [];
  for (const row of expressRows) {
    resolutions.push(await resolveExpressDriver(pool, row.driverNameRaw));
  }
  return resolutions;
}

export interface ActualRange {
  start: string | null;
  end: string | null;
}

/** First and last transaction date (UTC, `YYYY-MM-DD`) across every parsed
 * fuel line and express row — the invoice's *actual* range, which the printed
 * period can disagree with (999217 prints Aug 1 – Sep 9; its transactions run
 * Sep 3 – Sep 10). Taken from the parse, not the promoted rows, so a
 * quarantined invoice carries one too. `occurredAt` is the printed wall clock
 * stored as that instant in UTC, so its first ten characters are the date. */
export function actualRangeOf(
  lines: readonly { occurredAt: string }[],
  expressRows: readonly { occurredAt: string }[],
): ActualRange {
  let start: string | null = null;
  let end: string | null = null;
  for (const { occurredAt } of [...lines, ...expressRows]) {
    const day = occurredAt.slice(0, 10);
    if (start === null || day < start) start = day;
    if (end === null || day > end) end = day;
  }
  return { start, end };
}

async function insertInvoiceRow(
  client: PoolClient,
  parsed: ParsedInvoice,
  fileSha256: string,
  status: "imported" | "quarantined",
  actual: ActualRange,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO invoices
       (invoice_number, period_start, period_end, invoice_date, due_date,
        currency, qty_unit, grand_total, status, file_sha256,
        billing_week_end, actual_start, actual_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      parsed.header.invoiceNumber,
      parsed.header.periodStart,
      parsed.header.periodEnd,
      parsed.header.invoiceDate,
      parsed.header.dueDate,
      parsed.header.currency,
      qtyUnitFor(parsed.header.currency),
      parsed.printedTotals.grandTotal,
      status,
      fileSha256,
      parsed.header.periodEnd,
      actual.start,
      actual.end,
    ],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("invoices insert returned no id");
  }
  return id;
}

async function insertInvoiceTotals(
  client: PoolClient,
  invoiceId: string,
  parsed: ParsedInvoice,
): Promise<void> {
  const codesPresent = new Set(parsed.lines.map((l) => l.rawProductCode));
  for (const rawCode of codesPresent) {
    if (!KNOWN_PRODUCT_CODES.has(rawCode)) {
      continue; // unmapped codes never reach here — they're parser rejections
    }
    const printedLabel = rawCode === "C" ? "Manual Transactions" : rawCode;
    const printedRow = parsed.printedTotals.products.find((p) => p.productCode === printedLabel);
    if (!printedRow) {
      continue; // no printed figure for this code — nothing to record
    }
    await client.query(
      `INSERT INTO invoice_totals
         (invoice_id, product_code, qty, amount, discount, pre_tax_amount, hst, gst, pst, qst)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        invoiceId, rawCode, printedRow.qty ?? "0.00", printedRow.amount, printedRow.discount,
        printedRow.preTaxAmount, printedRow.hst, printedRow.gst, printedRow.pst, printedRow.qst,
      ],
    );
  }
}

async function insertFuelStop(
  client: PoolClient,
  invoiceId: string,
  group: FuelStopGroup,
  cardId: string,
  resolution: FuelStopResolution,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO fuel_stops
       (invoice_id, base_auth_code, occurred_at, card_id, truck_id, driver_id,
        unit_raw, driver_name_raw, station_id, total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      invoiceId,
      group.baseAuthCode,
      asUtcTimestamp(group.occurredAt),
      cardId,
      resolution.truckId,
      resolution.driverId,
      group.unitRaw,
      group.driverNameRaw,
      resolution.stationId,
      group.total,
    ],
  );
  const fuelStopId = rows[0]?.id;
  if (!fuelStopId) {
    throw new Error(`fuel_stops insert for ${group.baseAuthCode} returned no id`);
  }
  for (const line of group.lines) {
    await client.query(
      `INSERT INTO fuel_stop_lines
         (fuel_stop_id, product_code, qty, retail_per_unit, billed_per_unit, amount,
          pre_tax_amount, hst, gst, pst, qst)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        fuelStopId, line.rawProductCode, line.qty, line.retailPerUnit, line.billedPerUnit, line.amount,
        line.preTaxAmount, line.hst, line.gst, line.pst, line.qst,
      ],
    );
  }
}

async function insertExpressCharge(
  client: PoolClient,
  invoiceId: string,
  row: ExpressRow,
  truckId: string | null,
  driverResolution: ExpressDriverResolution,
): Promise<void> {
  await client.query(
    `INSERT INTO express_charges
       (invoice_id, express_code, occurred_at, truck_id, unit_raw,
        driver_id, driver_name_raw, amount, fee, total, payee, note,
        category, match_status, trailer_raw, cdl_raw, trip_number_raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      invoiceId,
      row.expressCode,
      asUtcTimestamp(row.occurredAt),
      truckId,
      row.unitRaw,
      driverResolution.driverId,
      row.driverNameRaw,
      row.amount,
      row.fee,
      row.total,
      row.payee,
      row.note,
      row.category,
      driverResolution.matchStatus,
      row.trailerRaw,
      row.cdlRaw,
      row.tripNumberRaw,
    ],
  );
}

async function insertInvoiceRejections(
  client: PoolClient,
  invoiceId: string,
  report: ImportReport,
): Promise<void> {
  for (const rejection of report.rejections) {
    await client.query(
      `INSERT INTO invoice_rejections (invoice_id, line_number, auth_code, code, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [invoiceId, rejection.lineNumber, rejection.authCode, rejection.code, rejection.message],
    );
  }
}

/**
 * Hash → dedupe on `file_sha256` → check `invoice_number` → parse → group →
 * reconcile → promote → run the anomaly engine, in one transaction, or write
 * the invoice row with `status='quarantined'` plus `invoice_rejections` and
 * stop (T-28). `runAnomalies` (T-30) only ever runs on a promoted invoice —
 * a quarantined one has zero `fuel_stops` for it to run rules over.
 *
 * Any rejection at all — a parser rejection, a reconcile imbalance, or an
 * unknown card/truck — forces quarantine: an invoice row with rejections
 * has zero child rows in fuel_stops/express_charges, never a partial
 * promote (the schema's own invariant, migrations/0003_actuals_schema.sql).
 *
 * `fuel_stops.truck_id`/`driver_id` and `express_charges.driver_id` resolve
 * from the card's driver and that driver's truck assignment (T-29's
 * `resolveTruckForStop`/`resolveExpressDriver`) — never from `unit_raw`/
 * `driver_name_raw`, which are stored verbatim alongside them and never
 * overwritten. `express_charges` has no card to resolve a truck from, so
 * that one is a plain, unambiguous unit-number lookup done here directly —
 * except a genuinely blank unit (D20), which leaves `truck_id` null rather
 * than quarantining, the same way a blank driver name leaves `driver_id`
 * null.
 *
 * No HTTP, no argv, no printing — the CLI in cli/importInvoice.ts (T-31) is
 * the only caller that touches stdout.
 */
export async function importInvoice(
  pool: Pool,
  buffer: Buffer,
  meta: ImportInvoiceMeta,
  options?: ImportInvoiceOptions,
): Promise<ImportInvoiceResult> {
  const productCodes = options?.productCodes ?? DEFAULT_INVOICE_PRODUCT_CODES;
  const parseFn = options?.parse ?? parseInvoiceCsv;

  const fileSha256 = createHash("sha256").update(buffer).digest("hex");
  const existingId = await findExistingBySha256(pool, fileSha256);

  const parsed = await parseFn(buffer, productCodes, meta.sourceFilename);

  const existingByNumber = await findExistingByInvoiceNumber(pool, parsed.header.invoiceNumber);
  if (existingByNumber && existingByNumber.file_sha256 !== fileSha256) {
    return {
      status: "conflict",
      reason: "invoice_number",
      existingInvoiceId: existingByNumber.id,
      message:
        `invoice ${parsed.header.invoiceNumber} was already imported from a different file ` +
        `(existing file_sha256 ${existingByNumber.file_sha256}, this one ${fileSha256})`,
    };
  }

  const groups = groupByAuthCode(parsed.lines);
  const reconcileResult = reconcile(groups, parsed.expressRows, parsed.printedTotals);
  const { cardIds, misses: cardMisses } = await resolveCardMisses(pool, groups);
  const { truckIds, misses: truckUnitMisses } = await resolveTruckUnitMisses(pool, parsed.expressRows);
  const expressBlankUnits = parsed.expressRows
    .filter((r) => r.unitRaw === null)
    .map((r) => r.expressCode);
  const {
    resolutions: fuelStopResolutions,
    stationMisses,
    truckAssignmentMisses,
  } = await resolveFuelStopFields(pool, groups, cardIds);
  const expressDriverResolutions = await resolveExpressChargeDrivers(pool, parsed.expressRows);

  const report = buildImportReport({
    invoiceNumber: parsed.header.invoiceNumber,
    fileSha256,
    periodStart: parsed.header.periodStart,
    periodEnd: parsed.header.periodEnd,
    currency: parsed.header.currency,
    qtyUnit: qtyUnitFor(parsed.header.currency),
    grandTotal: parsed.printedTotals.grandTotal,
    productTotals: parsed.printedTotals.products,
    parserRejections: parsed.rejections,
    reconcileResult,
    cardMisses,
    truckUnitMisses,
    stationMisses,
    truckAssignmentMisses,
    expressBlankUnits,
  });

  if (existingId) {
    return { status: "duplicate", invoiceId: existingId, report };
  }

  const promote = report.rejections.length === 0;

  if (promote) {
    const holder = await findImportedInWeek(pool, parsed.header.periodEnd, parsed.header.currency);
    if (holder) {
      return {
        status: "conflict",
        reason: "billing_week",
        existingInvoiceId: holder.id,
        message:
          `invoice ${holder.invoice_number} already holds the ${parsed.header.currency} billing week ` +
          `ending ${parsed.header.periodEnd}; ${parsed.header.invoiceNumber} cannot share it`,
      };
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invoiceId = await insertInvoiceRow(
      client,
      parsed,
      fileSha256,
      promote ? "imported" : "quarantined",
      actualRangeOf(parsed.lines, parsed.expressRows),
    );

    if (promote) {
      await insertInvoiceTotals(client, invoiceId, parsed);
      for (const group of groups) {
        const cardId = cardIds.get(group.cardNumber);
        if (!cardId) {
          throw new Error(`invariant violated: no resolved card for ${group.cardNumber}`);
        }
        const resolution = fuelStopResolutions.get(group.baseAuthCode);
        if (!resolution) {
          throw new Error(`invariant violated: no resolution computed for ${group.baseAuthCode}`);
        }
        await insertFuelStop(client, invoiceId, group, cardId, resolution);
      }
      for (let i = 0; i < parsed.expressRows.length; i++) {
        const row = parsed.expressRows[i]!;
        let truckId: string | null = null;
        if (row.unitRaw !== null) {
          const resolved = truckIds.get(row.unitRaw);
          if (!resolved) {
            throw new Error(`invariant violated: no resolved truck for express row ${row.expressCode}`);
          }
          truckId = resolved;
        }
        const driverResolution = expressDriverResolutions[i]!;
        await insertExpressCharge(client, invoiceId, row, truckId, driverResolution);
      }
      await runAnomalies(client, invoiceId);
    } else {
      await insertInvoiceRejections(client, invoiceId, report);
    }

    await client.query("COMMIT");
    return { status: promote ? "imported" : "quarantined", invoiceId, report };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
