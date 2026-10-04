import type { TransactionListItem } from "@ch/core/actuals/transactions";
import { formatGallons2dp, formatMoneyUsd, formatPricePerGal } from "../lib/formatMoney";
import { productLabel } from "../lib/transactionFilterConstants";
import RawResolved from "./RawResolved";

const RECEIPT_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  missing: "Missing",
};

interface StopExpansionProps {
  /** Must carry `lines` — the caller fetches the table's page with
   * `includeLines: true` so every row can expand instantly with no
   * per-row lazy fetch (a period is ~60 stops, cheap to fetch in full). */
  stop: TransactionListItem;
  /**
   * Forces the single-column stacked layout. Real narrow-viewport behaviour
   * comes from the `.stop-expansion` media query in App.css (App.css's own
   * established pattern — see `.plan-grid`'s `@media (max-width: 1080px)`);
   * this prop exists so Step 40.2's "at 900px the expansion stacks, no cell
   * overlaps another" requirement is directly assertable in tests without a
   * real layout engine — jsdom has none, `getBoundingClientRect` always
   * reports zeros there, so a viewport-driven CSS assertion can't be read
   * back. Forcing the same single-column structure the media query would
   * produce, and asserting on that structure (one column, nothing beside
   * it to overlap), is the equivalent, deterministic check.
   */
  stacked?: boolean;
  /** The page's scoping invoice number (`useInvoicePeriod`'s own
   * `invoiceNumber`, A7) — every row already belongs to the one invoice the
   * top bar has selected, so this is passed down rather than re-derived per
   * stop. `null` while loading. */
  invoiceNumber?: string | null;
}

/**
 * A stop's expanded detail (T-40 step 40.2, A8.3): every product line and an
 * "unmissable" stop total. The total shown is `stop.totalUsd` — the stored,
 * authoritative figure (CLAUDE.md: a stored total stays authoritative over
 * a recomputation) — not a client-side re-sum of `lines`, though the two
 * always agree in real data (`transactions.test.ts`'s own $255.13 case).
 *
 * The design file's right-hand panel also shows an assignment "since" date
 * and an "Open detail"/"Find receipt" pair of links on the Source row;
 * omitted here — no truck-assignment date is returned by any endpoint yet,
 * and both links' destinations (A8.4's transaction-detail screen, T-43's
 * Receipt Queue) don't exist yet either. Wiring a link to a screen that
 * isn't built would be a dead click, not a feature.
 */
export default function StopExpansion({ stop, stacked = false, invoiceNumber = null }: StopExpansionProps) {
  const lines = stop.lines ?? [];

  return (
    <div className={`stop-expansion${stacked ? " stop-expansion-stacked" : ""}`} data-testid="stop-expansion">
      <div className="stop-expansion-lines">
        <div className="stop-expansion-line-row stop-expansion-lines-head">
          <span>Cd</span>
          <span>Product</span>
          <span className="num">Gallons</span>
          <span className="num">Retail</span>
          <span className="num">Billed</span>
          <span className="num">Amount</span>
        </div>
        {lines.map((line) => (
          <div className="stop-expansion-line-row stop-expansion-line" key={line.productCode}>
            <span className="mono">{line.productCode}</span>
            <span className="stop-expansion-line-label">{productLabel(line.productCode)}</span>
            <span className="num">{formatGallons2dp(line.qty)}</span>
            <span className="num muted">{formatPricePerGal(line.retailPerUnit)}</span>
            <span className="num stop-expansion-line-billed">{formatPricePerGal(line.billedPerUnit)}</span>
            <span className="num">{formatMoneyUsd(line.amount)}</span>
          </div>
        ))}
        <div className="stop-expansion-line-row stop-expansion-total">
          <span />
          <span className="stop-expansion-total-label">Stop total</span>
          <span className="num muted">{stop.qty === null ? "—" : formatGallons2dp(stop.qty)}</span>
          <span />
          <span />
          <span className="num stop-expansion-total-value" data-testid="stop-total">
            {formatMoneyUsd(stop.total)}
          </span>
        </div>
      </div>

      <div className="stop-expansion-detail">
        <dl className="stop-expansion-detail-list">
          <dt>Station</dt>
          <dd>
            {stop.station
              ? `Love's #${stop.station.loveNumber ?? "?"} — ${stop.station.city}, ${stop.station.state}`
              : "Unresolved"}
          </dd>
          <dt>Card</dt>
          <dd className="mono">{stop.card.number}</dd>
          <dt>Assigned truck</dt>
          <dd>{stop.truck.resolved ?? "Unresolved"}</dd>
          <dt>Raw driver text</dt>
          <dd>
            <RawResolved value={stop.driver} rawOnly />
          </dd>
          <dt>Raw unit text</dt>
          <dd>
            <RawResolved value={stop.truck} rawOnly />
          </dd>
          <dt>Receipt</dt>
          <dd>{RECEIPT_LABELS[stop.receiptStatus] ?? stop.receiptStatus}</dd>
          {invoiceNumber !== null && (
            <>
              <dt>Source</dt>
              <dd>Invoice {invoiceNumber}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
