import type { AnomalyFinding, AnomalySeverity } from "../types.js";

export interface PriceAbovePublishedConfig {
  /** Decimal string, e.g. "0.10" — billed price above published by more
   * than this, per gallon, is flagged. */
  maxOverageUsdPerGal: string;
  fuelProductCode: string;
}

export interface PriceAbovePublishedStop {
  id: string;
  /** `null` when the station itself didn't resolve (T-29) — never
   * comparable to a published price for a site the app doesn't have. */
  stationId: string | null;
  /** ISO date, "2026-09-04". */
  occurredOn: string;
  /** The stop's diesel line billed price, or `null` when it has none — a
   * scale-only stop has no price to audit and is simply not this rule's
   * business, unlike a genuine "no data for this station+date" gap. */
  billedUsdPerGal: string | null;
}

/**
 * Looks up BVD's published price for a station on a date. Keyed
 * `${stationId}|${occurredOn}` — built by the caller from `station_prices`
 * (v1's own price table, §12; reused rather than reinvented), never
 * queried by this pure function itself.
 */
export type PublishedPriceLookup = ReadonlyMap<string, string>;

export function publishedPriceKey(stationId: string, occurredOn: string): string {
  return `${stationId}|${occurredOn}`;
}

/**
 * `flagged` carries the same two-valued `AnomalySeverity` every other rule
 * uses. `not_computable` is its own outcome — §A18 Q5: when there is no
 * published-price row for a station+date (the known January 11 gap is the
 * real case) or the station itself never resolved, this rule reports that
 * it could not check, and a caller that only looks for `flagged` entries
 * must not read the gap as "no anomaly" (CLAUDE.md: never silently no).
 */
export type PriceAuditResult =
  | { status: "flagged"; subjectId: string; severity: AnomalySeverity; detail: Record<string, unknown> }
  | { status: "not_computable"; subjectId: string; reason: string };

export function toAnomalyFinding(result: PriceAuditResult): AnomalyFinding | null {
  if (result.status !== "flagged") {
    return null;
  }
  return {
    subjectType: "fuel_stop",
    subjectId: result.subjectId,
    severity: result.severity,
    detail: result.detail,
  };
}

/**
 * Audits each stop's billed diesel price against BVD's published price for
 * that station and date. A stop with no diesel line is skipped outright —
 * it has nothing for this rule to audit, distinct from a stop this rule
 * tried and couldn't check.
 *
 * Pure — no database, no HTTP, no clock; the published-price data this rule
 * needs is passed in, never queried here.
 */
export function priceAbovePublished(
  stops: readonly PriceAbovePublishedStop[],
  publishedPrices: PublishedPriceLookup,
  config: PriceAbovePublishedConfig,
): PriceAuditResult[] {
  const maxOverage = Number(config.maxOverageUsdPerGal);
  const results: PriceAuditResult[] = [];

  for (const stop of stops) {
    if (stop.billedUsdPerGal === null) {
      continue;
    }
    if (stop.stationId === null) {
      results.push({ status: "not_computable", subjectId: stop.id, reason: "station did not resolve" });
      continue;
    }
    const published = publishedPrices.get(publishedPriceKey(stop.stationId, stop.occurredOn));
    if (published === undefined) {
      results.push({
        status: "not_computable",
        subjectId: stop.id,
        reason: `no published price for this station on ${stop.occurredOn}`,
      });
      continue;
    }

    const overage = Number(stop.billedUsdPerGal) - Number(published);
    if (overage > maxOverage) {
      results.push({
        status: "flagged",
        subjectId: stop.id,
        severity: "red",
        detail: {
          billedUsdPerGal: stop.billedUsdPerGal,
          publishedUsdPerGal: published,
          overage,
          maxOverageUsdPerGal: config.maxOverageUsdPerGal,
        },
      });
    }
  }

  return results;
}
