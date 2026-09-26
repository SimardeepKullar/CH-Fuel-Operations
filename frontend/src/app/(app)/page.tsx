"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PlanTab from "../../components/PlanTab";
import DevToolsTab from "../../components/DevToolsTab";
import { usePlan } from "../../hooks/usePlan";
import { buildCreatePlanRequest, EMPTY_PLAN_FORM, type PlanFormState } from "../../lib/planRequestForm";

/**
 * New Plan (T-21…T-23's Plan tab, re-hosted by T-39 — behaviour unchanged).
 *
 * Dev Tools (v1's third tab) has no destination in A7's sidebar and no
 * mention in T-39's own DoD — dropping it silently would lose the only way
 * to exercise the solver's constraint inputs by hand. It stays on this same
 * page as a collapsible section instead of a separate nav destination: it
 * edits the same `PlanFormState` this page already owns, so keeping it here
 * needs no new state-sharing mechanism across routes.
 */
export default function NewPlanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<PlanFormState>(EMPTY_PLAN_FORM);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const { plan, loading, error, createPlan, loadPlan } = usePlan();

  const patchForm = useCallback((patch: Partial<PlanFormState>) => {
    setForm((f) => ({ ...f, ...patch }));
  }, []);

  // A plan opened from `/plans` arrives as `?planId=` (D15's route split
  // replaces the old single-page tab switch — Plans is now a separate
  // route, so it navigates here rather than flipping local tab state).
  useEffect(() => {
    const planId = searchParams.get("planId");
    if (planId) {
      void loadPlan(planId);
      router.replace("/");
    }
    // Intentionally runs once per navigation into this page with a
    // `planId`, not on every `loadPlan`/`router` identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // `null` whenever a required field (addresses, truck) is still unset —
  // doubles as the "Plan route" / "Apply & re-solve" disabled state.
  const request = useMemo(() => buildCreatePlanRequest(form), [form]);

  function planRoute() {
    if (!request) return;
    void createPlan(request);
  }

  return (
    <div className="new-plan-page">
      <PlanTab
        plan={plan}
        loading={loading}
        error={error}
        originAddress={form.originAddress}
        destinationAddress={form.destinationAddress}
        onOriginChange={(originAddress) => patchForm({ originAddress })}
        onDestinationChange={(destinationAddress) => patchForm({ destinationAddress })}
        truckId={form.truckId}
        onTruckIdChange={(truckId) => patchForm({ truckId })}
        priceEffectiveOn={form.priceEffectiveOn}
        onPriceEffectiveOnChange={(priceEffectiveOn) => patchForm({ priceEffectiveOn })}
        onPlanRoute={planRoute}
        planDisabled={request === null}
      />

      <button
        type="button"
        className="dev-tools-toggle"
        aria-expanded={devToolsOpen}
        onClick={() => setDevToolsOpen((v) => !v)}
      >
        {devToolsOpen ? "Hide Dev Tools" : "Dev Tools"}
      </button>

      {devToolsOpen && (
        <DevToolsTab
          form={form}
          onChange={patchForm}
          plan={plan}
          loading={loading}
          onApply={planRoute}
          applyDisabled={request === null}
        />
      )}
    </div>
  );
}
