import type { CandidateStation, InfeasibleReason, InfeasibleSuggestion } from "@ch/core/domain/planResponse";
import { formatDistanceMiles, formatPricePerGallon } from "../lib/format";

interface InfeasiblePanelProps {
  reason: InfeasibleReason;
  /** Still returned on an infeasible plan (§14) — lets the dispatcher fall back to judgement. */
  candidateStations: CandidateStation[];
}

function suggestionLabel(suggestion: InfeasibleSuggestion): string {
  switch (suggestion.action) {
    case "increaseDetour":
      return `Allow a larger detour per stop — up to ${formatDistanceMiles(suggestion.maxDetourMiles)}.`;
    case "increaseMaxLeg":
      return `Allow a longer leg between fills — up to ${formatDistanceMiles(suggestion.maxLegMiles)}.`;
    case "allowOffNetworkStop":
      return suggestion.note;
  }
}

function gapLine(reason: InfeasibleReason): string | null {
  if (reason.gapMiles === undefined) return null;
  const span =
    reason.gapStartMile !== undefined && reason.gapEndMile !== undefined
      ? ` between mile ${Math.round(reason.gapStartMile)} and mile ${Math.round(reason.gapEndMile)}`
      : "";
  return `Gap of ${formatDistanceMiles(reason.gapMiles)}${span}, against a ${formatDistanceMiles(reason.maxLegMiles)} leg cap.`;
}

/**
 * UI-DATA-CONTRACT §8 / BUILD-PLAN 23.1: an infeasible plan returns a
 * structured reason with gap miles, suggestions, and the candidates the
 * corridor still found — a rich payload that previously had nowhere to go
 * beyond `reason.message`.
 */
export default function InfeasiblePanel({ reason, candidateStations }: InfeasiblePanelProps) {
  const gap = gapLine(reason);

  return (
    <div className="plan-infeasible">
      <div className="plan-infeasible-title">No feasible plan</div>
      <p className="plan-infeasible-message">{reason.message}</p>

      {gap && <div className="plan-infeasible-gap">{gap}</div>}

      {reason.suggestions.length > 0 && (
        <div className="plan-infeasible-suggestions">
          <div className="plan-infeasible-subtitle">Try instead</div>
          <ul>
            {reason.suggestions.map((s, i) => (
              <li key={i}>{suggestionLabel(s)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="plan-infeasible-candidates">
        <div className="plan-infeasible-subtitle">Corridor candidates found</div>
        {candidateStations.length === 0 ? (
          <div className="plan-infeasible-candidates-empty">No stations found in the corridor.</div>
        ) : (
          <ul>
            {candidateStations.map((c) => (
              <li key={c.id}>
                <span className="plan-infeasible-candidate-name">
                  {c.name} · {c.city}, {c.state}
                </span>
                <span className="plan-infeasible-candidate-detail">
                  {formatPricePerGallon(c.unitPriceUsd, 2)}/gal · mi {Math.round(c.distanceAlongRouteMiles)} ·{" "}
                  {formatDistanceMiles(c.detourMiles)} detour
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
