import type { Pool } from "pg";
import { loadPriceAbovePublishedConfig, loadPublishedPrices } from "../anomaly/runAnomalies.js";
import { priceAbovePublished, publishedPriceKey } from "../anomaly/rules/priceAbovePublished.js";
import type { AnomalySeverity } from "../anomaly/types.js";
import type { InvoiceCurrency, InvoiceQtyUnit } from "../db/types.js";
import { isUuid } from "./ids.js";
import { convertNullable, qtyConverter, qtyUnitFor, type RequestedUnits } from "./units.js";

export interface StationBilledPriceDay {
  /** `YYYY-MM-DD`, the UTC calendar date of the stops — the same day the
   * price-audit rule keys on. */
  date: string;
  stopCount: number;
  /** Distinct fuel cards that bought diesel here that day. */
  cardCount: number;
  /** Diesel quantity across the day's stops, in the result's `qtyUnit`. */
  qty: number;
  /** Every distinct billed price per unit that day, ascending. One entry across
   * five cards is A6.5's finding (a price set per site per day); more than one
   * is a day the price moved or a card was billed differently. */
  distinctBilledPrices: number[];
  /** Quantity-weighted, never a mean of prices; `null` if the day had no quantity. */
  avgBilledPerUnit: number | null;
  /** BVD's published `your_price` for this station and day, per unit, or `null`
   * when there is no published-price row (A18 Q5) — always `null` on a CA
   * station, which has no published price at all. */
  publishedPerUnit: number | null;
  /** Highest billed price that day minus the published price, signed, per
   * unit. `null` — never `0` — when `publishedPerUnit` is `null`. */
  discrepancy: number | null;
  /** `red` ("billing error") when a stop that day was billed above the published
   * price by more than `anomaly_thresholds.price_above_published.maxOverageUsdPerGal`;
   * otherwise `null`. It is the audit rule's own verdict, not a second threshold. */
  severity: AnomalySeverity | null;
}

export interface StationBilledPrices {
  /** The side of the series: the station's own country's currency, unless `?currency=` asked for the other. */
  currency: InvoiceCurrency;
  /** The unit every `qty` and per-unit price below is in — the invoice's own, unless `?units=` said otherwise. */
  qtyUnit: InvoiceQtyUnit;
  station: { id: string; siteRef: string; nameRaw: string; cityRaw: string; stateUsps: string };
  /** Oldest first, one row per day that had a diesel line at this station. */
  days: StationBilledPriceDay[];
}

interface StationRow {
  id: string;
  site_ref: string;
  name_raw: string;
  city_raw: string;
  state_usps: string;
  country: string;
}

interface DayRow {
  day: string;
  stop_count: string;
  card_count: string;
  gallons: string;
  weighted_num: string;
  prices: string[];
}

/** Prices are numeric(9,4); this only strips float noise from a subtraction. */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * `GET /stations/{id}/billed-prices` (A8.9, A6.5). `null` when the id doesn't
 * name a station — the route maps that to a 404. `id` is `stations.id`, not
 * BVD's `site_ref`.
 *
 * Not scoped to a week: a price history is the series across every imported
 * invoice, one row per day. One currency, though — a series across litres and
 * gallons, or CAD and USD, is not a series — so it is the station's own side
 * (a US station is USD per gallon, a CA station CAD per litre) unless
 * `options.currency` says otherwise. The published-price lookup is `runAnomalies`'s own
 * (`loadPublishedPrices`) and the severity is `priceAbovePublished`'s own
 * verdict, so this view and the anomaly engine can't disagree about what a
 * billing error is.
 */
export async function getStationBilledPrices(
  pool: Pool,
  id: string,
  options: { currency?: InvoiceCurrency; units?: RequestedUnits } = {},
): Promise<StationBilledPrices | null> {
  if (!isUuid(id)) {
    return null;
  }
  const { rows: stationRows } = await pool.query<StationRow>(
    "SELECT id, site_ref, name_raw, city_raw, state_usps, country FROM stations WHERE id = $1",
    [id],
  );
  const station = stationRows[0];
  if (!station) {
    return null;
  }

  const currency = options.currency ?? (station.country === "CA" ? "CAD" : "USD");
  const conv = qtyConverter(qtyUnitFor(currency), options.units ?? null);
  const config = await loadPriceAbovePublishedConfig(pool);
  const [{ rows }, published] = await Promise.all([
    pool.query<DayRow>(
      `SELECT to_char((fs.occurred_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
              count(DISTINCT fs.id) AS stop_count,
              count(DISTINCT fs.card_id) AS card_count,
              SUM(fsl.qty) AS gallons,
              SUM(fsl.qty * fsl.billed_per_unit) AS weighted_num,
              array_agg(DISTINCT fsl.billed_per_unit ORDER BY fsl.billed_per_unit) AS prices
       FROM fuel_stops fs
       JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id AND fsl.product_code = $2
       JOIN invoices i ON i.id = fs.invoice_id AND i.currency = $3
       WHERE fs.station_id = $1
       GROUP BY day
       ORDER BY day ASC`,
      [id, config.fuelProductCode, currency],
    ),
    loadPublishedPrices(pool, [id], config.fuelProductCode),
  ]);

  const days = rows.map((row): StationBilledPriceDay => {
    const distinctBilledPrices = row.prices.map(Number);
    const qty = Number(row.gallons);
    // Published prices are USD per gallon and only exist for US stations; a CA
    // day has nothing to compare against (A18 Q5), never a `0`.
    const publishedRaw = currency === "USD" ? published.get(publishedPriceKey(id, row.day)) : undefined;
    const publishedStored = publishedRaw === undefined ? null : Number(publishedRaw);
    const highest = distinctBilledPrices[distinctBilledPrices.length - 1]!;

    // One audit "stop" per distinct price: the rule flags a price, so the day is
    // a billing error if any price it was billed at crosses the threshold.
    const verdicts = priceAbovePublished(
      row.prices.map((price) => ({ id: price, stationId: id, occurredOn: row.day, billedUsdPerGal: price, currency })),
      published,
      config,
    );

    return {
      date: row.day,
      stopCount: Number(row.stop_count),
      cardCount: Number(row.card_count),
      qty: Math.round(conv.qty(qty) * 100) / 100,
      distinctBilledPrices: distinctBilledPrices.map(conv.perUnit),
      avgBilledPerUnit: convertNullable(conv.perUnit, qty > 0 ? Number(row.weighted_num) / qty : null),
      publishedPerUnit: convertNullable(conv.perUnit, publishedStored),
      discrepancy: publishedStored === null ? null : round4(conv.perUnit(highest - publishedStored)),
      severity: verdicts.some((v) => v.status === "flagged") ? "red" : null,
    };
  });

  return {
    currency,
    qtyUnit: conv.qtyUnit,
    station: {
      id: station.id,
      siteRef: station.site_ref,
      nameRaw: station.name_raw,
      cityRaw: station.city_raw,
      stateUsps: station.state_usps,
    },
    days,
  };
}
