export const DEFAULT_K = 40;
export const DEFAULT_BUCKET_MILES = 50;

export interface StratifiedCandidate {
  id: string;
  offsetAlongRouteMiles: number;
  unitPriceUsd: number;
}

export interface StratifiedTopKOptions {
  k?: number;
  bucketMiles?: number;
}

function byPriceThenPosition(a: StratifiedCandidate, b: StratifiedCandidate): number {
  return (
    a.unitPriceUsd - b.unitPriceUsd ||
    a.offsetAlongRouteMiles - b.offsetAlongRouteMiles ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function byPosition(a: StratifiedCandidate, b: StratifiedCandidate): number {
  return a.offsetAlongRouteMiles - b.offsetAlongRouteMiles || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * §15.4 (c): the ~K candidates the optimiser and the detour matrix calls work
 * on, chosen for coverage first and price second.
 *
 * Sorting by price is the trap. Prices cluster regionally, so the K cheapest on
 * a long lane can all sit at one end, and the optimiser then reports a range gap
 * across ground that had usable stations on it — an infeasibility that looks
 * legitimate but is a selection bug. Instead the route is cut into
 * `bucketMiles`-wide buckets by position and candidates are drawn round-robin:
 * every occupied bucket yields its cheapest station, then every bucket still
 * holding one yields its second cheapest, and so on until K.
 *
 * Two consequences worth stating:
 * - A round that cannot be completed goes to the buckets whose next candidate is
 *   cheapest, not to the earliest buckets, so K running out never biases the pick
 *   toward the origin.
 * - If more than K buckets are occupied (a route past K × bucketMiles, i.e. 2,000
 *   miles at the defaults) K widens to the bucket count. Holding K would drop whole
 *   buckets — up to a leg's worth of contiguous road — which is the failure this
 *   exists to prevent.
 *
 * Pure: no I/O. Returns a new array in position order (the optimiser's input
 * order); the input is not touched.
 */
export function stratifiedTopK<T extends StratifiedCandidate>(candidates: readonly T[], options: StratifiedTopKOptions = {}): T[] {
  const { k = DEFAULT_K, bucketMiles = DEFAULT_BUCKET_MILES } = options;
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`k must be a positive integer, got ${k}`);
  }
  if (!Number.isFinite(bucketMiles) || bucketMiles <= 0) {
    throw new RangeError(`bucketMiles must be a positive number, got ${bucketMiles}`);
  }

  if (candidates.length <= k) {
    return [...candidates].sort(byPosition);
  }

  const buckets = new Map<number, T[]>();
  for (const candidate of candidates) {
    const index = Math.floor(candidate.offsetAlongRouteMiles / bucketMiles);
    const bucket = buckets.get(index);
    if (bucket) {
      bucket.push(candidate);
    } else {
      buckets.set(index, [candidate]);
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort(byPriceThenPosition);
  }

  const budget = Math.max(k, buckets.size);
  const ordered = [...buckets.entries()].sort(([a], [b]) => a - b).map(([, bucket]) => bucket);
  const picked: T[] = [];

  for (let round = 0; picked.length < budget; round++) {
    const drawable = ordered.filter((bucket) => bucket.length > round).map((bucket) => bucket[round]!);
    if (drawable.length === 0) {
      break;
    }
    // Cheapest first, so the last, partial round spends what is left where it is cheapest.
    drawable.sort(byPriceThenPosition);
    picked.push(...drawable.slice(0, budget - picked.length));
  }

  return picked.sort(byPosition);
}
