import type { Pool } from "pg";
import type { AnomalySeverity } from "../db/types.js";

const TREND_PERIODS = 8;
const TOP_DRIVER_LIMIT = 10;
const ANOMALY_DIGEST_LIMIT = 10;

export interface MoneyAmount {
  amountUsd: number;
  currency: "USD";
}

export interface ProductRollup {
  gallons: number;
  amountUsd: number;
  currency: "USD";
}

export interface DiscountRollup {
  totalUsd: number;
  /** `null` when there are no TA gallons to average over. */
  avgUsdPerGal: number | null;
  currency: "USD";
}

export interface OtherChargesRollup {
  totalUsd: number;
  scaleUsd: number;
  expressUsd: number;
  expressFeeUsd: number;
  currency: "USD";
}

export interface ReceiptCompliance {
  confirmed: number;
  total: number;
}

export interface OverviewKpis {
  period: string;
  invoiceId: string | null;
  total: MoneyAmount;
  diesel: ProductRollup;
  def: ProductRollup;
  /** Headline metric (A6.3/A9): gallons-weighted, never a mean of prices. `null` with no TA gallons this period. */
  avgBilledUsdPerGal: number | null;
  /** Subordinate to `avgBilledUsdPerGal` everywhere it's rendered (A9.1). */
  discount: DiscountRollup;
  otherCharges: OtherChargesRollup;
  receiptCompliance: ReceiptCompliance;
  anomaliesFlagged: number;
}

export interface OverviewTrendPoint {
  period: string;
  invoiceId: string;
  avgBilledUsdPerGal: number | null;
}

export interface OverviewTopSpendDriver {
  driverId: string | null;
  driverName: string | null;
  totalUsd: number;
  gallons: number;
  avgBilledUsdPerGal: number | null;
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
  kpis: OverviewKpis;
  trend: OverviewTrendPoint[];
  topSpendByDriver: OverviewTopSpendDriver[];
  anomalyDigest: OverviewAnomalyDigestItem[];
}

export interface OverviewOptions {
  trendPeriods?: number;
  topDriverLimit?: number;
  anomalyDigestLimit?: number;
}

interface InvoiceRow {
  id: string;
  grand_total_usd: string;
}

async function loadInvoice(pool: Pool, period: string): Promise<InvoiceRow | null> {
  const { rows } = await pool.query<InvoiceRow>(
    "SELECT id, grand_total_usd FROM invoices WHERE period_start = $1::date",
    [period],
  );
  return rows[0] ?? null;
}

function emptyKpis(period: string): OverviewKpis {
  return {
    period,
    invoiceId: null,
    total: { amountUsd: 0, currency: "USD" },
    diesel: { gallons: 0, amountUsd: 0, currency: "USD" },
    def: { gallons: 0, amountUsd: 0, currency: "USD" },
    avgBilledUsdPerGal: null,
    discount: { totalUsd: 0, avgUsdPerGal: null, currency: "USD" },
    otherCharges: { totalUsd: 0, scaleUsd: 0, expressUsd: 0, expressFeeUsd: 0, currency: "USD" },
    receiptCompliance: { confirmed: 0, total: 0 },
    anomaliesFlagged: 0,
  };
}

interface InvoiceTotalRow {
  product_code: string;
  gallons: string;
  amount_usd: string;
  discount_usd: string | null;
}

interface DieselAggRow {
  ta_gallons: string | null;
  weighted_num: string | null;
}

interface ExpressAggRow {
  total_usd: string | null;
  fee_usd: string | null;
}

interface ReceiptAggRow {
  confirmed: string;
  total: string;
}

/** `avgBilledUsdPerGal`'s gallons-weighted numerator/denominator — the
 * proven formula (invoice999210.test.ts). Discount is read straight off
 * `invoice_totals.discount_usd` instead (`loadInvoiceTotals` below): BVD's
 * printed per-line "Disc AMT" doesn't reproduce from gallons ×
 * (retail − billed) at the 4dp precision this schema stores prices at, so
 * recomputing it drifted a few cents from the printed figure. */
async function loadDieselAgg(pool: Pool, invoiceId: string): Promise<DieselAggRow> {
  const { rows } = await pool.query<DieselAggRow>(
    `SELECT
       SUM(fsl.gallons) AS ta_gallons,
       SUM(fsl.gallons * fsl.billed_usd_per_gal) AS weighted_num
     FROM fuel_stop_lines fsl
     JOIN fuel_stops fs ON fs.id = fsl.fuel_stop_id
     WHERE fs.invoice_id = $1 AND fsl.product_code = 'TA'`,
    [invoiceId],
  );
  return rows[0]!;
}

/** `discount_usd` is BVD's own printed "Disc AMT" per product code, from the
 * invoice's Grand Totals section — trusted as given, same as the gallons
 * and amount columns this table already stores from that section (A11). */
async function loadInvoiceTotals(pool: Pool, invoiceId: string): Promise<Map<string, InvoiceTotalRow>> {
  const { rows } = await pool.query<InvoiceTotalRow>(
    "SELECT product_code, gallons, amount_usd, discount_usd FROM invoice_totals WHERE invoice_id = $1",
    [invoiceId],
  );
  return new Map(rows.map((r) => [r.product_code, r]));
}

async function loadExpressAgg(pool: Pool, invoiceId: string): Promise<ExpressAggRow> {
  const { rows } = await pool.query<ExpressAggRow>(
    "SELECT SUM(total_usd) AS total_usd, SUM(fee_usd) AS fee_usd FROM express_charges WHERE invoice_id = $1",
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

async function loadKpis(pool: Pool, period: string, invoice: InvoiceRow | null): Promise<OverviewKpis> {
  if (!invoice) {
    return emptyKpis(period);
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

  const taGallons = dieselAgg.ta_gallons === null ? 0 : Number(dieselAgg.ta_gallons);
  const avgBilledUsdPerGal = taGallons > 0 ? Number(dieselAgg.weighted_num) / taGallons : null;
  const discountTotal = [...totals.values()].reduce(
    (sum, row) => sum + (row.discount_usd === null ? 0 : Number(row.discount_usd)),
    0,
  );
  const scaleUsd = scale ? Number(scale.amount_usd) : 0;
  const expressUsd = expressAgg.total_usd === null ? 0 : Number(expressAgg.total_usd);
  const expressFeeUsd = expressAgg.fee_usd === null ? 0 : Number(expressAgg.fee_usd);

  return {
    period,
    invoiceId: invoice.id,
    total: { amountUsd: Number(invoice.grand_total_usd), currency: "USD" },
    diesel: { gallons: ta ? Number(ta.gallons) : 0, amountUsd: ta ? Number(ta.amount_usd) : 0, currency: "USD" },
    def: { gallons: df ? Number(df.gallons) : 0, amountUsd: df ? Number(df.amount_usd) : 0, currency: "USD" },
    avgBilledUsdPerGal,
    discount: {
      totalUsd: Math.round(discountTotal * 100) / 100,
      avgUsdPerGal: taGallons > 0 ? discountTotal / taGallons : null,
      currency: "USD",
    },
    otherCharges: {
      totalUsd: Math.round((scaleUsd + expressUsd) * 100) / 100,
      scaleUsd,
      expressUsd,
      expressFeeUsd,
      currency: "USD",
    },
    receiptCompliance: { confirmed: Number(receipts.confirmed), total: Number(receipts.total) },
    anomaliesFlagged,
  };
}

interface TrendRow {
  invoice_id: string;
  period_start: Date;
  ta_gallons: string | null;
  weighted_num: string | null;
}

/**
 * The trailing window ends at `period` and only ever lists periods that
 * actually have an invoice row — a period nobody imported is absent from
 * the array, never a zero-filled placeholder (Step 33.2's own test).
 */
async function loadTrend(pool: Pool, period: string, limit: number): Promise<OverviewTrendPoint[]> {
  const { rows } = await pool.query<TrendRow>(
    `SELECT i.id AS invoice_id, i.period_start,
            SUM(fsl.gallons) FILTER (WHERE fsl.product_code = 'TA') AS ta_gallons,
            SUM(fsl.gallons * fsl.billed_usd_per_gal) FILTER (WHERE fsl.product_code = 'TA') AS weighted_num
     FROM invoices i
     LEFT JOIN fuel_stops fs ON fs.invoice_id = i.id
     LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
     WHERE i.period_start <= $1::date
     GROUP BY i.id, i.period_start
     ORDER BY i.period_start DESC
     LIMIT $2`,
    [period, limit],
  );

  return rows
    .map((row) => {
      const taGallons = row.ta_gallons === null ? 0 : Number(row.ta_gallons);
      return {
        period: row.period_start.toISOString().slice(0, 10),
        invoiceId: row.invoice_id,
        avgBilledUsdPerGal: taGallons > 0 ? Number(row.weighted_num) / taGallons : null,
      };
    })
    .reverse();
}

interface TopSpendRow {
  driver_id: string | null;
  display_name: string | null;
  total_usd: string;
  ta_gallons: string | null;
  weighted_num: string | null;
}

/** Lines are folded into one row per stop *before* the group-by: summing
 * `fuel_stops.total_usd` straight across a join to `fuel_stop_lines` counts a
 * stop's total once per line, so a stop with a TA and a DF line was doubled. */
async function loadTopSpendByDriver(pool: Pool, invoiceId: string, limit: number): Promise<OverviewTopSpendDriver[]> {
  const { rows } = await pool.query<TopSpendRow>(
    `WITH stop_agg AS (
       SELECT fs.id, fs.driver_id, fs.total_usd,
              SUM(fsl.gallons) FILTER (WHERE fsl.product_code = 'TA') AS ta_gallons,
              SUM(fsl.gallons * fsl.billed_usd_per_gal) FILTER (WHERE fsl.product_code = 'TA') AS weighted_num
       FROM fuel_stops fs
       LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
       WHERE fs.invoice_id = $1
       GROUP BY fs.id
     )
     SELECT s.driver_id, d.display_name,
            SUM(s.total_usd) AS total_usd,
            SUM(s.ta_gallons) AS ta_gallons,
            SUM(s.weighted_num) AS weighted_num
     FROM stop_agg s
     LEFT JOIN drivers d ON d.id = s.driver_id
     GROUP BY s.driver_id, d.display_name
     ORDER BY total_usd DESC
     LIMIT $2`,
    [invoiceId, limit],
  );

  return rows.map((row) => {
    const taGallons = row.ta_gallons === null ? 0 : Number(row.ta_gallons);
    return {
      driverId: row.driver_id,
      driverName: row.display_name,
      totalUsd: Number(row.total_usd),
      gallons: taGallons,
      avgBilledUsdPerGal: taGallons > 0 ? Number(row.weighted_num) / taGallons : null,
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
    detail: row.detail,
    detectedAt: row.detected_at.toISOString(),
  }));
}

/**
 * `GET /overview?period=` (A8.1, A13). `period` is `invoices.period_start`
 * as a `YYYY-MM-DD` date — the one natural, near-unique key this table has
 * (A7's top-bar selector talks about periods, not invoice numbers).
 *
 * A period with no matching invoice is not an error: `kpis` comes back
 * zeroed with `invoiceId: null`, and `topSpendByDriver`/`anomalyDigest` come
 * back empty, since both are scoped to one invoice. `trend` is independent
 * of whether `period` itself resolves — it's the trailing window of whatever
 * periods actually exist at or before it.
 */
export async function getOverview(pool: Pool, period: string, options: OverviewOptions = {}): Promise<OverviewResult> {
  const trendPeriods = options.trendPeriods ?? TREND_PERIODS;
  const topDriverLimit = options.topDriverLimit ?? TOP_DRIVER_LIMIT;
  const anomalyDigestLimit = options.anomalyDigestLimit ?? ANOMALY_DIGEST_LIMIT;

  const invoice = await loadInvoice(pool, period);

  const [kpis, trend, topSpendByDriver, anomalyDigest] = await Promise.all([
    loadKpis(pool, period, invoice),
    loadTrend(pool, period, trendPeriods),
    invoice ? loadTopSpendByDriver(pool, invoice.id, topDriverLimit) : Promise.resolve([]),
    invoice ? loadAnomalyDigest(pool, invoice.id, anomalyDigestLimit) : Promise.resolve([]),
  ]);

  return { kpis, trend, topSpendByDriver, anomalyDigest };
}
