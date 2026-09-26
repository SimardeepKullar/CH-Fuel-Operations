import type { Disclaimer } from "@ch/core/domain/planResponse";
import Corners from "./Corners";

interface DisclaimersProps {
  items: Disclaimer[];
}

/**
 * UI-DATA-CONTRACT §8: §14 guarantees at least one entry on every completed
 * plan and the design surfaced none of them. `GOOGLE_LINK_NOT_TRUCK_LEGAL`
 * has its own home in the driver-link card (§3.10) — skipped here so it
 * doesn't render twice.
 */
export default function Disclaimers({ items }: DisclaimersProps) {
  const rest = items.filter((d) => d.code !== "GOOGLE_LINK_NOT_TRUCK_LEGAL");
  if (rest.length === 0) return null;

  return (
    <div className="panel-card blueprint disclaimers">
      <Corners />
      <div className="panel-card-title">Disclaimers</div>
      <ul className="disclaimers-list">
        {rest.map((d) => (
          <li key={d.code}>{d.message}</li>
        ))}
      </ul>
    </div>
  );
}
