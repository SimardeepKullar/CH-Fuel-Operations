import type { ReactNode } from "react";

interface SidePanelProps {
  /** "US", "CA" — the square badge. */
  badge: string;
  title: string;
  subtitle: string;
  /** Navy for the US side, cyan for CA. */
  accent: "us" | "ca";
  /** Amber callout in the header corner — the printed range is not the transactions'. */
  headerNote?: string;
  testId: string;
  ariaLabel: string;
  children: ReactNode;
}

/** The frame the US and CA sides of the Overview share (T-65): badge, title, one-line subtitle, then a grid of tiles. */
export default function SidePanel({ badge, title, subtitle, accent, headerNote, testId, ariaLabel, children }: SidePanelProps) {
  return (
    <section className="side-panel" data-accent={accent} data-testid={testId} aria-label={ariaLabel}>
      <header className="side-panel-head">
        <span className="side-badge" aria-hidden="true">
          {badge}
        </span>
        <div className="side-panel-titles">
          <h2 className="side-panel-title">{title}</h2>
          <span className="side-panel-sub">{subtitle}</span>
        </div>
        {headerNote !== undefined && (
          <span className="side-panel-note" data-testid={`${testId}-note`}>
            {headerNote}
          </span>
        )}
      </header>
      <div className="side-grid">{children}</div>
    </section>
  );
}
