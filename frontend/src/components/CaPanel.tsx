import type { OverviewSide } from "@ch/core/actuals/overview";
import { formatMoneyGrouped, formatPriceGrouped, formatQtyGrouped } from "../lib/formatMoney";
import { taxLabel } from "../lib/overviewTax";
import KpiCard from "./KpiCard";
import SidePanel from "./SidePanel";

interface CaPanelProps {
  side: OverviewSide;
  /** "Invoice 999217 · Sep 3–10", when the week's CA invoice is known. */
  invoiceLine: string | null;
  /** The printed-range callout, when it is not the transactions' range. */
  headerNote?: string;
  /** Transactions, scoped to this invoice's flagged stops. */
  anomaliesHref: string;
  onOpen: (href: string) => void;
}

/**
 * The CA side of the week (T-65, D28): the billed price with tax as the headline,
 * the pre-tax rate under it, and each spend figure with tax and the tax amount bottom right.
 * Everything stays in CAD (D25) and in the unit the toggle chose; the toggle never
 * changes money.
 */
export default function CaPanel({ side, invoiceLine, headerNote, anomaliesHref, onOpen }: CaPanelProps) {
  const { kpis, currency, qtyUnit } = side;
  const label = taxLabel(kpis.tax);
  const money = (n: number) => formatMoneyGrouped(n, currency);
  const taxAmount = (tax: number) => `${formatQtyGrouped(tax)} ${label}`;
  const receiptPct =
    kpis.receiptCompliance.total > 0 ? Math.round((kpis.receiptCompliance.confirmed / kpis.receiptCompliance.total) * 100) : null;

  return (
    <SidePanel
      badge="CA"
      title="Canada"
      subtitle={`${invoiceLine === null ? "" : `${invoiceLine} · `}${currency}, incl. ${label}`}
      accent="ca"
      headerNote={headerNote}
      testId="ca-panel"
      ariaLabel="CA"
    >
      <KpiCard
        flat
        dominant
        label={`Billed price, with ${label}`}
        value={kpis.avgBilledPerUnit === null ? "—" : formatPriceGrouped(kpis.avgBilledPerUnit, currency)}
        unit={`/ ${qtyUnit}`}
        sub={
          kpis.avgBilledPreTaxPerUnit === null
            ? undefined
            : `${formatPriceGrouped(kpis.avgBilledPreTaxPerUnit, currency)} / ${qtyUnit} before ${label}`
        }
        testId="ca-avg-billed"
      />
      <KpiCard
        flat
        dominant
        label="Total spend"
        value={money(kpis.tax.withTax)}
        sub="Diesel + DEF + other charges"
        cornerBottom={taxAmount(kpis.tax.tax)}
        testId="ca-total"
      />
      <KpiCard
        flat
        label="Diesel"
        value={money(kpis.diesel.amount)}
        sub={`${formatQtyGrouped(kpis.diesel.qty)} ${qtyUnit}`}
        cornerBottom={taxAmount(kpis.diesel.tax)}
        testId="ca-diesel"
      />
      <KpiCard
        flat
        label="DEF"
        value={money(kpis.def.amount)}
        sub={`${formatQtyGrouped(kpis.def.qty)} ${qtyUnit}`}
        cornerBottom={taxAmount(kpis.def.tax)}
        testId="ca-def"
      />
      <KpiCard flat label="Discount captured" value={money(kpis.discount.total)} sub="Before tax" testId="ca-discount" />
      <KpiCard flat label="Other charges" value={money(kpis.otherCharges.total)} sub="Scale, express and fees" testId="ca-other" />
      <KpiCard
        flat
        label="Receipt compliance"
        value={receiptPct === null ? "—" : `${receiptPct}%`}
        tone={receiptPct === 0 ? "bad" : undefined}
        sub={`${kpis.receiptCompliance.confirmed} of ${kpis.receiptCompliance.total} confirmed`}
        testId="ca-receipts"
      />
      <KpiCard
        flat
        label="Anomalies flagged"
        value={String(kpis.anomaliesFlagged)}
        tone={kpis.anomaliesFlagged > 0 ? "warn" : undefined}
        sub="Review in Transactions"
        href={anomaliesHref}
        onOpen={onOpen}
        testId="ca-anomalies"
      />
    </SidePanel>
  );
}
