import type { PlanResponse } from "@ch/core/domain/planResponse";
import type { PriceBasis } from "@ch/core/db/types";
import Corners from "./Corners";
import { useTrucks } from "../hooks/useTrucks";
import type { PlanFormState } from "../lib/planRequestForm";
import { formatGallons } from "../lib/format";

interface DevToolsTabProps {
  form: PlanFormState;
  onChange: (patch: Partial<PlanFormState>) => void;
  plan: PlanResponse | null;
  loading: boolean;
  onApply: () => void;
  applyDisabled: boolean;
}

const PRICE_BASIS_OPTIONS: { value: PriceBasis; label: string }[] = [
  { value: "pump", label: "Pump price (YOUR PRICE)" },
  { value: "ifta_net", label: "Pump price less IFTA credit" },
  { value: "total_cost", label: "Total cost" },
];

const RESET_FIELDS: Partial<PlanFormState> = {
  startFuelGallons: "",
  minArrivalGallons: "",
  maxLegMiles: "",
  minLegMiles: "",
  corridorMiles: "",
  maxDetourMiles: "",
  maxStops: "",
  priceBasis: "pump",
};

/**
 * Every field here now reads/writes real state (T-21). The truck panel
 * (§5.1) previews the mpg/tank spec of whichever real truck Header's
 * fleet-unit selector (`trucks`) has picked (T-56) — there is no second,
 * separate truck field here any more; picking a truck happens in exactly
 * one place.
 */
export default function DevToolsTab({ form, onChange, plan, loading, onApply, applyDisabled }: DevToolsTabProps) {
  const { trucks, loading: trucksLoading, error: trucksError, refetch: refetchTrucks } = useTrucks();
  const selectedTruck = trucks.find((t) => t.id === form.truckId) ?? null;
  const hasCompleteSpec =
    selectedTruck !== null &&
    selectedTruck.tankGallons !== null &&
    selectedTruck.avgMpg !== null &&
    selectedTruck.reserveFraction !== null;

  const startFuel = Number(form.startFuelGallons);
  const hasStartFuel = form.startFuelGallons.trim() !== "" && Number.isFinite(startFuel);
  const rangeOnHandMiles = hasStartFuel && hasCompleteSpec ? startFuel * selectedTruck.avgMpg! : null;
  const startFuelPercent =
    hasStartFuel && hasCompleteSpec ? Math.round((startFuel / selectedTruck.tankGallons!) * 100) : null;

  const completedPlan = plan?.status === "completed" ? plan : null;

  return (
    <section className="dev-grid">
      <div className="panel-card blueprint dev-card">
        <Corners />
        <div className="panel-card-header">
          <div className="panel-card-title">Truck</div>
          <span className="tag tag-outline">{selectedTruck ? `Unit ${selectedTruck.unitNumber}` : "no truck selected"}</span>
        </div>
        <div className="dev-fields">
          {trucksLoading && <div className="dev-hint">Loading trucks…</div>}
          {trucksError && (
            <button className="btn-link load-error" onClick={refetchTrucks}>
              Couldn’t load trucks — retry
            </button>
          )}
          {selectedTruck && !hasCompleteSpec && (
            <div className="dev-hint">Unit {selectedTruck.unitNumber} has no mpg/tank spec set.</div>
          )}
          <div className="field">
            <label>Tank capacity (gal)</label>
            <input className="input" readOnly value={hasCompleteSpec ? selectedTruck.tankGallons!.toFixed(0) : ""} />
          </div>
          <div className="field">
            <label>Fuel economy (mpg)</label>
            <input className="input" readOnly value={hasCompleteSpec ? selectedTruck.avgMpg!.toFixed(1) : ""} />
          </div>
        </div>
        <div className="dev-fields">
          <div className="field">
            <label>Starting fuel (gal)</label>
            <input
              className="input"
              placeholder="tank capacity"
              value={form.startFuelGallons}
              onChange={(e) => onChange({ startFuelGallons: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Starting fuel (%)</label>
            <input className="input" readOnly value={startFuelPercent !== null ? String(startFuelPercent) : ""} />
          </div>
        </div>
        <div className="dev-foot">
          <span>Range on hand ≈ {rangeOnHandMiles !== null ? `${Math.round(rangeOnHandMiles)} mi` : "—"}</span>
          <span>Trip needs {completedPlan ? formatGallons(completedPlan.optimized.totalGallons) : "—"}</span>
        </div>
      </div>

      <div className="panel-card blueprint dev-card">
        <Corners />
        <div className="panel-card-title">Solver defaults</div>
        <div className="dev-fields">
          <div className="field">
            <label>Price feed</label>
            <input className="input" readOnly value="BVD · ULSD CSV import" />
          </div>
          <div className="field">
            <label>Routing engine</label>
            <input className="input" readOnly value="openrouteservice · driving-hgv" />
          </div>
          <div className="field">
            <label>Fuel type</label>
            <input className="input" readOnly value="Diesel" />
          </div>
        </div>
        <div className="dev-foot">
          <span>{completedPlan ? `Last solve ${(completedPlan.solveMs / 1000).toFixed(1)} s` : "Last solve —"}</span>
          <span>{completedPlan ? `${completedPlan.stationsScanned} stations scanned` : "— stations scanned"}</span>
        </div>
      </div>

      <div className="panel-card blueprint dev-wide">
        <Corners />
        <div className="panel-card-title">Constraints and price basis</div>
        <div className="dev-fields-wide">
          <div className="field">
            <label>Search corridor (mi)</label>
            <input
              className="input"
              placeholder="default"
              value={form.corridorMiles}
              onChange={(e) => onChange({ corridorMiles: e.target.value })}
            />
            <div className="dev-hint">
              How far off the route a station may sit to be <em>considered</em> at all — a
              straight-line distance, inflated by each station's own position uncertainty.
            </div>
          </div>
          <div className="field">
            <label>Max detour per stop (mi)</label>
            <input
              className="input"
              aria-label="Max detour per stop (mi)"
              placeholder="no cap"
              value={form.maxDetourMiles}
              onChange={(e) => onChange({ maxDetourMiles: e.target.value })}
            />
            <div className="dev-hint">
              Refuses any ONE station whose actual round-trip drive exceeds this, measured
              after routing — a different number from the corridor above, which only decides
              what gets considered. Blank means no cap.
            </div>
          </div>
          <div className="field">
            <label>Arrival fuel target (gal)</label>
            <input
              className="input"
              placeholder="reserve floor"
              value={form.minArrivalGallons}
              onChange={(e) => onChange({ minArrivalGallons: e.target.value })}
            />
            <div className="dev-hint">
              How much fuel should be aboard at the destination. Blank uses the reserve floor
              below.
            </div>
          </div>
          <div className="field">
            <label>Reserve floor (%)</label>
            <input
              className="input"
              readOnly
              value={hasCompleteSpec ? Math.round(selectedTruck.reserveFraction! * 100).toString() : ""}
            />
            <div className="dev-hint">
              The truck's own setting, editable at <a href="#settings">Settings</a>.
            </div>
          </div>
          <div className="field">
            <label>Max stops</label>
            <input
              className="input"
              aria-label="Max stops"
              placeholder="no limit"
              value={form.maxStops}
              onChange={(e) => onChange({ maxStops: e.target.value })}
            />
            <div className="dev-hint">Blank for no limit.</div>
          </div>
          <div className="field">
            <label>Max leg between fills (mi)</label>
            <input
              className="input"
              placeholder="truck default"
              value={form.maxLegMiles}
              onChange={(e) => onChange({ maxLegMiles: e.target.value })}
            />
            <div className="dev-hint">Hard operational cap. Blank uses the truck's own default.</div>
          </div>
          <div className="field">
            <label>Min leg between fills (mi)</label>
            <input
              className="input"
              placeholder="truck default"
              value={form.minLegMiles}
              onChange={(e) => onChange({ minLegMiles: e.target.value })}
            />
            <div className="dev-hint">Soft — relaxed automatically if the lane needs it.</div>
          </div>
          <div className="field">
            <label>Price basis</label>
            <select
              className="input"
              value={form.priceBasis}
              onChange={(e) => onChange({ priceBasis: e.target.value as PriceBasis })}
            >
              {PRICE_BASIS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="dev-hint">
              These rank stations differently. Which is correct depends on whether CH
              Logistics is IFTA-registered — still an open question.
            </div>
          </div>
        </div>
        <div className="dev-actions">
          <button className="btn btn-primary blueprint" onClick={onApply} disabled={applyDisabled || loading}>
            <Corners />
            {loading ? "Solving…" : "Apply & re-solve"}
          </button>
          <button className="btn btn-ghost" onClick={() => onChange(RESET_FIELDS)}>
            Reset defaults
          </button>
        </div>
      </div>
    </section>
  );
}
