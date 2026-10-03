import type { InvoiceCurrency, InvoiceQtyUnit } from "../db/types.js";
import type { Pool, PoolClient } from "pg";
import { DEFAULT_INVOICE_PRODUCT_CODES } from "../invoice/productCode.js";
import { chargesNoFuel, type ChargesNoFuelConfig, type ChargesNoFuelStop } from "./rules/chargesNoFuel.js";
import {
  priceAbovePublished,
  publishedPriceKey,
  toAnomalyFinding,
  type PriceAbovePublishedConfig,
  type PriceAbovePublishedStop,
} from "./rules/priceAbovePublished.js";
import { subGallon, type SubGallonConfig, type SubGallonStop } from "./rules/subGallon.js";
import { tooClose, type TooCloseConfig, type TooCloseStop } from "./rules/tooClose.js";
import { unitMismatch, type UnitMismatchConfig, type UnitMismatchStop } from "./rules/unitMismatch.js";
import type { AnomalyFinding } from "./types.js";

type Db = Pool | PoolClient;

const RULE_NAMES = [
  "sub_gallon",
  "unit_mismatch",
  "too_close",
  "charges_no_fuel",
  "price_above_published",
] as const;
type RuleName = (typeof RULE_NAMES)[number];

export interface NotComputableEntry {
  rule: RuleName;
  subjectId: string;
  reason: string;
}

export interface RunAnomaliesResult {
  inserted: number;
  updated: number;
  /** Never collapsed into "no anomaly" — §A18 Q5's own requirement. Only
   * `price_above_published` produces these today. */
  notComputable: NotComputableEntry[];
}

interface StopRow {
  id: string;
  occurred_at: Date;
  card_id: string;
  station_id: string | null;
  unit_raw: string;
  truck_unit_number: string | null;
}

interface LineRow {
  fuel_stop_id: string;
  product_code: string;
  qty: string;
  amount: string;
  billed_per_unit: string;
  currency: InvoiceCurrency;
  qty_unit: InvoiceQtyUnit;
}

async function loadThresholds(db: Db): Promise<Map<RuleName, unknown>> {
  const { rows } = await db.query<{ rule: string; config: unknown }>(
    "SELECT rule, config FROM anomaly_thresholds WHERE rule = ANY($1)",
    [RULE_NAMES],
  );
  const byRule = new Map(rows.map((r) => [r.rule, r.config]));
  for (const rule of RULE_NAMES) {
    if (!byRule.has(rule)) {
      throw new Error(`no anomaly_thresholds row for rule '${rule}' (migrations/0004_actuals_config_seed.sql)`);
    }
  }
  return byRule as Map<RuleName, unknown>;
}

/** Just the `price_above_published` row — for callers that audit prices
 * without running every rule (`GET /stations/{id}/billed-prices`). Same table,
 * same missing-row failure as `loadThresholds`: thresholds are data (D16). */
export async function loadPriceAbovePublishedConfig(db: Db): Promise<PriceAbovePublishedConfig> {
  const { rows } = await db.query<{ config: PriceAbovePublishedConfig }>(
    "SELECT config FROM anomaly_thresholds WHERE rule = $1",
    ["price_above_published"],
  );
  if (!rows[0]) {
    throw new Error("no anomaly_thresholds row for rule 'price_above_published' (migrations/0004_actuals_config_seed.sql)");
  }
  return rows[0].config;
}

async function loadStops(db: Db, invoiceId: string): Promise<StopRow[]> {
  const { rows } = await db.query<StopRow>(
    `SELECT fs.id, fs.occurred_at, fs.card_id, fs.station_id, fs.unit_raw,
            t.unit_number AS truck_unit_number
     FROM fuel_stops fs
     LEFT JOIN trucks t ON t.id = fs.truck_id
     WHERE fs.invoice_id = $1
     ORDER BY fs.occurred_at`,
    [invoiceId],
  );
  return rows;
}

async function loadLines(db: Db, invoiceId: string): Promise<Map<string, LineRow[]>> {
  const { rows } = await db.query<LineRow>(
    `SELECT fsl.fuel_stop_id, fsl.product_code, fsl.qty, fsl.amount, fsl.billed_per_unit,
            i.currency, i.qty_unit
     FROM fuel_stop_lines fsl
     JOIN fuel_stops fs ON fs.id = fsl.fuel_stop_id
     JOIN invoices i ON i.id = fs.invoice_id
     WHERE fs.invoice_id = $1`,
    [invoiceId],
  );
  const byStop = new Map<string, LineRow[]>();
  for (const row of rows) {
    const existing = byStop.get(row.fuel_stop_id);
    if (existing) {
      existing.push(row);
    } else {
      byStop.set(row.fuel_stop_id, [row]);
    }
  }
  return byStop;
}

/** `station_prices` (v1 §12) is the published price file this rule audits
 * against — reused, never reinvented. Only rows for stations this invoice
 * actually visited are fetched. */
export async function loadPublishedPrices(
  db: Db,
  stationIds: readonly string[],
  fuelProductCode: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (stationIds.length === 0) {
    return map;
  }
  const productType = DEFAULT_INVOICE_PRODUCT_CODES.get(fuelProductCode);
  if (!productType) {
    throw new Error(`price_above_published config: unknown fuelProductCode '${fuelProductCode}'`);
  }
  const { rows } = await db.query<{ station_id: string; valid_on: Date; your_price: string | null }>(
    `SELECT station_id, valid_on, your_price
     FROM station_prices
     WHERE product_type = $2 AND station_id = ANY($1)`,
    [stationIds, productType],
  );
  for (const row of rows) {
    if (row.your_price === null) {
      continue; // no figure to audit against — same as no row at all
    }
    const validOn = row.valid_on.toISOString().slice(0, 10);
    map.set(publishedPriceKey(row.station_id, validOn), row.your_price);
  }
  return map;
}

function occurredOnDate(occurredAt: Date): string {
  return occurredAt.toISOString().slice(0, 10);
}

function billedDieselPrice(lines: readonly LineRow[], fuelProductCode: string): string | null {
  const line = lines.find((l) => l.product_code === fuelProductCode);
  return line ? line.billed_per_unit : null;
}

/**
 * Upserts one finding, keyed on the schema's own `(rule, subject_type,
 * subject_id)` unique constraint (migrations/0003_actuals_schema.sql). A dismissed
 * row (`dismissed_at IS NOT NULL`) is left completely untouched — the `WHERE`
 * clause on the `DO UPDATE` makes the statement affect zero rows for it,
 * which is how a re-run never resurrects a dismissal.
 */
async function upsertFinding(db: Db, rule: RuleName, finding: AnomalyFinding): Promise<"inserted" | "updated" | "skipped"> {
  const { rows } = await db.query<{ inserted: boolean }>(
    `INSERT INTO anomalies (subject_type, subject_id, rule, severity, detail)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (rule, subject_type, subject_id) DO UPDATE
       SET severity = EXCLUDED.severity, detail = EXCLUDED.detail
       WHERE anomalies.dismissed_at IS NULL
     RETURNING (xmax = 0) AS inserted`,
    [finding.subjectType, finding.subjectId, rule, finding.severity, JSON.stringify(finding.detail)],
  );
  const row = rows[0];
  if (!row) {
    return "skipped"; // conflicted with a dismissed row — left alone, on purpose
  }
  return row.inserted ? "inserted" : "updated";
}

/**
 * Runs every T-30 rule over one invoice's stops and upserts the findings.
 * Thresholds come from `anomaly_thresholds`, never a code constant (D16).
 * An invoice with zero `fuel_stops` (a quarantined one) trivially produces
 * zero anomalies — there is nothing to run the rules over.
 *
 * Call after promotion, inside the same transaction `importInvoice` used to
 * write the stops, so the rules see what was just written.
 */
export async function runAnomalies(db: Db, invoiceId: string): Promise<RunAnomaliesResult> {
  const thresholds = await loadThresholds(db);
  const stops = await loadStops(db, invoiceId);
  const linesByStop = await loadLines(db, invoiceId);

  const priceConfig = thresholds.get("price_above_published") as PriceAbovePublishedConfig;
  const stationIds = [...new Set(stops.map((s) => s.station_id).filter((id): id is string => id !== null))];
  const publishedPrices = await loadPublishedPrices(db, stationIds, priceConfig.fuelProductCode);

  const findings: { rule: RuleName; finding: AnomalyFinding }[] = [];
  const notComputable: NotComputableEntry[] = [];

  const subGallonStops: SubGallonStop[] = stops.map((s) => ({
    id: s.id,
    lines: (linesByStop.get(s.id) ?? []).map((l) => ({
      productCode: l.product_code,
      qty: l.qty,
      qtyUnit: l.qty_unit,
      amount: l.amount,
      currency: l.currency,
    })),
  }));
  for (const finding of subGallon(subGallonStops, thresholds.get("sub_gallon") as SubGallonConfig)) {
    findings.push({ rule: "sub_gallon", finding });
  }

  const unitMismatchStops: UnitMismatchStop[] = stops.map((s) => ({
    id: s.id,
    unitRaw: s.unit_raw,
    truckUnitNumber: s.truck_unit_number,
  }));
  for (const finding of unitMismatch(unitMismatchStops, thresholds.get("unit_mismatch") as UnitMismatchConfig)) {
    findings.push({ rule: "unit_mismatch", finding });
  }

  const tooCloseStops: TooCloseStop[] = stops.map((s) => ({
    id: s.id,
    cardId: s.card_id,
    stationId: s.station_id,
    occurredAt: s.occurred_at,
  }));
  for (const finding of tooClose(tooCloseStops, thresholds.get("too_close") as TooCloseConfig)) {
    findings.push({ rule: "too_close", finding });
  }

  const chargesNoFuelStops: ChargesNoFuelStop[] = stops.map((s) => ({
    id: s.id,
    lines: (linesByStop.get(s.id) ?? []).map((l) => ({
      productCode: l.product_code,
      qty: l.qty,
      amount: l.amount,
      currency: l.currency,
    })),
  }));
  for (const finding of chargesNoFuel(chargesNoFuelStops, thresholds.get("charges_no_fuel") as ChargesNoFuelConfig)) {
    findings.push({ rule: "charges_no_fuel", finding });
  }

  const priceStops: PriceAbovePublishedStop[] = stops.map((s) => ({
    id: s.id,
    stationId: s.station_id,
    occurredOn: occurredOnDate(s.occurred_at),
    billedUsdPerGal: billedDieselPrice(linesByStop.get(s.id) ?? [], priceConfig.fuelProductCode),
    currency: linesByStop.get(s.id)?.[0]?.currency ?? "USD",
  }));
  for (const result of priceAbovePublished(priceStops, publishedPrices, priceConfig)) {
    if (result.status === "not_computable") {
      notComputable.push({ rule: "price_above_published", subjectId: result.subjectId, reason: result.reason });
      continue;
    }
    const finding = toAnomalyFinding(result);
    if (finding) {
      findings.push({ rule: "price_above_published", finding });
    }
  }

  let inserted = 0;
  let updated = 0;
  for (const { rule, finding } of findings) {
    const outcome = await upsertFinding(db, rule, finding);
    if (outcome === "inserted") inserted++;
    else if (outcome === "updated") updated++;
  }

  return { inserted, updated, notComputable };
}
