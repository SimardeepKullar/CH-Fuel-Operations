import type { InvoiceCurrency } from "@ch/core/db/types";
import { SIDE_FLAGS, SIDE_LABELS } from "../lib/weeks";

/** The tag under a row's date naming the invoice it came from and its country:
 * `🇨🇦 999217`. A row carries the currency it was billed in (`invoiceCurrency`,
 * which a conversion leaves alone — T-66), and a week holds one imported invoice
 * per currency (D26), so that currency names it. Transactions shows it under All
 * invoices; the Receipt Queue on every row. */
export default function InvoiceTag({ currency, invoiceNumber }: { currency: InvoiceCurrency; invoiceNumber: string }) {
  return (
    <span className="tx-invoice-tag" data-currency={currency} data-testid="tx-invoice-tag">
      <span role="img" aria-label={SIDE_LABELS[currency]}>
        {SIDE_FLAGS[currency]}
      </span>{" "}
      {invoiceNumber}
    </span>
  );
}
