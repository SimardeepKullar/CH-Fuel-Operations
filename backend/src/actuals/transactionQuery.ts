import type { ReceiptStatus } from "../db/types.js";

/**
 * A8.3's filters. Every field is optional and they compose with `AND` —
 * `buildTransactionFilterClause` never has to know which combination a
 * caller sent.
 */
export interface TransactionFilters {
  /** Inclusive lower bound on `fuel_stops.occurred_at`. */
  dateFrom?: Date;
  /** Inclusive upper bound on `fuel_stops.occurred_at`. */
  dateTo?: Date;
  /**
   * `fuel_stops.invoice_id` — how the shell's period selector (A7) scopes
   * this screen, the same `invoice_id` join every sibling actuals query
   * (`overview.ts`, `drivers.ts`, `otherCharges.ts`) filters on, rather than
   * reconstructing the period as a `dateFrom`/`dateTo` pair client-side.
   * Resolved from `?period=` at the route boundary (T-40); `null` means the
   * period matched no invoice, which must return zero rows rather than the
   * unfiltered set — `fs.invoice_id = ?` with a `null` param does exactly
   * that (`x = NULL` is never true), so no special-casing is needed here.
   */
  invoiceId?: string | null;
  driverId?: string;
  truckId?: string;
  cardId?: string;
  /** `stations.state_usps`. */
  state?: string;
  /** A raw BVD product code (`TA`, `DF`, `S`, ...) — matches any line on the stop. */
  product?: string;
  receiptStatus?: ReceiptStatus;
  /** Only stops carrying at least one undismissed anomaly. */
  anomalyOnly?: boolean;
}

export interface TransactionFilterClause {
  /** `""` when no filter applies — never a bare `"WHERE"` with nothing after it. */
  whereSql: string;
  /** Parameters in the same order the clause's `$n` placeholders reference. */
  params: unknown[];
}

/**
 * Builds a parameterised WHERE clause from A8.3's filters (D1: no value is
 * ever interpolated into SQL text — every value lands in `params`, referenced
 * back by a `$n` placeholder). Every filter is optional and they compose with
 * `AND`.
 *
 * `anomalyOnly` is an `EXISTS` against `anomalies`, not a post-filter over a
 * fetched page — filtering in memory after paging would silently return a
 * short page instead of a full one (Step 32.1's own DoD). `state` and
 * `product` are also `EXISTS` rather than a join, so the same clause can be
 * reused verbatim for a `COUNT(*)` query without dragging `stations` /
 * `fuel_stop_lines` into that query's join graph.
 *
 * Pure — no database, no HTTP, no clock.
 */
export function buildTransactionFilterClause(
  filters: TransactionFilters,
): TransactionFilterClause {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const add = (sqlWithPlaceholder: string, value: unknown): void => {
    params.push(value);
    conditions.push(sqlWithPlaceholder.replace("?", `$${params.length}`));
  };

  if (filters.dateFrom !== undefined) {
    add("fs.occurred_at >= ?", filters.dateFrom);
  }
  if (filters.dateTo !== undefined) {
    add("fs.occurred_at <= ?", filters.dateTo);
  }
  if (filters.invoiceId !== undefined) {
    add("fs.invoice_id = ?", filters.invoiceId);
  }
  if (filters.driverId !== undefined) {
    add("fs.driver_id = ?", filters.driverId);
  }
  if (filters.truckId !== undefined) {
    add("fs.truck_id = ?", filters.truckId);
  }
  if (filters.cardId !== undefined) {
    add("fs.card_id = ?", filters.cardId);
  }
  if (filters.state !== undefined) {
    add(
      "EXISTS (SELECT 1 FROM stations s WHERE s.id = fs.station_id AND s.state_usps = ?)",
      filters.state,
    );
  }
  if (filters.product !== undefined) {
    add(
      "EXISTS (SELECT 1 FROM fuel_stop_lines fsl WHERE fsl.fuel_stop_id = fs.id AND fsl.product_code = ?)",
      filters.product,
    );
  }
  if (filters.receiptStatus !== undefined) {
    add("fs.receipt_status = ?", filters.receiptStatus);
  }
  if (filters.anomalyOnly) {
    conditions.push(
      "EXISTS (SELECT 1 FROM anomalies a WHERE a.subject_type = 'fuel_stop' AND a.subject_id = fs.id AND a.dismissed_at IS NULL)",
    );
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}
