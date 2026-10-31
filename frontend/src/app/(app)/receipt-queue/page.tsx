"use client";

import { useCallback, useMemo, useState } from "react";
import type { ReceiptOutcome } from "@ch/core/db/types";
import { ApiError, confirmReceiptStops, getAllReceipts, postReceiptCheck } from "../../../lib/api";
import { useApiResource } from "../../../hooks/useApiResource";
import { useStandingCountsValue } from "../../../hooks/standingCountsContext";
import PageBanner from "../../../components/PageBanner";
import RawResolved from "../../../components/RawResolved";
import InvoiceTag from "../../../components/InvoiceTag";
import AnomalyFlag, { describeFlag, flagDescription } from "../../../components/AnomalyFlag";
import SegmentedControl from "../../../components/SegmentedControl";
import { formatMoney, formatQty2dp } from "../../../lib/formatMoney";
import { SIDE_LABELS } from "../../../lib/weeks";
import { printedAt } from "../../../lib/wallClock";
import { productBadgeVariant, productLabel } from "../../../lib/transactionFilterConstants";
import {
  NO_FILTERS,
  driverName,
  hasFilters,
  invoiceOptions,
  truckName,
  visibleRows,
  type QueueFilters,
  type QueueRow,
  type QueueView,
} from "../../../lib/receiptQueueView";

const STATUS_WORD = { pending: "Pending", confirmed: "Confirmed", missing: "Missing" } as const;

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.title;
  if (err instanceof Error) return err.message;
  return String(err);
}

interface Failure {
  message: string;
  retry: () => void;
}

/**
 * A8.5's Receipt Queue (T-43): every fuel purchase of every billing week, one row each, with Yes / No
 * for "was a receipt uploaded in Samsara?". It is a standing worklist (D17), so To check always equals
 * the sidebar's badge, and an Invoice filter narrows it rather than the week selector. A decision is
 * optimistic: the row, the counts and the progress bar move at once, and a failed write puts the row
 * back and says so.
 */
export default function ReceiptQueuePage() {
  const { data, loading, error, refetch } = useApiResource(getAllReceipts);
  const { refresh: refreshCounts } = useStandingCountsValue();

  const [view, setView] = useState<QueueView>("check");
  const [filters, setFilters] = useState<QueueFilters>(NO_FILTERS);
  // Row id -> what the dispatcher decided this session (written, or in flight).
  const [decided, setDecided] = useState<ReadonlyMap<string, ReceiptOutcome>>(new Map());
  // Rows decided this session that a "To check" view keeps listed until the view or a filter changes.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const rows = useMemo<QueueRow[]>(
    () => (data?.items ?? []).map((i) => ({ ...i, status: decided.get(i.id) ?? i.receiptStatus })),
    [data, decided],
  );
  const total = rows.length;
  const confirmed = rows.filter((r) => r.status === "confirmed").length;
  const toCheck = total - confirmed;
  const pct = total === 0 ? 0 : Math.round((confirmed / total) * 100);

  const shown = useMemo(() => visibleRows(rows, view, filters, kept), [rows, view, filters, kept]);

  const driverOptions = useMemo(() => [...new Set(rows.map(driverName))].sort((a, b) => a.localeCompare(b)), [rows]);
  const invoices = useMemo(() => invoiceOptions(rows), [rows]);
  const dayOptions = useMemo(() => {
    const byDay = new Map<string, string>();
    for (const r of rows) byDay.set(printedAt(r.occurredAt).dayKey, printedAt(r.occurredAt).date);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  // Any change to the view or a filter lets this session's decided rows leave a "To check" list.
  const changeView = (v: QueueView) => {
    setView(v);
    setKept(new Set());
    setConfirming(false);
    setFlash("");
  };
  const changeFilters = (patch: Partial<QueueFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setKept(new Set());
    setConfirming(false);
    setFlash("");
  };

  const decide = useCallback(
    function decideRow(row: QueueRow, outcome: ReceiptOutcome) {
      setFailure(null);
      setFailedId(null);
      setFlash("");
      setDecided((m) => new Map(m).set(row.id, outcome));
      setKept((k) => new Set(k).add(row.id));
      postReceiptCheck(row.id, outcome)
        .then(() => refreshCounts?.())
        .catch((err: unknown) => {
          setDecided((m) => {
            const next = new Map(m);
            next.delete(row.id);
            return next;
          });
          setFailedId(row.id);
          setFailure({
            message: `${printedAt(row.occurredAt).date} · ${printedAt(row.occurredAt).time} · ${driverName(row)} · Truck ${truckName(row)}: your “${outcome === "confirmed" ? "Yes" : "No"}” didn’t save because ${messageOf(err)}. The row is back to ${STATUS_WORD[row.receiptStatus]}.`,
            retry: () => decideRow(row, outcome),
          });
        });
    },
    [refreshCounts],
  );

  const undecided = shown.filter((r) => r.status !== "confirmed");
  const batchMissing = undecided.filter((r) => r.status === "missing").length;
  const dayLabel = filters.day === "" ? "" : (dayOptions.find(([k]) => k === filters.day)?.[1] ?? "");
  const who = [filters.driver, dayLabel, filters.invoice === "" ? "" : `invoice ${filters.invoice}`].filter(Boolean).join(" on ");
  const batchScoped = filters.driver !== "" || filters.day !== "";
  const n = undecided.length;

  const confirmBatch = () => {
    const ids = undecided.map((r) => r.id);
    setConfirming(false);
    setFailure(null);
    setBatchBusy(true);
    setDecided((m) => {
      const next = new Map(m);
      for (const id of ids) next.set(id, "confirmed");
      return next;
    });
    setKept((k) => new Set([...k, ...ids]));
    confirmReceiptStops(ids)
      .then(() => {
        setFlash(`${ids.length} receipts confirmed for ${who}.`);
        refreshCounts?.();
      })
      .catch((err: unknown) => {
        setDecided((m) => {
          const next = new Map(m);
          for (const id of ids) next.delete(id);
          return next;
        });
        setFailure({
          message: `Could not confirm ${ids.length} receipts for ${who} — nothing was written. ${messageOf(err)}`,
          retry: () => setConfirming(true),
        });
      })
      .finally(() => setBatchBusy(false));
  };

  const ready = data !== null;
  const segOptions: { value: QueueView; label: string }[] = [
    { value: "check", label: `To check ${ready ? toCheck : "—"}` },
    { value: "confirmed", label: `Confirmed ${ready ? confirmed : "—"}` },
    { value: "all", label: `All ${ready ? total : "—"}` },
  ];
  const nothingImported = ready && total === 0;
  const nothingLeft = ready && !nothingImported && shown.length === 0 && view === "check" && !hasFilters(filters);

  return (
    <>
      <PageBanner
        title="Receipt Queue"
        controls={<SegmentedControl options={segOptions} value={view} onChange={changeView} ariaLabel="View" />}
        readout={
          <span className="rq-readout">
            <span className="rq-bar" role="progressbar" aria-label="Receipts confirmed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span className="rq-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span data-testid="queue-progress">
              <strong>{ready ? confirmed : "—"}</strong> of {ready ? total : "—"} confirmed
            </span>
            <span aria-hidden="true">·</span>
            <span data-testid="queue-to-check">
              <strong>{ready ? toCheck : "—"}</strong> to check
            </span>
          </span>
        }
        meta="Receipts checked in Samsara"
      />
      <div className="tx-page">
        <div className="tx-toolbar" role="search" aria-label="Filters">
          <div className="tx-toolbar-row">
            <input
              type="search"
              className="input tx-search"
              value={filters.q}
              placeholder="Search driver, truck, station, or a date like Oct 21, 2026"
              aria-label="Search fuel purchases"
              onChange={(e) => changeFilters({ q: e.target.value })}
            />
            <span className="tx-filter">
              <span className="tx-filter-label">Invoice</span>
              <select
                className="input tx-filter-select"
                aria-label="Invoice"
                value={filters.invoice}
                onChange={(e) => changeFilters({ invoice: e.target.value })}
              >
                <option value="">All</option>
                {invoices.map((i) => (
                  <option key={i.number} value={i.number}>
                    {SIDE_LABELS[i.currency]} {i.number}
                  </option>
                ))}
              </select>
            </span>
            <span className="tx-filter">
              <span className="tx-filter-label">Driver</span>
              <select
                className="input tx-filter-select"
                aria-label="Driver"
                value={filters.driver}
                onChange={(e) => changeFilters({ driver: e.target.value })}
              >
                <option value="">All</option>
                {driverOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </span>
            <span className="tx-filter">
              <span className="tx-filter-label">Day</span>
              <select className="input tx-filter-select" aria-label="Day" value={filters.day} onChange={(e) => changeFilters({ day: e.target.value })}>
                <option value="">Any</option>
                {dayOptions.map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
            </span>
            <label className={`tx-anomaly-toggle${filters.flaggedOnly ? " active" : ""}`}>
              <input type="checkbox" checked={filters.flaggedOnly} onChange={(e) => changeFilters({ flaggedOnly: e.target.checked })} />
              <span className="tx-anomaly-toggle-label">Flagged only</span>
            </label>
            <span className="tx-toolbar-meta">
              <span className="tx-count">
                {shown.length} of {total}
              </span>
              <button className="tx-clear" type="button" onClick={() => changeFilters(NO_FILTERS)}>
                Clear
              </button>
            </span>
          </div>
          <div className="tx-legend">
            <span className="tx-legend-label">Reading the columns</span>
            <span className="tx-legend-item">
              <RawResolved value={{ resolved: "072", raw: "072", agrees: true }} />
              resolved from the card assignment
            </span>
            <span className="tx-legend-item">
              <RawResolved value={{ resolved: null, raw: "072", agrees: null }} />
              as entered at the pump
            </span>
            <span className="tx-legend-item">
              <RawResolved value={{ resolved: "072", raw: "0", agrees: false }} />
              the two disagree
            </span>
          </div>
        </div>

        {ready && batchScoped && n > 0 && !confirming && (
          <section className="rq-batch" aria-label="Batch confirm">
            <div className="rq-batch-text">
              <span className="rq-batch-title">
                {n} shown for {who} still need a decision
              </span>
              <span className="rq-batch-hint">{batchMissing === 0 ? "None marked missing" : `Includes ${batchMissing} you marked missing`}</span>
            </div>
            <button type="button" className="rq-btn rq-btn-primary rq-batch-go" disabled={batchBusy} onClick={() => setConfirming(true)}>
              Confirm all {n} shown for {who}
            </button>
          </section>
        )}

        {ready && confirming && n > 0 && (
          <section className="rq-confirm" aria-label="Confirm batch">
            <div className="rq-confirm-text">
              <span className="rq-confirm-title">
                Confirm {n} receipts for {who}?
              </span>
              <span>
                This writes {n} checks.{" "}
                <strong className="rq-red">
                  {batchMissing === 0
                    ? "None of them were marked missing."
                    : batchMissing === 1
                      ? "1 of them you marked missing — it becomes Confirmed."
                      : `${batchMissing} of them you marked missing — they become Confirmed.`}
                </strong>
              </span>
            </div>
            <div className="rq-confirm-actions">
              <button type="button" className="rq-btn rq-btn-primary" onClick={confirmBatch}>
                Confirm {n}
              </button>
              <button type="button" className="rq-btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </section>
        )}

        {flash !== "" && (
          <div className="rq-flash" role="status">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            {flash}
          </div>
        )}

        {failure !== null && (
          <div className="rq-alert" role="alert" data-testid="queue-failure">
            <div className="rq-alert-text">
              <strong>Couldn’t save — row reverted</strong>
              <span>{failure.message}</span>
            </div>
            <button type="button" className="rq-btn rq-btn-danger" onClick={failure.retry}>
              Retry
            </button>
            <button
              type="button"
              className="rq-btn rq-btn-danger-ghost"
              onClick={() => {
                setFailure(null);
                setFailedId(null);
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="tx-panel" aria-label="Fuel purchases" aria-busy={loading && !ready}>
          {loading && !ready && (
            <>
              <div className="rq-loading" role="status">
                Loading fuel purchases…
              </div>
              {Array.from({ length: 10 }, (_, i) => (
                <div className="rq-skel" aria-hidden="true" key={i}>
                  {Array.from({ length: 9 }, (_, j) => (
                    <span key={j} />
                  ))}
                </div>
              ))}
            </>
          )}

          {error !== null && !ready && (
            <div className="rq-error" role="alert">
              <strong>Couldn’t load fuel purchases</strong>
              <span>{error.message}</span>
              <button type="button" className="rq-btn rq-btn-primary" onClick={refetch}>
                Try again
              </button>
            </div>
          )}

          {ready && shown.length > 0 && (
            <div className="rq-scroll">
              <table className="rq-table">
                <thead>
                  <tr>
                    <th scope="col">Receipt</th>
                    <th scope="col">Date · time</th>
                    <th scope="col">Driver</th>
                    <th scope="col">Truck</th>
                    <th scope="col">Station</th>
                    <th scope="col">Products</th>
                    <th scope="col" className="rq-r">
                      Quantity
                    </th>
                    <th scope="col" className="rq-r">
                      Total
                    </th>
                    <th scope="col">Reason</th>
                    <th scope="col" className="rq-r">
                      Receipt uploaded?
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className={r.id === failedId ? "rq-row-failed" : undefined} data-testid="queue-row">
                      <td>
                        <StatusCell status={r.status} />
                      </td>
                      <td>
                        <span className="tx-datetime">
                          <span className="tx-date">{printedAt(r.occurredAt).date}</span>
                          <span className="tx-time" title={printedAt(r.occurredAt).full}>{printedAt(r.occurredAt).time}</span>
                          <InvoiceTag currency={r.currency} invoiceNumber={r.invoiceNumber} />
                        </span>
                      </td>
                      <td>
                        <RawResolved value={r.driver} />
                      </td>
                      <td>
                        <RawResolved value={r.truck} primary="raw" showRawWhenAgreeing />
                      </td>
                      <td>
                        <span className="tx-station">
                          <span className="tx-station-name">{r.station === null ? "Unresolved" : r.station.name}</span>
                          <span className="tx-station-place">{r.station === null ? "—" : `${r.station.city}, ${r.station.state}`}</span>
                        </span>
                      </td>
                      <td>
                        <span className="tx-products" data-testid="queue-products">
                          {r.products.map((code) => (
                            <span key={code} className={`product-badge product-badge-${productBadgeVariant(code)}`}>
                              {productLabel(code)}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="rq-r">
                        <span className="tx-gal">
                          {r.qty === null ? "—" : formatQty2dp(r.qty)}
                          {r.qty !== null && <span className="rq-unit"> {r.qtyUnit === "L" ? "L" : "gal"}</span>}
                        </span>
                      </td>
                      <td className="rq-r">{formatMoney(r.total, r.currency)}</td>
                      <td>
                        {r.hasException && (
                          <span
                            className="rq-flag"
                            tabIndex={0}
                            aria-label={`Flagged: ${r.flags.map((f) => describeFlag(f.rule)).join("; ")}`}
                          >
                            <span className="anomaly-flag anomaly-flag-amber">Flagged</span>
                            <span className="rq-flag-tip" role="tooltip" data-testid="queue-flag-tip">
                              {r.flags.map((f) => (
                                <span className="rq-flag-line" key={f.rule}>
                                  <AnomalyFlag flag={f} />
                                  <span>{flagDescription(f.rule)}</span>
                                </span>
                              ))}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="rq-r">
                        <div className="rq-yn">
                          <button
                            type="button"
                            className="rq-yes"
                            aria-pressed={r.status === "confirmed"}
                            aria-label="Yes, receipt uploaded"
                            disabled={batchBusy}
                            onClick={() => decide(r, "confirmed")}
                          >
                            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                              <path d="M2 6.3l2.6 2.6L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                            </svg>
                            Yes
                          </button>
                          <button
                            type="button"
                            className="rq-no"
                            aria-pressed={r.status === "missing"}
                            aria-label="No, receipt missing"
                            disabled={batchBusy}
                            onClick={() => decide(r, "missing")}
                          >
                            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                              <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                            </svg>
                            No
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nothingLeft && (
            <div className="rq-done" data-testid="queue-clear">
              <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="22" fill="#2f7d4f" />
                <path d="M13 22.5l6 6L31 16" fill="none" stroke="#fff" strokeWidth="3" />
              </svg>
              <h2>Nothing left to check</h2>
              <p>
                {confirmed} of {total} confirmed.
              </p>
              <button type="button" className="rq-btn" onClick={() => changeView("all")}>
                View all {total}
              </button>
            </div>
          )}

          {nothingImported && <div className="rq-empty">No invoices are imported yet.</div>}

          {ready && shown.length === 0 && !nothingLeft && !nothingImported && (
            <div className="rq-empty">
              <strong>No fuel purchases match these filters.</strong>
              <button type="button" className="rq-btn" onClick={() => changeFilters(NO_FILTERS)}>
                Clear filters
              </button>
            </div>
          )}

          <div className="rq-foot tx-caption">
            <span className="rq-num">{ready ? `Showing ${shown.length} · newest first` : loading ? "Loading…" : "Nothing loaded"}</span>
          </div>
        </section>
      </div>
    </>
  );
}

function StatusCell({ status }: { status: QueueRow["status"] }) {
  const mark = status === "confirmed" ? "✓" : status === "missing" ? "✕" : "?";
  return (
    <span className={`rq-status rq-status-${status}`}>
      <span className={`tx-receipt-mark ${status}`} aria-hidden="true">
        {mark}
      </span>
      {STATUS_WORD[status]}
    </span>
  );
}
