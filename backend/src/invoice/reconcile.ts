import { fromCents, toCents, toTenThousandths } from "./decimal.js";
import type { FuelStopGroup } from "./groupByAuthCode.js";
import type { ExpressRow } from "./parseExpressRows.js";
import type { PrintedProductTotal, PrintedTotals, ValidatedInvoiceLine } from "./parseInvoiceCsv.js";

/** The printed row a raw product code reconciles against. Cash lines (`C`)
 * settle against BVD's "Manual Transactions" line, not a `C`-labelled row —
 * no invoice seen so far prints one. */
const PRINTED_ROW_LABEL: Record<string, string> = {
  C: "Manual Transactions",
};

/** The synthetic "product code" express rows reconcile against — not a raw
 * code, since express rows have no product code of their own. */
const EXPRESS_PRINTED_LABEL = "Express Codes";

export interface CentsDelta {
  productCode: string;
  expectedCents: number;
  parsedCents: number;
  /** parsed - expected. */
  deltaCents: number;
  contributingLineNumbers: number[];
}

/** A line's own figures disagreeing with each other (T-61). */
export type LineCheck =
  /** Pre Tax AMT + HST + GST + PST + QST ≠ Final AMT — exact. */
  | "TAX_SUM"
  /** Retail − Billed ≠ Disc Rate — exact. */
  | "DISC_RATE"
  /** QTY × Billed outside the rounding bound of Final AMT. */
  | "QTY_X_BILLED"
  /** QTY × Disc Rate outside the rounding bound of Disc AMT. */
  | "QTY_X_DISC_RATE";

export interface LineImbalance {
  lineNumber: number;
  authCode: string;
  check: LineCheck;
  message: string;
}

/** A printed totals row disagreeing with itself or with the rows it sums. */
export interface TotalsImbalance {
  productCode: string;
  /** `TAX_SUM`: the row's Pre Tax + taxes ≠ its Final. `GRAND_PRE_TAX` /
   * `GRAND_TAX`: the grand-total row's column ≠ the sum of the product rows'. */
  check: "TAX_SUM" | "GRAND_PRE_TAX" | "GRAND_TAX";
  expectedCents: number;
  printedCents: number;
}

export interface ReconcileResult {
  balanced: boolean;
  /** One entry per product code whose summed dollar amount doesn't match
   * its printed total — independent of `gallonImbalances`, so neither kind
   * can mask the other. */
  amountImbalances: CentsDelta[];
  /** One entry per product code whose summed gallons don't match its
   * printed total. Codes with no printed gallons figure (S, cash, express)
   * are never checked here — there is nothing to compare against. */
  gallonImbalances: CentsDelta[];
  grandTotal: { expectedCents: number; parsedCents: number; deltaCents: number };
  /** Lines whose own columns disagree (T-61). Every line is checked, US or CA. */
  lineImbalances: LineImbalance[];
  /** Printed totals rows whose columns disagree (T-61). */
  totalsImbalances: TotalsImbalance[];
}

/**
 * Whether `qty × price` reproduces `printedCents` within the rounding of the
 * printed figures (T-61). BVD prints QTY at 2dp and prices at 4dp but
 * computes the amount from unrounded figures, so the printed product misses
 * the printed amount by a cent or more on most real lines — always within ½¢
 * plus half a printed unit of each factor: 0.005 × price + 0.00005 × qty.
 *
 * `qtyHundredths × priceT4` is in micro-units (10^-6 of a currency unit),
 * where the bound is 5,000 + ½ priceT4 + ½ qtyHundredths; compared doubled,
 * so every step is integer. Not a tolerance: a value outside it cannot have
 * come from these printed figures, which is what catches a mis-columned row.
 */
export function withinRoundingBound(qtyHundredths: number, priceT4: number, printedCents: number): boolean {
  const deviation = Math.abs(qtyHundredths * priceT4 - printedCents * 10_000);
  return 2 * deviation <= 10_000 + Math.abs(priceT4) + Math.abs(qtyHundredths);
}

function taxSumCents(row: Pick<ValidatedInvoiceLine, "hst" | "gst" | "pst" | "qst">): number {
  return toCents(row.hst) + toCents(row.gst) + toCents(row.pst) + toCents(row.qst);
}

/** Every line, every invoice: the tax identity and Retail − Billed = Disc
 * Rate exactly; QTY × Billed and QTY × Disc Rate within the rounding bound.
 * A zero-QTY line (Scale) is a flat fee with no per-unit price, so only the
 * exact checks apply to it. */
function checkLines(lines: readonly ValidatedInvoiceLine[]): LineImbalance[] {
  const out: LineImbalance[] = [];
  for (const line of lines) {
    const at = { lineNumber: line.lineNumber, authCode: line.authCode };
    const amount = toCents(line.amount);
    const taxed = toCents(line.preTaxAmount) + taxSumCents(line);
    if (taxed !== amount) {
      out.push({ ...at, check: "TAX_SUM", message: `Pre Tax AMT + taxes = ${fromCents(taxed)}, Final AMT ${line.amount}` });
    }
    const retail = toTenThousandths(line.retailPerUnit);
    const billed = toTenThousandths(line.billedPerUnit);
    const discRate = toTenThousandths(line.discRate);
    if (retail - billed !== discRate) {
      out.push({ ...at, check: "DISC_RATE", message: `Retail ${line.retailPerUnit} − Billed ${line.billedPerUnit} ≠ Disc Rate ${line.discRate}` });
    }
    const qty = toCents(line.qty);
    if (qty === 0) {
      continue;
    }
    if (!withinRoundingBound(qty, billed, amount)) {
      out.push({ ...at, check: "QTY_X_BILLED", message: `QTY ${line.qty} × Billed ${line.billedPerUnit} cannot print as Final AMT ${line.amount}` });
    }
    if (!withinRoundingBound(qty, discRate, toCents(line.discount))) {
      out.push({ ...at, check: "QTY_X_DISC_RATE", message: `QTY ${line.qty} × Disc Rate ${line.discRate} cannot print as Disc AMT ${line.discount}` });
    }
  }
  return out;
}

/** Each printed row's own tax identity, where it prints a Pre Tax column;
 * and the grand-total row's Pre Tax and tax columns as the sums of the
 * product rows'. Scale, Manual and Express print a final amount only, so
 * they contribute nothing to those sums — their tax sits inside the grand
 * Final AMT, which the existing grand-total check covers (T-61, measured
 * on 999217: 41,356.89 + 5,376.44 + Scale 104.00 = 46,837.33). */
function checkPrintedTotals(printed: PrintedTotals): TotalsImbalance[] {
  const out: TotalsImbalance[] = [];
  for (const row of printed.products) {
    if (row.preTaxAmount === null) continue;
    const taxed = toCents(row.preTaxAmount) + taxSumCents(row);
    if (taxed !== toCents(row.amount)) {
      out.push({ productCode: row.productCode, check: "TAX_SUM", expectedCents: toCents(row.amount), printedCents: taxed });
    }
  }
  const grand = printed.grandTotalRow;
  if (grand.preTaxAmount !== null) {
    const preTaxSum = printed.products.reduce((sum, r) => sum + (r.preTaxAmount === null ? 0 : toCents(r.preTaxAmount)), 0);
    if (preTaxSum !== toCents(grand.preTaxAmount)) {
      out.push({ productCode: grand.productCode, check: "GRAND_PRE_TAX", expectedCents: preTaxSum, printedCents: toCents(grand.preTaxAmount) });
    }
  }
  for (const tax of ["hst", "gst", "pst", "qst"] as const satisfies ReadonlyArray<keyof PrintedProductTotal>) {
    const sum = printed.products.reduce((s, r) => s + toCents(r[tax]), 0);
    if (sum !== toCents(grand[tax])) {
      out.push({ productCode: `${grand.productCode} ${tax.toUpperCase()}`, check: "GRAND_TAX", expectedCents: sum, printedCents: toCents(grand[tax]) });
    }
  }
  return out;
}

function printedAmountCents(printedTotals: PrintedTotals, label: string): number {
  const row = printedTotals.products.find((p) => p.productCode === label);
  return row ? toCents(row.amount) : 0;
}

function printedGallonsCents(printedTotals: PrintedTotals, label: string): number | null {
  const row = printedTotals.products.find((p) => p.productCode === label);
  if (!row || row.qty === null) {
    return null;
  }
  return toCents(row.qty);
}

/**
 * Compares parsed rows against the invoice's own printed totals, per
 * product code, never in total — a missing $36.78 of DEF and a $36.78
 * over-count of diesel sum to zero, so a single grand-total check would
 * rubber-stamp the legacy sheet's exact failure mode. Trusts the printed
 * totals as given; never recomputes them, only checks against them.
 *
 * All comparisons are in integer cents — no floating-point arithmetic
 * anywhere in this module.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function reconcile(
  groups: readonly FuelStopGroup[],
  expressRows: readonly ExpressRow[],
  printedTotals: PrintedTotals,
): ReconcileResult {
  const lines = groups.flatMap((g) => g.lines);

  const codeToLines = new Map<string, typeof lines>();
  for (const line of lines) {
    const existing = codeToLines.get(line.rawProductCode);
    if (existing) {
      existing.push(line);
    } else {
      codeToLines.set(line.rawProductCode, [line]);
    }
  }

  const amountImbalances: CentsDelta[] = [];
  const gallonImbalances: CentsDelta[] = [];

  for (const [code, codeLines] of codeToLines) {
    const label = PRINTED_ROW_LABEL[code] ?? code;
    const lineNumbers = codeLines.map((l) => l.lineNumber);

    const parsedAmountCents = codeLines.reduce((sum, l) => sum + toCents(l.amount), 0);
    const expectedAmountCents = printedAmountCents(printedTotals, label);
    if (parsedAmountCents !== expectedAmountCents) {
      amountImbalances.push({
        productCode: code,
        expectedCents: expectedAmountCents,
        parsedCents: parsedAmountCents,
        deltaCents: parsedAmountCents - expectedAmountCents,
        contributingLineNumbers: lineNumbers,
      });
    }

    const expectedGallonsCents = printedGallonsCents(printedTotals, label);
    if (expectedGallonsCents !== null) {
      const parsedGallonsCents = codeLines.reduce((sum, l) => sum + toCents(l.qty), 0);
      if (parsedGallonsCents !== expectedGallonsCents) {
        gallonImbalances.push({
          productCode: code,
          expectedCents: expectedGallonsCents,
          parsedCents: parsedGallonsCents,
          deltaCents: parsedGallonsCents - expectedGallonsCents,
          contributingLineNumbers: lineNumbers,
        });
      }
    }
  }

  const parsedExpressCents = expressRows.reduce((sum, r) => sum + toCents(r.total), 0);
  const expectedExpressCents = printedAmountCents(printedTotals, EXPRESS_PRINTED_LABEL);
  if (parsedExpressCents !== expectedExpressCents) {
    amountImbalances.push({
      productCode: EXPRESS_PRINTED_LABEL,
      expectedCents: expectedExpressCents,
      parsedCents: parsedExpressCents,
      deltaCents: parsedExpressCents - expectedExpressCents,
      contributingLineNumbers: expressRows.map((r) => r.lineNumber),
    });
  }

  const parsedGrandTotalCents =
    lines.reduce((sum, l) => sum + toCents(l.amount), 0) + parsedExpressCents;
  const expectedGrandTotalCents = toCents(printedTotals.grandTotal);
  const grandTotal = {
    expectedCents: expectedGrandTotalCents,
    parsedCents: parsedGrandTotalCents,
    deltaCents: parsedGrandTotalCents - expectedGrandTotalCents,
  };

  const lineImbalances = checkLines(lines);
  const totalsImbalances = checkPrintedTotals(printedTotals);

  return {
    balanced:
      amountImbalances.length === 0 &&
      gallonImbalances.length === 0 &&
      grandTotal.deltaCents === 0 &&
      lineImbalances.length === 0 &&
      totalsImbalances.length === 0,
    amountImbalances,
    gallonImbalances,
    grandTotal,
    lineImbalances,
    totalsImbalances,
  };
}

/** Convenience for reporting — a `CentsDelta`'s cents fields as dollar strings. */
export function centsDeltaToDisplay(delta: CentsDelta): {
  productCode: string;
  expected: string;
  parsed: string;
  delta: string;
  contributingLineNumbers: number[];
} {
  return {
    productCode: delta.productCode,
    expected: fromCents(delta.expectedCents),
    parsed: fromCents(delta.parsedCents),
    delta: fromCents(delta.deltaCents),
    contributingLineNumbers: delta.contributingLineNumbers,
  };
}
