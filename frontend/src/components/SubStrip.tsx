import type { ButtonHTMLAttributes, ReactNode } from "react";

/** The white strip under a banner: an uppercase label then chips and ghost buttons. */
export function SubStrip({ label, children, testId }: { label: string; children?: ReactNode; testId?: string }) {
  return (
    <div className="ss" data-testid={testId}>
      <span className="ss-label">{label}</span>
      {children}
    </div>
  );
}

/** A chip in the strip. `absent` is the dashed, muted variant for a missing side. */
export function StripChip({ children, absent, testId }: { children: ReactNode; absent?: boolean; testId?: string }) {
  return (
    <span className={absent ? "ss-chip ss-chip-absent" : "ss-chip"} data-testid={testId}>
      {children}
    </span>
  );
}

/** The `US` / `CA` code badge inside a chip. */
export function CodeBadge({ code, absent, small }: { code: "US" | "CA"; absent?: boolean; small?: boolean }) {
  const tone = absent ? "ss-badge-absent" : code === "US" ? "ss-badge-us" : "ss-badge-ca";
  return <b className={`ss-badge ${tone}${small ? " ss-badge-small" : ""}`}>{code}</b>;
}

export function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className="ss-ghost" />;
}
