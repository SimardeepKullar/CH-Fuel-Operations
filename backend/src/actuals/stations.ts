import type { Pool } from "pg";
import { loadPriceAbovePublishedConfig, loadPublishedPrices } from "../anomaly/runAnomalies.js";
import { priceAbovePublished, publishedPriceKey } from "../anomaly/rules/priceAbovePublished.js";
import type { AnomalySeverity } from "../anomaly/types.js";
import { isUuid } from "./ids.js";

export interface StationBilledPriceDay {
  /** `YYYY-MM-DD`, the UTC calendar date of the stops — the same day the
   * price-audit rule keys on. */
  date: string;
  stopCount: number;
  /** Distinct fuel cards that bought diesel here that day. */
  cardCount: number;
  /** Diesel gallons across the day's stops. */
  gallons: number;
  /** Every distinct billed $/gal that day, ascending. One entry across five
   * cards is A6.5's finding (a price set per site per day); more than one is
   * a day the price moved or a card was billed differently. */
  distinctBilledPrices: number[];
  /** Gallons-weighted, never a mean of prices; `null` if the day had no gallons. */
  avgBilledUsdPerGal: number | null;
  /** BVD's published `your_price` for this station and day, or `null` when
   * there is no published-price row (A18 Q5). */
  publishedUsdPerGal: number | null;
  /** Highest billed price that day minus the published price, signed, per
   * gallon. `null` — never `0` — when `publishedUsdPerGal` is `null`. */
  discrepancy: number | null;
  /** `red` ("billing error") when a stop that day was billed above the published
   * price by more than `anomaly_thresholds.price_above_published.maxOverageUsdPerGal`;
   * otherwise `null`. It is the audit rule's own verdict, not a second threshold. */
  severity: AnomalySeverity | null;
}

export interface StationBilledPrices {
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
 * Not scoped to a period: a price history is the series across every imported
 * invoice, one row per day. The published-price lookup is `runAnomalies`'s own
 * (`loadPublishedPrices`) and the severity is `priceAbovePublished`'s own
 * verdict, so this view and the anomaly engine can't disagree about what a
 * billing error is.
 */
export async function getStationBilledPrices(pool: Pool, id: string): Promise<StationBilledPrices | null> {
  if (!isUuid(id)) {
    return null;
  }
  const { rows: stationRows } = await pool.query<StationRow>(
    "SELECT id, site_ref, name_raw, city_raw, state_usps FROM stations WHERE id = $1",
    [id],
  );
  const station = stationRows[0];
  if (!station) {
    return null;
  }

  const config = await loadPriceAbovePublishedConfig(pool);
  const [{ rows }, published] = await Promise.all([
    pool.query<DayRow>(
      `SELECT to_char((fs.occurred_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
              count(DISTINCT fs.id) AS stop_count,
              count(DISTINCT fs.card_id) AS card_count,
              SUM(fsl.gallons) AS gallons,
              SUM(fsl.gallons * fsl.billed_usd_per_gal) AS weighted_num,
              array_agg(DISTINCT fsl.billed_usd_per_gal ORDER BY fsl.billed_usd_per_gal) AS prices
       FROM fuel_stops fs
       JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id AND fsl.product_code = $2
       WHERE fs.station_id = $1
       GROUP BY day
       ORDER BY day ASC`,
      [id, config.fuelProductCode],
    ),
    loadPublishedPrices(pool, [id], config.fuelProductCode),
  ]);

  const days = rows.map((row): StationBilledPriceDay => {
    const distinctBilledPrices = row.prices.map(Number);
    const gallons = Number(row.gallons);
    const publishedRaw = published.get(publishedPriceKey(id, row.day));
    const publishedUsdPerGal = publishedRaw === undefined ? null : Number(publishedRaw);
    const highest = distinctBilledPrices[distinctBilledPrices.length - 1]!;

    // One audit "stop" per distinct price: the rule flags a price, so the day is
    // a billing error if any price it was billed at crosses the threshold.
    const verdicts = priceAbovePublished(
      row.prices.map((price) => ({ id: price, stationId: id, occurredOn: row.day, billedUsdPerGal: price })),
      published,
      config,
    );

    return {
      date: row.day,
      stopCount: Number(row.stop_count),
      cardCount: Number(row.card_count),
      gallons: Math.round(gallons * 100) / 100,
      distinctBilledPrices,
      avgBilledUsdPerGal: gallons > 0 ? Number(row.weighted_num) / gallons : null,
      publishedUsdPerGal,
      discrepancy: publishedUsdPerGal === null ? null : round4(highest - publishedUsdPerGal),
      severity: verdicts.some((v) => v.status === "flagged") ? "red" : null,
    };
  });

  return {
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
