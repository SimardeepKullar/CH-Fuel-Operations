import { useInvoicePeriod } from "../hooks/useInvoicePeriod";

/** A7's top-bar period selector — governs Actuals and Analysis. `TopBar`
 * hides this entirely on Plan screens (T-39 DoD) rather than rendering it
 * disabled. */
export default function InvoicePeriodSelector() {
  const { period, setPeriod, periods, loading } = useInvoicePeriod();

  return (
    <span className="topbar-period">
      <span className="topbar-period-label">Invoice period</span>
      <select
        className="input topbar-period-select"
        aria-label="Invoice period"
        value={period ?? ""}
        onChange={(e) => setPeriod(e.target.value)}
        disabled={loading || periods.length === 0}
      >
        {period === null && <option value="">{loading ? "Loading…" : "No invoices imported"}</option>}
        {periods.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    </span>
  );
}
