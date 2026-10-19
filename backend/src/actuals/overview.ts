import type { Pool } from "pg";
import type { AnomalySeverity, InvoiceCurrency, InvoiceQtyUnit } from "../db/types.js";
import { normalizeAnomalyDetail } from "./anomalyDetail.js";
import {
  convertNullable,
  loadWeekInvoice,
  moneyConverter,
  qtyConverter,
  type InvoiceFx,
  type QtyConverter,
  type RequestedUnits,
  type StoredFx,
  type WeekInvoice,
} from "./units.js";

const TREND_PERIODS = 8;
const TOP_DRIVER_LIMIT = 10;
const ANOMALY_DIGEST_LIMIT = 10;

export interface MoneyAmount {
  amount: number;
  currency: InvoiceCurrency;
}

export interface ProductRollup {
  qty: number;
  /** Final AMT, tax included (the printed figure). */
  amount: number;
  /** `amount - tax`; equal to `amount` on a US invoice. */
  preTax: number;
  /** HST + GST + PST + QST; zero on a US invoice. */
  tax: number;
  currency: InvoiceCurrency;
}

/** A side's spend split the way the CA panel shows it (T-65): `beforeTax + tax
 * = withTax` exactly, and `withTax` is the invoice's grand total. `tax` is the
 * sum of the grand-total rows' four tax columns; `beforeTax` is what is left,
 * so Scale and Express (which print a final amount alone) land before tax. */
export interface OverviewTax {
  beforeTax: number;
  tax: number;
  withTax: number;
  hst: number;
  gst: number;
  pst: number;
  qst: number;
  currency: InvoiceCurrency;
}

export interface DiscountRollup {
  total: number;
  /** `null` when there is no TA quantity to average over. */
  avgPerUnit: number | null;
  currency: InvoiceCurrency;
}

export interface OtherChargesRollup {
  total: number;
  scale: number;
  express: number;
  expressFee: number;
  currency: InvoiceCurrency;
}

export interface ReceiptCompliance {
  confirmed: number;
  total: number;
}

export interface OverviewKpis {
  /** The billing week's end, as asked. */
  week: string;
  invoiceId: string;
  total: MoneyAmount;
  /** The spend split before tax / tax / with tax (T-65). */
  tax: OverviewTax;
  diesel: ProductRollup;
  def: ProductRollup;
  /** Headline metric (A6.3/A9): quantity-weighted, never a mean of prices. `null` with no TA quantity this week.
   * As billed, so with tax on a CA invoice. */
  avgBilledPerUnit: number | null;
  /** The same average before tax; equal to `avgBilledPerUnit` on a US invoice. */
  avgBilledPreTaxPerUnit: number | null;
  /** Subordinate to `avgBilledPerUnit` everywhere it's rendered (A9.1). */
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

/** One side of a week — the per-invoice body, in the invoice's own currency
 * and (unless `?units=`) its own unit. */
export interface OverviewSide {
  /** What every money field below is in. */
  currency: InvoiceCurrency;
  /** What every `qty` below is in. */
  qtyUnit: InvoiceQtyUnit;
  kpis: OverviewKpis;
  trend: OverviewTrendPoint[];
  topSpendByDriver: OverviewTopSpendDriver[];
  anomalyDigest: OverviewAnomalyDigestItem[];
}

/** Money in the combined panel's currency. Every field is `null` while
 * `ratePending`: nothing is computed without an entered rate (D27). */
export interface CombinedSplit {
  beforeTax: number | null;
  tax: number | null;
  withTax: number | null;
}

export interface CombinedProduct extends CombinedSplit {
  /** In the combined panel's `qtyUnit`. */
  qty: number;
}

export interface OverviewCombined {
  /** What every money field below is in: USD unless `?convertTo=CAD`. */
  currency: InvoiceCurrency;
  /** What every `qty` and per-unit rate below is in: gallons unless `?units=metric`. */
  qtyUnit: InvoiceQtyUnit;
  /** One side is not imported: the figures are the present side's alone. */
  partial: boolean;
  /** Which side is missing when `partial`. */
  missingSide: InvoiceCurrency | null;
  /** Converting needs the CA invoice's entered rate and there is none. */
  ratePending: boolean;
  spend: CombinedSplit;
  diesel: CombinedProduct;
  def: CombinedProduct;
  /** Discount captured; a single value (a discount has no tax split). */
  discount: number | null;
  /** Diesel spend over diesel quantity, before and with tax, per `qtyUnit`. */
  avgBilledPreTaxPerUnit: number | null;
  avgBilledPerUnit: number | null;
}

export interface OverviewResult {
  /** `null` when the week has no imported US invoice. */
  us: OverviewSide | null;
  /** `null` when the week has no imported CA invoice. */
  ca: OverviewSide | null;
  /** `null` only when neither side is imported. */
  combined: OverviewCombined | null;
  /** The CA invoice's entered exchange rate (CAD per 1 USD); `null` until entered, or with no CA invoice. */
  fx: InvoiceFx | null;
}

export interface OverviewOptions {
  /** `?units=` — absent means each side as BVD printed it (the combined panel: gallons). */
  units?: RequestedUnits;
  /** `?convertTo=` — the combined panel's currency; absent means USD. */
  convertTo?: InvoiceCurrency | null;
  trendPeriods?: number;
  topDriverLimit?: number;
  anomalyDigestLimit?: number;
}

interface InvoiceTotalRow {
  product_code: string;
  qty: string;
  amount: string;
  discount: string | null;
  hst: string;
  gst: string;
  pst: string;
  qst: string;
}

interface DieselAggRow {
  ta_gallons: string | null;
  weighted_num: string | null;
  /** Over the TA lines that print a pre-tax amount, and their quantity. */
  pre_tax_num: string | null;
  pre_tax_gallons: string | null;
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
       SUM(fsl.qty * fsl.billed_per_unit) AS weighted_num,
       SUM(fsl.pre_tax_amount) AS pre_tax_num,
       SUM(fsl.qty) FILTER (WHERE fsl.pre_tax_amount IS NOT NULL) AS pre_tax_gallons
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
    "SELECT product_code, qty, amount, discount, hst, gst, pst, qst FROM invoice_totals WHERE invoice_id = $1",
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

const toCents = (value: string | number): number => Math.round(Number(value) * 100);
const fromCents = (cents: number): number => cents / 100;

function taxCents(row: InvoiceTotalRow | undefined): number {
  return row ? toCents(row.hst) + toCents(row.gst) + toCents(row.pst) + toCents(row.qst) : 0;
}

function productRollup(row: InvoiceTotalRow | undefined, currency: InvoiceCurrency, conv: QtyConverter): ProductRollup {
  const amount = row ? toCents(row.amount) : 0;
  const tax = taxCents(row);
  return {
    qty: row ? conv.qty(Number(row.qty)) : 0,
    amount: fromCents(amount),
    preTax: fromCents(amount - tax),
    tax: fromCents(tax),
    currency,
  };
}

async function loadKpis(pool: Pool, week: string, invoice: WeekInvoice, conv: QtyConverter): Promise<OverviewKpis> {
  const { currency } = invoice;
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
  const preTaxQty = dieselAgg.pre_tax_gallons === null ? 0 : Number(dieselAgg.pre_tax_gallons);
  const avgPreTaxStored = preTaxQty > 0 ? Number(dieselAgg.pre_tax_num) / preTaxQty : null;
  const discountTotal = [...totals.values()].reduce(
    (sum, row) => sum + (row.discount === null ? 0 : Number(row.discount)),
    0,
  );
  const scaleAmount = scale ? Number(scale.amount) : 0;
  const expressAmount = expressAgg.total === null ? 0 : Number(expressAgg.total);
  const expressFee = expressAgg.fee === null ? 0 : Number(expressAgg.fee);

  const withTax = toCents(invoice.grandTotal);
  const tax = [...totals.values()].reduce((sum, row) => sum + taxCents(row), 0);
  const sumTax = (column: "hst" | "gst" | "pst" | "qst"): number =>
    fromCents([...totals.values()].reduce((sum, row) => sum + toCents(row[column]), 0));

  return {
    week,
    invoiceId: invoice.id,
    total: { amount: fromCents(withTax), currency },
    tax: {
      beforeTax: fromCents(withTax - tax),
      tax: fromCents(tax),
      withTax: fromCents(withTax),
      hst: sumTax("hst"),
      gst: sumTax("gst"),
      pst: sumTax("pst"),
      qst: sumTax("qst"),
      currency,
    },
    diesel: productRollup(ta, currency, conv),
    def: productRollup(df, currency, conv),
    avgBilledPerUnit: convertNullable(conv.perUnit, avgBilledStored),
    avgBilledPreTaxPerUnit: convertNullable(conv.perUnit, avgPreTaxStored),
    discount: {
      total: Math.round(discountTotal * 100) / 100,
      avgPerUnit: convertNullable(conv.perUnit, taQty > 0 ? discountTotal / taQty : null),
      currency,
    },
    otherCharges: {
      total: Math.round((scaleAmount + expressAmount) * 100) / 100,
      scale: scaleAmount,
      express: expressAmount,
      expressFee,
      currency,
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
async function loadTrend(
  pool: Pool,
  week: string,
  currency: InvoiceCurrency,
  limit: number,
  conv: QtyConverter,
): Promise<OverviewTrendPoint[]> {
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
    [week, limit, currency],
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

async function loadSide(
  pool: Pool,
  week: string,
  currency: InvoiceCurrency,
  options: OverviewOptions,
): Promise<OverviewSide | null> {
  const invoice = await loadWeekInvoice(pool, week, currency);
  if (!invoice) {
    return null;
  }
  const conv = qtyConverter(invoice.qtyUnit, options.units ?? null);
  const [kpis, trend, topSpendByDriver, anomalyDigest] = await Promise.all([
    loadKpis(pool, week, invoice, conv),
    loadTrend(pool, week, currency, options.trendPeriods ?? TREND_PERIODS, conv),
    loadTopSpendByDriver(pool, invoice.id, options.topDriverLimit ?? TOP_DRIVER_LIMIT, conv),
    loadAnomalyDigest(pool, invoice.id, options.anomalyDigestLimit ?? ANOMALY_DIGEST_LIMIT),
  ]);
  return { currency, qtyUnit: conv.qtyUnit, kpis, trend, topSpendByDriver, anomalyDigest };
}

interface FxRow {
  fx_cad_per_usd: string | null;
  fx_entered_at: Date | null;
}

async function loadStoredFx(pool: Pool, invoiceId: string): Promise<StoredFx | null> {
  const { rows } = await pool.query<FxRow>("SELECT fx_cad_per_usd, fx_entered_at FROM invoices WHERE id = $1", [invoiceId]);
  const row = rows[0];
  return row?.fx_cad_per_usd && row.fx_entered_at ? { rate: row.fx_cad_per_usd, enteredAt: row.fx_entered_at } : null;
}

/**
 * The combined panel (T-65, D27, D28). Money is converted into `target` at the
 * CA invoice's entered rate and only then added, in integer cents.
 *
 * **The one rounding point** is each CA figure's conversion: its cents are
 * divided by the rate (a US figure multiplied, for CAD) exactly and rounded
 * once, half away from zero, to the cent — `moneyConverter`'s arithmetic, not
 * a float path. Everything after that is integer addition, so `withTax` is
 * exactly the US cents + round(CA ÷ rate). Only `withTax` and `tax` are
 * converted; `beforeTax` is their difference, so `beforeTax + tax = withTax`
 * still holds after conversion (converting all three apart could miss by a cent).
 *
 * No entered rate means every money figure is `null` with `ratePending`; a
 * side already in `target` needs none, so a US-only week reads in USD with no
 * rate at all.
 */
function combine(
  sides: OverviewSide[],
  target: InvoiceCurrency,
  fx: StoredFx | null,
  units: RequestedUnits,
  missingSide: InvoiceCurrency | null,
): OverviewCombined {
  const qtyUnit: InvoiceQtyUnit = units === "metric" ? "L" : "gal";
  // Converting a side needs a rate; so does reading a total in the currency
  // of a side the week does not have, where the rate would have been entered.
  const needsRate = sides.some((side) => side.currency !== target) || missingSide === target;
  const ratePending = needsRate && fx === null;

  /** A side's figure, in cents of `target`. */
  const convert = (side: OverviewSide, cents: number): number | null => {
    if (side.currency === target) return cents;
    const converted = moneyConverter(side.currency, target, fx, side.qtyUnit, units).money(fromCents(cents).toFixed(2));
    return converted === null ? null : toCents(converted);
  };
  const sum = (figure: (side: OverviewSide) => number): number | null => {
    if (ratePending) return null;
    let total = 0;
    for (const side of sides) {
      const converted = convert(side, figure(side));
      if (converted === null) return null;
      total += converted;
    }
    return total;
  };
  const split = (withTax: (side: OverviewSide) => number, tax: (side: OverviewSide) => number): CombinedSplit => {
    const w = sum(withTax);
    const t = sum(tax);
    return {
      beforeTax: w === null || t === null ? null : fromCents(w - t),
      tax: t === null ? null : fromCents(t),
      withTax: w === null ? null : fromCents(w),
    };
  };
  const product = (key: "diesel" | "def"): CombinedProduct => ({
    qty: sides.reduce((total, side) => total + qtyConverter(side.qtyUnit, units ?? "imperial").qty(side.kpis[key].qty), 0),
    ...split(
      (side) => toCents(side.kpis[key].amount),
      (side) => toCents(side.kpis[key].tax),
    ),
  });

  const diesel = product("diesel");
  const perUnit = (money: number | null): number | null =>
    money === null || diesel.qty <= 0 ? null : Math.round((money / diesel.qty) * 1e6) / 1e6;
  const discount = sum((side) => toCents(side.kpis.discount.total));

  return {
    currency: target,
    qtyUnit,
    partial: missingSide !== null,
    missingSide,
    ratePending,
    spend: split(
      (side) => toCents(side.kpis.tax.withTax),
      (side) => toCents(side.kpis.tax.tax),
    ),
    diesel,
    def: product("def"),
    discount: discount === null ? null : fromCents(discount),
    avgBilledPreTaxPerUnit: perUnit(diesel.beforeTax),
    avgBilledPerUnit: perUnit(diesel.withTax),
  };
}

/**
 * `GET /overview?week=` (A8.1, A13, T-65). `week` is a billing week's end (D26).
 * Returns `{ us, ca, combined, fx }`: each side is the per-invoice body in its
 * own currency and unit, or `null` when that side has no imported invoice in
 * the week — an absent side is not an error. `trend` is each side's own
 * trailing window of weeks that actually exist at or before `week`.
 */
export async function getOverview(pool: Pool, week: string, options: OverviewOptions = {}): Promise<OverviewResult> {
  const [us, ca] = await Promise.all([loadSide(pool, week, "USD", options), loadSide(pool, week, "CAD", options)]);
  const storedFx = ca ? await loadStoredFx(pool, ca.kpis.invoiceId) : null;

  const present = [us, ca].filter((side): side is OverviewSide => side !== null);
  const missingSide: InvoiceCurrency | null = present.length === 2 ? null : us === null ? "USD" : "CAD";
  const combined =
    present.length === 0 ? null : combine(present, options.convertTo ?? "USD", storedFx, options.units ?? null, missingSide);

  return {
    us,
    ca,
    combined,
    fx: storedFx ? { rate: Number(storedFx.rate), enteredAt: storedFx.enteredAt.toISOString() } : null,
  };
}
