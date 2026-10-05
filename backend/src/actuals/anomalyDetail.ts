/**
 * `anomalies.detail` is each rule's own jsonb, stored once at detection. The
 * US findings of `sub_gallon`, `charges_no_fuel` and `price_above_published`
 * were written before invoices were currency-neutral (T-61) and keep that
 * shape — `amountUsd`, `totalUsd`, `gallons`, `billedUsdPerGal` — while a CA
 * finding already uses the neutral keys beside a `currency`. T-63's contract
 * has no `Usd` key anywhere in a response, so the legacy keys are renamed on
 * the way out rather than rewritten in the table: the stored history stays what
 * was detected, and a rule added later cannot reintroduce a `Usd` key past the
 * API unnoticed (any left over is stripped here too, and the response-key walk
 * in the route tests includes `detail`).
 *
 * Pure — no database, no HTTP, no clock.
 */

/** Legacy key -> contract key. Every one is a US figure, so a finding that
 * carried one is USD in gallons. */
const LEGACY_KEYS: Readonly<Record<string, string>> = {
  amountUsd: "amount",
  totalUsd: "total",
  gallons: "qty",
  billedUsdPerGal: "billedPerUnit",
  publishedUsdPerGal: "publishedPerUnit",
  maxOverageUsdPerGal: "maxOveragePerUnit",
};

function contractKey(key: string): string | null {
  const mapped = LEGACY_KEYS[key];
  if (mapped !== undefined) {
    return mapped;
  }
  return /usd/i.test(key) ? key.replace(/UsdPerGal/g, "PerUnit").replace(/Usd/g, "") : null;
}

export function normalizeAnomalyDetail(detail: unknown): unknown {
  if (Array.isArray(detail)) {
    return detail.map(normalizeAnomalyDetail);
  }
  if (detail === null || typeof detail !== "object") {
    return detail;
  }
  const out: Record<string, unknown> = {};
  let renamed = false;
  let renamedQty = false;
  for (const [key, value] of Object.entries(detail)) {
    const next = contractKey(key);
    if (next === null) {
      out[key] = normalizeAnomalyDetail(value);
      continue;
    }
    renamed = true;
    renamedQty ||= key === "gallons";
    out[next] = normalizeAnomalyDetail(value);
  }
  // A legacy key only ever held a US figure: say so, unless the finding already did.
  if (renamed && !("currency" in out)) {
    out.currency = "USD";
  }
  if (renamedQty && !("qtyUnit" in out)) {
    out.qtyUnit = "gal";
  }
  return out;
}
