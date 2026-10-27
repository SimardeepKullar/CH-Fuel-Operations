"use client";

import { useState } from "react";

export interface BatchGroup {
  driverId: string;
  name: string;
  /** Every stop the server will confirm for this driver — the driver's whole unconfirmed queue. */
  count: number;
  /** How many of those the dispatcher has marked missing, which a batch confirm overwrites. */
  missing: number;
}

interface BatchConfirmProps {
  groups: BatchGroup[];
  busy: boolean;
  onConfirm: (group: BatchGroup) => void;
}

/**
 * Batch confirm for a driver who uploaded everything (A8.5). Two steps on purpose: choose the
 * driver, then a confirmation that states the exact count the write will cover — the server
 * confirms the driver's whole queue, so the count shown is that queue, not what is on screen.
 */
export default function BatchConfirm({ groups, busy, onConfirm }: BatchConfirmProps) {
  const [driverId, setDriverId] = useState("");
  const [confirming, setConfirming] = useState(false);

  const group = groups.find((g) => g.driverId === driverId) ?? null;

  function reset(): void {
    setConfirming(false);
    setDriverId("");
  }

  return (
    <section className="rq-batch panel-card" data-testid="batch-confirm" aria-label="Batch confirm">
      <h2 className="rq-batch-title">Batch confirm</h2>
      <p className="rq-batch-sub">For a driver who uploaded every receipt.</p>
      <div className="rq-batch-row">
        <select
          className="rq-batch-select"
          aria-label="Driver"
          value={group === null ? "" : driverId}
          disabled={busy || groups.length === 0}
          onChange={(e) => {
            setDriverId(e.target.value);
            setConfirming(false);
          }}
        >
          <option value="">{groups.length === 0 ? "No driver to confirm" : "Choose a driver…"}</option>
          {groups.map((g) => (
            <option key={g.driverId} value={g.driverId}>
              {g.name} ({g.count})
            </option>
          ))}
        </select>
        {!confirming && (
          <button className="btn btn-ghost rq-batch-button" type="button" disabled={busy || group === null} onClick={() => setConfirming(true)}>
            Confirm all…
          </button>
        )}
      </div>
      {confirming && group !== null && (
        <div className="rq-batch-confirm" role="alertdialog" aria-label="Confirm batch" data-testid="batch-confirm-step">
          <p className="rq-batch-count">
            Confirm <strong>{group.count}</strong> {group.count === 1 ? "receipt" : "receipts"} for {group.name}? This writes {group.count}{" "}
            {group.count === 1 ? "check" : "checks"}.
            {group.missing > 0 && ` ${group.missing} of them you marked missing.`}
          </p>
          <div className="rq-batch-row">
            <button
              className="btn btn-primary rq-batch-button"
              type="button"
              disabled={busy}
              onClick={() => {
                onConfirm(group);
                reset();
              }}
            >
              Confirm {group.count}
            </button>
            <button className="btn btn-ghost rq-batch-button" type="button" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
