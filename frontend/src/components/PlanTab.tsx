import { useState } from "react";
import type { CandidateStation, CompletedPlanResponse, PlanResponse, PlanStop } from "@ch/core/domain/planResponse";
import Corners from "./Corners";
import RouteMap from "./RouteMap";
import Disclaimers from "./Disclaimers";
import InfeasiblePanel from "./InfeasiblePanel";
import EmptyState from "./EmptyState";
import { usePriceSheets } from "../hooks/usePriceSheets";
import { useSheetStations } from "../hooks/useSheetStations";
import { useTrucks } from "../hooks/useTrucks";
import { ApiError, patchPlan } from "../lib/api";
import {
  formatCurrency,
  formatDistanceMiles,
  formatDuration,
  formatGallons,
  formatPricePerGallon,
} from "../lib/format";

interface PlanTabProps {
  plan: PlanResponse | null;
  loading: boolean;
  error: Error | null;
  originAddress: string;
  destinationAddress: string;
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  /** The real fleet unit (`trucks.id`) — T-38/D22/T-56. `null` = none chosen yet. */
  truckId: string | null;
  onTruckIdChange: (truckId: string | null) => void;
  /** `null` = price against the newest sheet. */
  priceEffectiveOn: string | null;
  onPriceEffectiveOnChange: (value: string | null) => void;
  onPlanRoute: () => void;
  planDisabled: boolean;
}

/** Cheapest-along-route bar width, scaled within this trip's own set. */
function barWidthPercent(price: number, min: number, max: number): number {
  if (max === min) return 70;
  return 45 + ((price - min) / (max - min)) * 50;
}

/**
 * UI-DATA-CONTRACT §3.7: the corridor set (chosen stops + candidates), not
 * just the candidates — the design's own placeholder list overlapped with
 * the chosen stops.
 */
function cheapestAlongRoute(stops: PlanStop[], candidates: CandidateStation[]) {
  const priced = [
    ...stops.map((s) => ({ id: s.station.id, name: s.station.name, unitPriceUsd: s.unitPriceUsd })),
    ...candidates.map((c) => ({ id: c.id, name: c.name, unitPriceUsd: c.unitPriceUsd })),
  ];
  const sorted = [...priced].sort((a, b) => a.unitPriceUsd - b.unitPriceUsd).slice(0, 5);
  const prices = sorted.map((s) => s.unitPriceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return sorted.map((s) => ({ ...s, widthPercent: barWidthPercent(s.unitPriceUsd, min, max) }));
}

function formatEffectiveOn(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${dateStr}T00:00:00Z`),
  );
}

/**
 * UI-DATA-CONTRACT §3.5: "within the leg bounds" is false whenever §5.1's
 * relaxation pass ran. `MIN_LEG_RELAXED`'s own message already names the
 * floor and every short leg (`buildDisclaimers`) — reused here rather than a
 * second, generic "leg floor relaxed" string that doesn't say which legs.
 */
function stopsSubCaption(plan: CompletedPlanResponse): string {
  const relaxed = plan.disclaimers.find((d) => d.code === "MIN_LEG_RELAXED");
  return relaxed ? relaxed.message : "within the leg bounds";
}

/**
 * UI-DATA-CONTRACT §3.5: "excludes time at the pump" is only true if
 * `driveSeconds` really is drive-only — checkable now that T-18 separated
 * `dwellSeconds` out. Names the excluded amount instead of just asserting it.
 */
function drivingTimeSubCaption(plan: CompletedPlanResponse): string {
  return plan.optimized.dwellSeconds > 0
    ? `excludes ${formatDuration(plan.optimized.dwellSeconds)} at the pump`
    : "excludes time at the pump";
}

/**
 * `savingsVsBaselineUsd` can go negative (a heavily-detoured plan can cost
 * more in fuel than the naive baseline) — the label carries the sign
 * instead of the value, so the figure itself never needs a leading `-`
 * (avoids stacking a literal one in front of `formatCurrency`'s own).
 */
function savedLabel(savingsVsBaselineUsd: number): string {
  return savingsVsBaselineUsd >= 0 ? "Saved" : "Lost";
}

/** §14's geocode failure (422) and provider outage (502) read identically as `error.message` today. */
function errorDisplay(error: Error): { title: string; detail: string } {
  if (error instanceof ApiError && error.status === 422) {
    return { title: "Couldn’t locate that address", detail: error.detail ?? error.message };
  }
  if (error instanceof ApiError && error.status === 502) {
    return {
      title: "Routing service unavailable",
      detail: "The routing provider didn’t respond. Try again in a moment.",
    };
  }
  if (error instanceof ApiError && error.status === 429) {
    return { title: "Too many requests", detail: error.detail ?? error.message };
  }
  return { title: "Couldn’t plan this route", detail: error.message };
}

export default function PlanTab({
  plan,
  loading,
  error,
  originAddress,
  destinationAddress,
  onOriginChange,
  onDestinationChange,
  truckId,
  onTruckIdChange,
  priceEffectiveOn,
  onPriceEffectiveOnChange,
  onPlanRoute,
  planDisabled,
}: PlanTabProps) {
  const [showCandidates, setShowCandidates] = useState(false);
  const [showSheetStations, setShowSheetStations] = useState(false);
  const [hoveredCheapestId, setHoveredCheapestId] = useState<string | null>(null);
  const [sentToDriverOverride, setSentToDriverOverride] = useState<{ planId: string; value: boolean } | null>(null);
  const { sheets, error: sheetsError, refetch: refetchSheets } = usePriceSheets();
  const { trucks, loading: trucksLoading, error: trucksError, refetch: refetchTrucks } = useTrucks();

  const newestEffectiveOn = sheets[0]?.effectiveOn ?? null;
  const selectedEffectiveOn = priceEffectiveOn ?? newestEffectiveOn;
  const isToday = priceEffectiveOn === null || priceEffectiveOn === newestEffectiveOn;
  const selectedSheet = sheets.find((s) => s.effectiveOn === selectedEffectiveOn) ?? null;

  const completedPlan = plan?.status === "completed" ? plan : null;
  const infeasiblePlan = plan?.status === "infeasible" ? plan : null;
  const cheapest = completedPlan ? cheapestAlongRoute(completedPlan.stops, completedPlan.candidateStations) : [];

  // Fetched here, not in RouteMap, so this button's own count can be the
  // real number the layer draws rather than the unrelated whole-sheet total
  // (T-23 follow-up). Every resolved station, not scoped to this plan's
  // route — the map's viewport is what actually limits what's visible.
  const {
    stations: sheetStations,
    loading: sheetStationsLoading,
    error: sheetStationsError,
    refetch: refetchSheetStations,
  } = useSheetStations();

  const sentToDriver =
    completedPlan && sentToDriverOverride?.planId === completedPlan.planId
      ? sentToDriverOverride.value
      : (completedPlan?.sentToDriver ?? false);

  async function toggleSentToDriver() {
    if (!completedPlan) return;
    const next = !sentToDriver;
    const planId = completedPlan.planId;
    setSentToDriverOverride({ planId, value: next });
    try {
      await patchPlan(planId, { sentToDriver: next });
    } catch {
      setSentToDriverOverride({ planId, value: !next });
    }
  }

  const errorInfo = error ? errorDisplay(error) : null;

  return (
    <section className="plan-grid">
      <div className="plan-left">
        {completedPlan && (
          <div className="plan-tags">
            <span className="tag tag-neutral">Diesel</span>
            <span className="tag tag-accent">{completedPlan.planId}</span>
          </div>
        )}
        <RouteMap
          plan={completedPlan}
          showCandidates={showCandidates}
          showSheetStations={showSheetStations}
          sheetStations={sheetStations}
          hoveredStationId={hoveredCheapestId}
          loading={loading}
        />

        <div className="route-form">
          <div className="field">
            <label>Source</label>
            <input
              className="input"
              aria-label="Source"
              value={originAddress}
              onChange={(e) => onOriginChange(e.target.value)}
              placeholder="City, State"
            />
          </div>
          <div className="field">
            <label>Destination</label>
            <input
              className="input"
              aria-label="Destination"
              value={destinationAddress}
              onChange={(e) => onDestinationChange(e.target.value)}
              placeholder="City, State"
            />
          </div>
          <div className="field field-truck">
            <label>Truck</label>
            <select
              className="input truck-select"
              value={truckId ?? ""}
              onChange={(e) => onTruckIdChange(e.target.value === "" ? null : e.target.value)}
              disabled={trucksLoading}
              aria-label="Truck"
            >
              <option value="">{trucksLoading ? "Loading…" : "Select truck"}</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.unitNumber}
                </option>
              ))}
            </select>
            {trucksError && (
              <button className="btn-link load-error" onClick={refetchTrucks}>
                Couldn’t load trucks — retry
              </button>
            )}
          </div>
          <button className="btn btn-primary blueprint" onClick={onPlanRoute} disabled={planDisabled || loading}>
            <Corners />
            {loading ? "Planning…" : "Plan route"}
          </button>
        </div>

        {errorInfo && (
          <div className="plan-error" role="alert">
            <div className="plan-error-title">{errorInfo.title}</div>
            <p>{errorInfo.detail}</p>
          </div>
        )}
        {infeasiblePlan && (
          <InfeasiblePanel reason={infeasiblePlan.reason} candidateStations={infeasiblePlan.candidateStations} />
        )}
        {!plan && !loading && !error && (
          <div className="plan-empty">Enter a source and destination, then Plan route.</div>
        )}

        {completedPlan && (
          <div className="stat-grid">
            <div className="stat-cell">
              <span className="stat-label">Fuel cost</span>
              <span className="stat-value">{formatCurrency(completedPlan.optimized.totalFuelCostUsd)}</span>
              <span className="stat-sub">{formatGallons(completedPlan.optimized.totalGallons)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">{savedLabel(completedPlan.optimized.savingsVsBaselineUsd)}</span>
              <span className="stat-value stat-value-accent">
                {formatCurrency(Math.abs(completedPlan.optimized.savingsVsBaselineUsd))}
              </span>
              <span className="stat-sub">vs the corridor baseline</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Distance</span>
              <span className="stat-value">
                {completedPlan.optimized.distanceMiles.toFixed(1)} <span className="stat-unit">mi</span>
              </span>
              <span className="stat-sub">
                +{completedPlan.optimized.addedDistanceMiles.toFixed(1)} mi of detour · direct{" "}
                {completedPlan.baseline.distanceMiles.toFixed(1)} mi
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Driving time</span>
              <span className="stat-value">{formatDuration(completedPlan.optimized.driveSeconds)}</span>
              <span className="stat-sub">{drivingTimeSubCaption(completedPlan)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Stops</span>
              <span className="stat-value">{completedPlan.stops.length}</span>
              <span className="stat-sub">{stopsSubCaption(completedPlan)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Detour cost</span>
              <span className="stat-value stat-value-muted">{formatCurrency(completedPlan.optimized.detourCostUsd)}</span>
              <span className="stat-sub">driver pay only, {formatCurrency(completedPlan.optimized.costPerMile)}/mi</span>
            </div>
          </div>
        )}

        {completedPlan && <Disclaimers items={completedPlan.disclaimers} />}
      </div>

      <div className={`plan-right${isToday ? "" : " sheet-archived"}`}>
        <div className="sheet-bar">
          <div className="sheet-bar-select">
            <span className="stat-label">Fuel prices effective</span>
            <select
              className="input sheet-date"
              aria-label="Fuel prices effective"
              value={selectedEffectiveOn ?? ""}
              onChange={(e) =>
                onPriceEffectiveOnChange(e.target.value === newestEffectiveOn ? null : e.target.value)
              }
            >
              {sheets.map((s) => (
                <option key={s.effectiveOn} value={s.effectiveOn}>
                  {formatEffectiveOn(s.effectiveOn)}
                </option>
              ))}
            </select>
          </div>
          {sheetsError ? (
            <button className="btn-link load-error" onClick={refetchSheets}>
              Couldn’t load price sheets — retry
            </button>
          ) : (
            <span className="sheet-note">
              {selectedSheet
                ? isToday
                  ? `Daily price CSV loaded · ${selectedSheet.stationCount} stations`
                  : "Archived sheet — not today’s prices. Historical reference only."
                : "No price sheet imported yet."}
            </span>
          )}
        </div>

        <div className="panel-card blueprint sheet-card">
          <Corners />
          <div className="panel-card-title">Cheapest along route · $/gal</div>
          <div className="price-bars">
            {cheapest.length === 0 && <EmptyState title="No priced stops yet." detail="No candidates found in this corridor." />}
            {cheapest.map((c) => (
              <div
                className={`price-bar-row${hoveredCheapestId === c.id ? " hovered" : ""}`}
                key={c.id}
                onMouseEnter={() => setHoveredCheapestId(c.id)}
                onMouseLeave={() => setHoveredCheapestId((id) => (id === c.id ? null : id))}
              >
                <span>{c.name}</span>
                <div className="price-bar-track" style={{ width: `${c.widthPercent}%` }} />
                <span>{formatPricePerGallon(c.unitPriceUsd, 2)}</span>
              </div>
            ))}
          </div>
          <div className="map-toggles">
            <button
              className="btn-secondary-flat"
              onClick={() => setShowSheetStations((v) => !v)}
              disabled={!showSheetStations && sheetStationsError !== null}
            >
              {showSheetStations
                ? "Hide all sheet stations on map"
                : sheetStationsLoading
                  ? "Show all sheet stations on map…"
                  : sheetStationsError
                    ? "Show all sheet stations on map"
                    : `Show all sheet stations on map (${sheetStations.length})`}
            </button>
            {sheetStationsError && (
              <button className="btn-link load-error" onClick={refetchSheetStations}>
                Couldn’t load sheet stations — retry
              </button>
            )}
            <button className="btn-secondary-flat-amber" onClick={() => setShowCandidates((v) => !v)}>
              {showCandidates
                ? "Hide in-corridor not selected"
                : `Show in-corridor not selected (${completedPlan?.candidateStations.length ?? 0})`}
            </button>
          </div>
        </div>

        <div className="panel-card blueprint sheet-card">
          <Corners />
          <div className="panel-card-header">
            <div className="panel-card-title">Recommended order</div>
            <span className="panel-card-sub">price + detour + hours</span>
          </div>
          <div className="stop-list">
            {completedPlan && completedPlan.stops.length === 0 && (
              <div className="stop-list-empty">No stops needed.</div>
            )}
            {(completedPlan?.stops ?? []).map((stop, i) => (
              <div key={stop.seq} className={`stop-row${i === 0 ? " top blueprint" : ""}`}>
                {i === 0 && <Corners />}
                <span className="stop-rank">{stop.seq}</span>
                <div>
                  <div className="stop-title">
                    {stop.station.name} · mi {Math.round(stop.cumulativeDistanceMiles)}
                  </div>
                  <div className="stop-sub">
                    {formatDistanceMiles(stop.detourMiles)} detour · {formatGallons(stop.purchaseGallons)}
                  </div>
                </div>
                <span className="stop-price">{formatPricePerGallon(stop.unitPriceUsd, 2)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-card blueprint driver-link">
          <Corners />
          <div className="panel-card-header">
            <span className="panel-card-title">Driver route link</span>
            <span className="panel-card-sub">stops in order</span>
          </div>
          <div className="driver-link-row">
            <input className="input driver-link-url" value={completedPlan?.googleMapsUrl ?? ""} readOnly />
            <a
              className="btn btn-primary blueprint"
              href={completedPlan?.googleMapsUrl ?? "#"}
              target="_blank"
              rel="noopener"
              aria-disabled={!completedPlan}
            >
              <Corners />
              Open
            </a>
            <button
              className="btn btn-ghost"
              onClick={() => completedPlan && navigator.clipboard?.writeText(completedPlan.googleMapsUrl)}
            >
              Copy
            </button>
          </div>
          <span className="driver-link-note">
            {completedPlan?.disclaimers.find((d) => d.code === "GOOGLE_LINK_NOT_TRUCK_LEGAL")?.message ??
              "Send to the driver — opens turn-by-turn with every recommended stop as a waypoint."}
          </span>
          <label className="driver-link-sent">
            <input
              type="checkbox"
              aria-label="Sent to driver"
              checked={sentToDriver}
              disabled={!completedPlan}
              onChange={() => void toggleSentToDriver()}
            />
            Sent to driver
          </label>
        </div>
      </div>
    </section>
  );
}
