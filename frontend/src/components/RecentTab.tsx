import { useCallback, useState } from "react";
import type { PlanListItem } from "@ch/core/planning/planPersistence";
import Corners from "./Corners";
import EmptyState from "./EmptyState";
import { listPlans } from "../lib/api";
import { useApiResource } from "../hooks/useApiResource";
import { formatCurrency } from "../lib/format";

interface RecentTabProps {
  /** The plan currently open on the Plan tab, if any — highlights its row. */
  currentPlanId: string | null;
  onOpenPlan: (planId: string) => void;
}

const PAGE_SIZE = 25;

const STATUS_LABEL: Record<PlanListItem["status"], string> = {
  completed: "Completed",
  infeasible: "Infeasible",
};

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

/** `GET /plans` list projection (T-18 step 18.3, UI contract §4) — real data, paginated. */
export default function RecentTab({ currentPlanId, onOpenPlan }: RecentTabProps) {
  const [page, setPage] = useState(1);
  const fetcher = useCallback(() => listPlans({ page, pageSize: PAGE_SIZE }), [page]);
  const { data, loading, error } = useApiResource(fetcher);

  const plans = data?.plans ?? [];
  const total = data?.total ?? 0;
  const hasNextPage = page * PAGE_SIZE < total;

  return (
    <section className="panel">
      <div className="panel-card blueprint">
        <Corners />
        <div className="panel-card-header">
          <div className="panel-card-title">Recent trips</div>
          <span className="panel-card-sub">click a trip to open its plan</span>
        </div>

        {loading && plans.length === 0 && <div className="trip-loading">Loading…</div>}
        {error && (
          <div className="trip-error" role="alert">
            Couldn’t load recent trips — {error.message}
          </div>
        )}
        {!loading && !error && plans.length === 0 && (
          <EmptyState title="No trips planned yet." detail="Plan a route on the Plan tab to see it here." />
        )}

        {plans.length > 0 && (
          <div className="trip-table">
            <div className="trip-row trip-head">
              <span>Trip</span>
              <span>Date</span>
              <span>Route</span>
              <span>Distance</span>
              <span>Truck</span>
              <span>Saved</span>
              <span>Status</span>
            </div>

            <div className="trip-body">
              {plans.map((t) => {
                const isCurrent = t.planId === currentPlanId;
                return (
                  <div
                    key={t.planId}
                    className={`trip-row trip-item${isCurrent ? " current blueprint" : ""}${
                      t.status === "infeasible" ? " infeasible" : ""
                    }`}
                    onClick={() => onOpenPlan(t.planId)}
                  >
                    {isCurrent && <Corners />}
                    <span className="trip-id">{t.planId}</span>
                    <span className="trip-date">{shortDate(t.createdAt)}</span>
                    <span className="trip-route">
                      {t.origin.label ?? "—"} → {t.destination.label ?? "—"}
                    </span>
                    <span>{t.distanceMiles !== null ? `${Math.round(t.distanceMiles)} mi` : "—"}</span>
                    <span className="trip-truck">{t.truck?.unitNumber ?? "—"}</span>
                    <span className="trip-save">
                      {t.savingsVsBaselineUsd !== null ? formatCurrency(t.savingsVsBaselineUsd) : "—"}
                    </span>
                    <span className="trip-status">
                      <span className={`tag ${isCurrent ? "tag-outline" : "tag-neutral"}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="trip-pagination">
            <button className="btn btn-ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </button>
            <span>Page {page}</span>
            <button className="btn btn-ghost" onClick={() => setPage((p) => p + 1)} disabled={!hasNextPage}>
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
