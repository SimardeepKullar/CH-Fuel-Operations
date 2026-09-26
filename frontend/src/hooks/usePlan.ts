import { useCallback, useState } from "react";
import type { CreatePlanRequest, PlanResponse } from "@ch/core/domain/planResponse";
import { createPlan as postPlan, getPlan as fetchPlan } from "../lib/api";

export interface UsePlanResult {
  plan: PlanResponse | null;
  loading: boolean;
  error: Error | null;
  /** `POST /plans`. Resolves the new plan and stores it; also returned so a caller can act without waiting on a re-render. */
  createPlan: (body: CreatePlanRequest) => Promise<PlanResponse | null>;
  /** `GET /plans/{id}` — opening a plan from the Recent tab. */
  loadPlan: (planId: string) => Promise<void>;
}

/** Owns the single "current plan" shown on the Plan tab — created live or reopened from Recent. */
export function usePlan(): UsePlanResult {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createPlan = useCallback(async (body: CreatePlanRequest) => {
    setLoading(true);
    setError(null);
    try {
      const response = await postPlan(body);
      setPlan(response);
      return response;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPlan = useCallback(async (planId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchPlan(planId);
      setPlan(response);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  return { plan, loading, error, createPlan, loadPlan };
}
