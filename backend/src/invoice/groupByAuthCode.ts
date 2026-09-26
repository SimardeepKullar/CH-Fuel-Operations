import { fromCents, toCents } from "./decimal.js";
import type { ValidatedInvoiceLine } from "./parseInvoiceCsv.js";

export class FuelStopGroupingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FuelStopGroupingError";
  }
}

/** One fuel stop: every product line sharing a base auth code. */
export interface FuelStopGroup {
  baseAuthCode: string;
  cardNumber: string;
  unitRaw: string;
  driverNameRaw: string;
  stationNameRaw: string;
  stationCity: string;
  stationState: string;
  siteNumber: string;
  occurredAt: string;
  /** Sum of ALL line amounts in the group — never just the diesel line. This
   * is the whole reason this module exists: the legacy sheet recorded only
   * the diesel line per stop and silently dropped DEF (§A5). */
  totalUsd: string;
  /** Sum of gallons across all lines; a scale-only stop is legitimately
   * zero here despite a non-zero totalUsd. */
  totalGallons: string;
  lines: ValidatedInvoiceLine[];
}

function sumDecimal2dp(values: readonly string[]): string {
  const totalCents = values.reduce((sum, value) => sum + toCents(value), 0);
  return fromCents(totalCents);
}

/**
 * Groups product lines into fuel stops on the base auth code. A group whose
 * lines disagree on card/unit/driver/station/timestamp is a rejection, not a
 * silent pick — those fields describe one real-world event and must agree
 * within it.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function groupByAuthCode(lines: readonly ValidatedInvoiceLine[]): FuelStopGroup[] {
  const groups = new Map<string, ValidatedInvoiceLine[]>();
  for (const line of lines) {
    const existing = groups.get(line.baseAuthCode);
    if (existing) {
      existing.push(line);
    } else {
      groups.set(line.baseAuthCode, [line]);
    }
  }

  const result: FuelStopGroup[] = [];
  for (const [baseAuthCode, groupLines] of groups) {
    const first = groupLines[0]!;
    for (const line of groupLines) {
      if (
        line.cardNumber !== first.cardNumber ||
        line.unitRaw !== first.unitRaw ||
        line.driverNameRaw !== first.driverNameRaw ||
        line.stationNameRaw !== first.stationNameRaw ||
        line.occurredAt !== first.occurredAt
      ) {
        throw new FuelStopGroupingError(
          `auth code ${baseAuthCode}: lines disagree on card/unit/driver/station/timestamp`,
        );
      }
    }

    result.push({
      baseAuthCode,
      cardNumber: first.cardNumber,
      unitRaw: first.unitRaw,
      driverNameRaw: first.driverNameRaw,
      stationNameRaw: first.stationNameRaw,
      stationCity: first.stationCity,
      stationState: first.stationState,
      siteNumber: first.siteNumber,
      occurredAt: first.occurredAt,
      totalUsd: sumDecimal2dp(groupLines.map((l) => l.amountUsd)),
      totalGallons: sumDecimal2dp(groupLines.map((l) => l.gallons)),
      lines: groupLines,
    });
  }
  return result;
}
