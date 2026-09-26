import type { InvoiceLineRejectionCode } from "./parseInvoiceCsv.js";
import type { CentsDelta, ReconcileResult } from "./reconcile.js";
import type { FuelStopGroup } from "./groupByAuthCode.js";
import type { ExpressRow } from "./parseExpressRows.js";

export type ImportRejectionCode =
  | InvoiceLineRejectionCode
  | "AMOUNT_IMBALANCE"
  | "GALLONS_IMBALANCE"
  | "GRAND_TOTAL_IMBALANCE"
  | "UNKNOWN_CARD"
  | "UNKNOWN_TRUCK_UNIT";

export interface NormalizedRejection {
  lineNumber: number;
  authCode: string | null;
  code: ImportRejectionCode;
  message: string;
}

export interface ImportReport {
  invoiceNumber: string;
  fileSha256: string;
  /** ISO date, straight off the invoice's own header (`InvoiceHeader`) — the
   * gap report's covered set unions these, never the imported_at clock. */
  periodStart: string;
  periodEnd: string;
  grandTotalUsd: string;
  reconcile: ReconcileResult;
  parserRejectionCount: number;
  unknownCardNumbers: string[];
  unknownTruckUnits: string[];
  /** Every reason this invoice would quarantine, ready to insert into
   * `invoice_rejections` — parser rejections, reconcile imbalances, and
   * card/truck lookup misses, all in one shape. Empty iff the invoice
   * balances and every lookup resolved. */
  rejections: NormalizedRejection[];
  /** Station text (e.g. "SAMPLE #1") that didn't resolve to a `stations`
   * row by store number (T-29). Named, not silently dropped — but never a
   * rejection: an unresolved station leaves `fuel_stops.station_id` null
   * and still promotes (CLAUDE.md: never guessed, never quarantined for it). */
  stationMisses: string[];
  /** Card numbers resolved to a driver with no `truck_assignments` row
   * covering the stop's timestamp (T-29) — `fuel_stops.truck_id` is left
   * null rather than guessed. Also never a rejection. */
  truckAssignmentMisses: string[];
  /** Express codes of rows with no tractor/unit text at all (D20) —
   * `express_charges.truck_id` is left null rather than guessed. Never a
   * rejection, distinct from `unknownTruckUnits` (a present unit number
   * this fleet doesn't recognise, which does quarantine). */
  expressBlankUnits: string[];
}

export interface BuildImportReportInput {
  invoiceNumber: string;
  fileSha256: string;
  periodStart: string;
  periodEnd: string;
  grandTotalUsd: string;
  parserRejections: ReadonlyArray<{
    lineNumber: number;
    authCode: string | null;
    code: InvoiceLineRejectionCode;
    message: string;
  }>;
  reconcileResult: ReconcileResult;
  cardMisses: readonly FuelStopGroup[];
  truckUnitMisses: readonly ExpressRow[];
  stationMisses?: readonly string[];
  truckAssignmentMisses?: readonly string[];
  expressBlankUnits?: readonly string[];
}

function imbalanceRejections(
  imbalances: readonly CentsDelta[],
  code: "AMOUNT_IMBALANCE" | "GALLONS_IMBALANCE",
): NormalizedRejection[] {
  return imbalances.map((i) => ({
    lineNumber: i.contributingLineNumbers[0] ?? 0,
    authCode: null,
    code,
    message:
      `${i.productCode}: expected ${i.expectedCents} cents, parsed ${i.parsedCents} cents ` +
      `(delta ${i.deltaCents})`,
  }));
}

/**
 * Shapes everything `importInvoice` gathered into one report: the parser's
 * own rejections, this ticket's reconcile imbalances, and its card/truck
 * lookup misses — one list, ready to insert into `invoice_rejections`
 * verbatim on quarantine. Empty `rejections` is the promote signal.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function buildImportReport(input: BuildImportReportInput): ImportReport {
  const { reconcileResult, cardMisses, truckUnitMisses } = input;

  const rejections: NormalizedRejection[] = [
    ...input.parserRejections,
    ...imbalanceRejections(reconcileResult.amountImbalances, "AMOUNT_IMBALANCE"),
    ...imbalanceRejections(reconcileResult.gallonImbalances, "GALLONS_IMBALANCE"),
    ...cardMisses.map((g) => ({
      lineNumber: g.lines[0]?.lineNumber ?? 0,
      authCode: g.baseAuthCode,
      code: "UNKNOWN_CARD" as const,
      message: `unknown card number: "${g.cardNumber}"`,
    })),
    // A blank unit never reaches here — resolveTruckUnitMisses (importInvoice.ts)
    // filters those out before this list is built (D20).
    ...truckUnitMisses.map(
      (r): NormalizedRejection => ({
        lineNumber: r.lineNumber,
        authCode: r.expressCode,
        code: "UNKNOWN_TRUCK_UNIT",
        message: `unknown truck unit number: "${r.unitRaw}"`,
      }),
    ),
  ];

  if (reconcileResult.grandTotal.deltaCents !== 0) {
    rejections.push({
      lineNumber: 0,
      authCode: null,
      code: "GRAND_TOTAL_IMBALANCE",
      message:
        `grand total: expected ${reconcileResult.grandTotal.expectedCents} cents, parsed ` +
        `${reconcileResult.grandTotal.parsedCents} cents (delta ${reconcileResult.grandTotal.deltaCents})`,
    });
  }

  return {
    invoiceNumber: input.invoiceNumber,
    fileSha256: input.fileSha256,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    grandTotalUsd: input.grandTotalUsd,
    reconcile: reconcileResult,
    parserRejectionCount: input.parserRejections.length,
    unknownCardNumbers: cardMisses.map((g) => g.cardNumber),
    unknownTruckUnits: truckUnitMisses.map((r) => r.unitRaw!),
    rejections,
    stationMisses: [...(input.stationMisses ?? [])],
    truckAssignmentMisses: [...(input.truckAssignmentMisses ?? [])],
    expressBlankUnits: [...(input.expressBlankUnits ?? [])],
  };
}
