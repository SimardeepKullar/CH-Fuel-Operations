import type { ReceiptQueueItem } from "@ch/core/actuals/receipts";
import { formatMoney, formatQty2dp } from "../lib/formatMoney";
import RawResolved from "./RawResolved";

const STATUS_LABELS = { pending: "Pending", missing: "Marked missing", confirmed: "Confirmed" } as const;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
  return `${date} · ${time}`;
}

interface QueueCardProps {
  item: ReceiptQueueItem;
  /** Disables the decision buttons while a batch confirm is writing. */
  busy?: boolean;
  onDecide: (outcome: "confirmed" | "missing") => void;
  onSkip: () => void;
}

/**
 * One unconfirmed fuel stop with what a dispatcher needs to find its receipt in Samsara — driver,
 * date and time, truck, station, gallons, total (A8.5) — and the three decisions. The card assumes
 * nothing about why the item is here, so an exceptions-only queue renders through the same markup
 * (D17). The shortcut keys live on the page; the buttons only show them.
 */
export default function QueueCard({ item, busy = false, onDecide, onSkip }: QueueCardProps) {
  return (
    <article className="rq-card panel-card" data-testid="queue-card">
      <div className="rq-when">
        <span className="rq-when-text">{formatWhen(item.occurredAt)}</span>
        {item.hasException && (
          <span className="rq-badge rq-badge-flag" data-testid="queue-flagged">
            Flagged
          </span>
        )}
        {item.receiptStatus !== "pending" && (
          <span className="rq-badge" data-testid="queue-status">
            {STATUS_LABELS[item.receiptStatus]}
          </span>
        )}
      </div>

      <dl className="rq-facts">
        <div className="rq-fact">
          <dt>Driver</dt>
          <dd data-testid="queue-driver">
            <RawResolved value={item.driver} />
          </dd>
        </div>
        <div className="rq-fact">
          <dt>Truck</dt>
          <dd data-testid="queue-truck">
            <RawResolved value={item.truck} primary="raw" showRawWhenAgreeing />
          </dd>
        </div>
        <div className="rq-fact rq-fact-wide">
          <dt>Station</dt>
          <dd data-testid="queue-station">
            {item.station === null ? (
              "Unresolved"
            ) : (
              <>
                Love&rsquo;s #{item.station.loveNumber ?? "?"} · {item.station.city}, {item.station.state}
              </>
            )}
          </dd>
        </div>
        <div className="rq-fact">
          <dt>{item.qtyUnit === "L" ? "Litres" : "Gallons"}</dt>
          <dd data-testid="queue-qty">{item.qty === null ? "—" : formatQty2dp(item.qty)}</dd>
        </div>
        <div className="rq-fact">
          <dt>Total</dt>
          <dd data-testid="queue-total">{formatMoney(item.total, item.currency)}</dd>
        </div>
      </dl>

      <div className="rq-actions" role="group" aria-label="Receipt decision">
        <button className="rq-action rq-action-yes" type="button" disabled={busy} onClick={() => onDecide("confirmed")}>
          <kbd className="rq-key">Y</kbd>
          <span>Receipt uploaded</span>
        </button>
        <button className="rq-action rq-action-no" type="button" disabled={busy} onClick={() => onDecide("missing")}>
          <kbd className="rq-key">N</kbd>
          <span>No receipt</span>
        </button>
        <button className="rq-action rq-action-skip" type="button" disabled={busy} onClick={onSkip}>
          <kbd className="rq-key">S</kbd>
          <span>Skip</span>
        </button>
      </div>
    </article>
  );
}
