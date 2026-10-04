import type { Pool } from "pg";
import type { AnomalySeverity, InvoiceQtyUnit } from "../db/types.js";
import { normalizeAnomalyDetail } from "./anomalyDetail.js";
import { convertNullable, loadWeekInvoice, qtyConverter, type QtyConverter, type RequestedUnits, type WeekInvoice } from "./units.js";

const TREND_PERIODS = 8;
const TOP_DRIVER_LIMIT = 10;
const ANOMALY_DIGEST_LIMIT = 10;

/** T-63 serves the US side of a week only — `/overview` takes `week` alone and
 * T-65 shapes the CA and combined panels — so every money field here is USD. */
const OVERVIEW_CURRENCY = "USD" as const;

export interface MoneyAmount {
  amount: number;
  currency: "USD";
}

export interface ProductRollup {
  qty: number;
  amount: number;
  currency: "USD";
}

export interface DiscountRollup {
  total: number;
  /** `null` when there is no TA quantity to average over. */
  avgPerUnit: number | null;
  currency: "USD";
}

export interface OtherChargesRollup {
  total: number;
  scale: number;
  express: number;
  expressFee: number;
  currency: "USD";
}

export interface ReceiptCompliance {
  confirmed: number;
  total: number;
}

export interface OverviewKpis {
  /** The billing week's end, as asked. */
  week: string;
  invoiceId: string | null;
  total: MoneyAmount;
  diesel: ProductRollup;
  def: ProductRollup;
  /** Headline metric (A6.3/A9): quantity-weighted, never a mean of prices. `null` with no TA quantity this week. */
  avgBilledPerUnit: number | null;
  /** Subordinate to `avgBilledUsdPerGal` everywhere it's rendered (A9.1). */
  discount: DiscountRollup;
  otherCharges: OtherChargesRollup;
  receiptCompliance: ReceiptCompliance;
  anomaliesFlagged: number;
}

export interface OverviewTrendPoint {
  /** The billing week's end, `YYYY-MM-DD`. */
  week: string;
  invoiceId: string;
  avgBilledPerUnit: number | null;
}

export interface OverviewTopSpendDriver {
  driverId: string | null;
  driverName: string | null;
  total: number;
  qty: number;
  avgBilledPerUnit: number | null;
}

export interface OverviewAnomalyDigestItem {
  id: string;
  fuelStopId: string;
  rule: string;
  severity: AnomalySeverity;
  detail: unknown;
  detectedAt: string;
}

export interface OverviewResult {
  /** What every money field below is in. */
  currency: "USD";
  /** What every `qty` below is in — gallons, unless `?units=metric`. */
  qtyUnit: InvoiceQtyUnit;
  kpis: OverviewKpis;
  trend: OverviewTrendPoint[];
  topSpendByDriver: OverviewTopSpendDriver[];
  anomalyDigest: OverviewAnomalyDigestItem[];
}

export interface OverviewOptions {
  /** `?units=` — absent means gallons, a US invoice as BVD printed it. */
  units?: RequestedUnits;
  trendPeriods?: number;
  topDriverLimit?: number;
  anomalyDigestLimit?: number;
}

function emptyKpis(week: string): OverviewKpis {
  return {
    week,
    invoiceId: null,
    total: { amount: 0, currency: OVERVIEW_CURRENCY },
    diesel: { qty: 0, amount: 0, currency: OVERVIEW_CURRENCY },
    def: { qty: 0, amount: 0, currency: OVERVIEW_CURRENCY },
    avgBilledPerUnit: null,
    discount: { total: 0, avgPerUnit: null, currency: OVERVIEW_CURRENCY },
    otherCharges: { total: 0, scale: 0, express: 0, expressFee: 0, currency: OVERVIEW_CURRENCY },
    receiptCompliance: { confirmed: 0, total: 0 },
    anomaliesFlagged: 0,
  };
}

interface InvoiceTotalRow {
  product_code: string;
  qty: string;
  amount: string;
  discount: string | null;
}

interface DieselAggRow {
  ta_gallons: string | null;
  weighted_num: string | null;
}

interface ExpressAggRow {
  total: string | null;
  fee: string | null;
}

interface ReceiptAggRow {
  confirmed: string;
  total: string;
}

/** `avgBilledPerUnit`'s quantity-weighted numerator/denominator — the
 * proven formula (invoice999210.test.ts). Discount is read straight off
 * `invoice_totals.discount` instead (`loadInvoiceTotals` below): BVD's
 * printed per-line "Disc AMT" doesn't reproduce from gallons ×
 * (retail − billed) at the 4dp precision this schema stores prices at, so
 * recomputing it drifted a few cents from the printed figure. */
async function loadDieselAgg(pool: Pool, invoiceId: string): Promise<DieselAggRow> {
  const { rows } = await pool.query<DieselAggRow>(
    `SELECT
       SUM(fsl.qty) AS ta_gallons,
       SUM(fsl.qty * fsl.billed_per_unit) AS weighted_num
     FROM fuel_stop_lines fsl
     JOIN fuel_stops fs ON fs.id = fsl.fuel_stop_id
     WHERE fs.invoice_id = $1 AND fsl.product_code = 'TA'`,
    [invoiceId],
  );
  return rows[0]!;
}

/** `discount` is BVD's own printed "Disc AMT" per product code, from the
 * invoice's Grand Totals section — trusted as given, same as the gallons
 * and amount columns this table already stores from that section (A11). */
async function loadInvoiceTotals(pool: Pool, invoiceId: string): Promise<Map<string, InvoiceTotalRow>> {
  const { rows } = await pool.query<InvoiceTotalRow>(
    "SELECT product_code, qty, amount, discount FROM invoice_totals WHERE invoice_id = $1",
    [invoiceId],
  );
  return new Map(rows.map((r) => [r.product_code, r]));
}

async function loadExpressAgg(pool: Pool, invoiceId: string): Promise<ExpressAggRow> {
  const { rows } = await pool.query<ExpressAggRow>(
    "SELECT SUM(total) AS total, SUM(fee) AS fee FROM express_charges WHERE invoice_id = $1",
    [invoiceId],
  );
  return rows[0]!;
}

async function loadReceiptCompliance(pool: Pool, invoiceId: string): Promise<ReceiptAggRow> {
  const { rows } = await pool.query<ReceiptAggRow>(
    `SELECT
       count(*) FILTER (WHERE receipt_status = 'confirmed') AS confirmed,
       count(*) AS total
     FROM fuel_stops WHERE invoice_id = $1`,
    [invoiceId],
  );
  return rows[0]!;
}

async function loadAnomalyCount(pool: Pool, invoiceId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM anomalies a
     JOIN fuel_stops fs ON fs.id = a.subject_id
     WHERE a.subject_type = 'fuel_stop' AND a.dismissed_at IS NULL AND fs.invoice_id = $1`,
    [invoiceId],
  );
  return Number(rows[0]!.count);
}

async function loadKpis(pool: Pool, week: string, invoice: WeekInvoice | null, conv: QtyConverter): Promise<OverviewKpis> {
  if (!invoice) {
    return emptyKpis(week);
  }

  const [totals, dieselAgg, expressAgg, receipts, anomaliesFlagged] = await Promise.all([
    loadInvoiceTotals(pool, invoice.id),
    loadDieselAgg(pool, invoice.id),
    loadExpressAgg(pool, invoice.id),
    loadReceiptCompliance(pool, invoice.id),
    loadAnomalyCount(pool, invoice.id),
  ]);

  const ta = totals.get("TA");
  const df = totals.get("DF");
  const scale = totals.get("S");

  const taQty = dieselAgg.ta_gallons === null ? 0 : Number(dieselAgg.ta_gallons);
  const avgBilledStored = taQty > 0 ? Number(dieselAgg.weighted_num) / taQty : null;
  const discountTotal = [...totals.values()].reduce(
    (sum, row) => sum + (row.discount === null ? 0 : Number(row.discount)),
    0,
  );
  const scaleAmount = scale ? Number(scale.amount) : 0;
  const expressAmount = expressAgg.total === null ? 0 : Number(expressAgg.total);
  const expressFee = expressAgg.fee === null ? 0 : Number(expressAgg.fee);

  return {
    week,
    invoiceId: invoice.id,
    total: { amount: Number(invoice.grandTotal), currency: OVERVIEW_CURRENCY },
    diesel: { qty: ta ? conv.qty(Number(ta.qty)) : 0, amount: ta ? Number(ta.amount) : 0, currency: OVERVIEW_CURRENCY },
    def: { qty: df ? conv.qty(Number(df.qty)) : 0, amount: df ? Number(df.amount) : 0, currency: OVERVIEW_CURRENCY },
    avgBilledPerUnit: convertNullable(conv.perUnit, avgBilledStored),
    discount: {
      total: Math.round(discountTotal * 100) / 100,
      avgPerUnit: convertNullable(conv.perUnit, taQty > 0 ? discountTotal / taQty : null),
      currency: OVERVIEW_CURRENCY,
    },
    otherCharges: {
      total: Math.round((scaleAmount + expressAmount) * 100) / 100,
      scale: scaleAmount,
      express: expressAmount,
      expressFee,
      currency: OVERVIEW_CURRENCY,
    },
    receiptCompliance: { confirmed: Number(receipts.confirmed), total: Number(receipts.total) },
    anomaliesFlagged,
  };
}

interface TrendRow {
  invoice_id: string;
  week_end: string;
  ta_gallons: string | null;
  weighted_num: string | null;
}

/**
 * The trailing window ends at `week` and only ever lists weeks that actually
 * have an imported USD invoice — a week nobody imported is absent from the
 * array, never a zero-filled placeholder (Step 33.2's own test).
 */
async function loadTrend(pool: Pool, week: string, limit: number, conv: QtyConverter): Promise<OverviewTrendPoint[]> {
  const { rows } = await pool.query<TrendRow>(
    `SELECT i.id AS invoice_id, to_char(i.billing_week_end, 'YYYY-MM-DD') AS week_end,
            SUM(fsl.qty) FILTER (WHERE fsl.product_code = 'TA') AS ta_gallons,
            SUM(fsl.qty * fsl.billed_per_unit) FILTER (WHERE fsl.product_code = 'TA') AS weighted_num
     FROM invoices i
     LEFT JOIN fuel_stops fs ON fs.invoice_id = i.id
     LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
     WHERE i.billing_week_end <= $1::date AND i.currency = $3 AND i.status = 'imported'
     GROUP BY i.id, i.billing_week_end
     ORDER BY i.billing_week_end DESC
     LIMIT $2`,
    [week, limit, OVERVIEW_CURRENCY],
  );

  return rows
    .map((row) => {
      const taQty = row.ta_gallons === null ? 0 : Number(row.ta_gallons);
      return {
        week: row.week_end,
        invoiceId: row.invoice_id,
        avgBilledPerUnit: convertNullable(conv.perUnit, taQty > 0 ? Number(row.weighted_num) / taQty : null),
      };
    })
    .reverse();
}

interface TopSpendRow {
  driver_id: string | null;
  display_name: string | null;
  total: string;
  ta_gallons: string | null;
  weighted_num: string | null;
}

/** Lines are folded into one row per stop *before* the group-by: summing
 * `fuel_stops.total` straight across a join to `fuel_stop_lines` counts a
 * stop's total once per line, so a stop with a TA and a DF line was doubled. */
async function loadTopSpendByDriver(
  pool: Pool,
  invoiceId: string,
  limit: number,
  conv: QtyConverter,
): Promise<OverviewTopSpendDriver[]> {
  const { rows } = await pool.query<TopSpendRow>(
    `WITH stop_agg AS (
       SELECT fs.id, fs.driver_id, fs.total,
              SUM(fsl.qty) FILTER (WHERE fsl.product_code = 'TA') AS ta_gallons,
              SUM(fsl.qty * fsl.billed_per_unit) FILTER (WHERE fsl.product_code = 'TA') AS weighted_num
       FROM fuel_stops fs
       LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
       WHERE fs.invoice_id = $1
       GROUP BY fs.id
     )
     SELECT s.driver_id, d.display_name,
            SUM(s.total) AS total,
            SUM(s.ta_gallons) AS ta_gallons,
            SUM(s.weighted_num) AS weighted_num
     FROM stop_agg s
     LEFT JOIN drivers d ON d.id = s.driver_id
     GROUP BY s.driver_id, d.display_name
     ORDER BY total DESC
     LIMIT $2`,
    [invoiceId, limit],
  );

  return rows.map((row) => {
    const taQty = row.ta_gallons === null ? 0 : Number(row.ta_gallons);
    return {
      driverId: row.driver_id,
      driverName: row.display_name,
      total: Number(row.total),
      qty: conv.qty(taQty),
      avgBilledPerUnit: convertNullable(conv.perUnit, taQty > 0 ? Number(row.weighted_num) / taQty : null),
    };
  });
}

interface AnomalyDigestRow {
  id: string;
  fuel_stop_id: string;
  rule: string;
  severity: AnomalySeverity;
  detail: unknown;
  detected_at: Date;
}

/** Deep-links into Transactions off `fuelStopId` — the same id `GET
 * /transactions/{id}` (T-32) resolves. */
async function loadAnomalyDigest(pool: Pool, invoiceId: string, limit: number): Promise<OverviewAnomalyDigestItem[]> {
  const { rows } = await pool.query<AnomalyDigestRow>(
    `SELECT a.id, a.subject_id AS fuel_stop_id, a.rule, a.severity, a.detail, a.detected_at
     FROM anomalies a
     JOIN fuel_stops fs ON fs.id = a.subject_id
     WHERE a.subject_type = 'fuel_stop' AND a.dismissed_at IS NULL AND fs.invoice_id = $1
     ORDER BY (a.severity = 'red') DESC, a.detected_at DESC
     LIMIT $2`,
    [invoiceId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    fuelStopId: row.fuel_stop_id,
    rule: row.rule,
    severity: row.severity,
    // Stored as each rule wrote it; the legacy US shape carries `Usd`/`gallons`
    // keys that the contract no longer has (T-63), so it is normalised on the way out.
    detail: normalizeAnomalyDetail(row.detail),
    detectedAt: row.detected_at.toISOString(),
  }));
}

/**
 * `GET /overview?week=` (A8.1, A13). `week` is a billing week's end (D26).
 * T-63 serves the week's US invoice only; T-65 shapes the CA and combined panels.
 *
 * A week with no US invoice is not an error: `kpis` comes back zeroed with
 * `invoiceId: null`, and `topSpendByDriver`/`anomalyDigest` come back empty,
 * since both are scoped to one invoice. `trend` is independent of whether
 * `week` itself resolves — it's the trailing window of whatever weeks actually
 * exist at or before it.
 */
export async function getOverview(pool: Pool, week: string, options: OverviewOptions = {}): Promise<OverviewResult> {
  const trendPeriods = options.trendPeriods ?? TREND_PERIODS;
  const topDriverLimit = options.topDriverLimit ?? TOP_DRIVER_LIMIT;
  const anomalyDigestLimit = options.anomalyDigestLimit ?? ANOMALY_DIGEST_LIMIT;

  const invoice = await loadWeekInvoice(pool, week, OVERVIEW_CURRENCY);
  const conv = qtyConverter(invoice?.qtyUnit ?? "gal", options.units ?? null);

  const [kpis, trend, topSpendByDriver, anomalyDigest] = await Promise.all([
    loadKpis(pool, week, invoice, conv),
    loadTrend(pool, week, trendPeriods, conv),
    invoice ? loadTopSpendByDriver(pool, invoice.id, topDriverLimit, conv) : Promise.resolve([]),
    invoice ? loadAnomalyDigest(pool, invoice.id, anomalyDigestLimit) : Promise.resolve([]),
  ]);

  return { currency: OVERVIEW_CURRENCY, qtyUnit: conv.qtyUnit, kpis, trend, topSpendByDriver, anomalyDigest };
}
