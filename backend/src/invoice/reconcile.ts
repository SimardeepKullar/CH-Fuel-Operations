import { fromCents, toCents } from "./decimal.js";
import type { FuelStopGroup } from "./groupByAuthCode.js";
import type { ExpressRow } from "./parseExpressRows.js";
import type { PrintedTotals } from "./parseInvoiceCsv.js";

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
}

function printedAmountCents(printedTotals: PrintedTotals, label: string): number {
  const row = printedTotals.products.find((p) => p.productCode === label);
  return row ? toCents(row.amountUsd) : 0;
}

function printedGallonsCents(printedTotals: PrintedTotals, label: string): number | null {
  const row = printedTotals.products.find((p) => p.productCode === label);
  if (!row || row.gallons === null) {
    return null;
  }
  return toCents(row.gallons);
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

    const parsedAmountCents = codeLines.reduce((sum, l) => sum + toCents(l.amountUsd), 0);
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
      const parsedGallonsCents = codeLines.reduce((sum, l) => sum + toCents(l.gallons), 0);
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

  const parsedExpressCents = expressRows.reduce((sum, r) => sum + toCents(r.totalUsd), 0);
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
    lines.reduce((sum, l) => sum + toCents(l.amountUsd), 0) + parsedExpressCents;
  const expectedGrandTotalCents = toCents(printedTotals.grandTotalUsd);
  const grandTotal = {
    expectedCents: expectedGrandTotalCents,
    parsedCents: parsedGrandTotalCents,
    deltaCents: parsedGrandTotalCents - expectedGrandTotalCents,
  };

  return {
    balanced:
      amountImbalances.length === 0 && gallonImbalances.length === 0 && grandTotal.deltaCents === 0,
    amountImbalances,
    gallonImbalances,
    grandTotal,
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
