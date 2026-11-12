-- T-128: an invoice's Manual Transactions section. BVD enters these by hand
-- rather than through a card or an express code; the one seen so far is a
-- credit (real invoice 854048, -11,400.00) that nets an advance out of the
-- grand total. Money is as printed, in the invoice's currency, and may be
-- negative (D25). Written only when an invoice is promoted, like
-- fuel_stops and express_charges; a quarantined invoice has none.
--
-- Identical in migrations/synthetic and migrations/real.

CREATE TABLE manual_transactions (
  id          bigserial PRIMARY KEY,
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  amount      numeric(12,2) NOT NULL,
  fee         numeric(12,2) NOT NULL,
  -- amount + fee, checked exactly at import. Ties to the printed "Manual"
  -- total, together with any cash (C) lines.
  total       numeric(12,2) NOT NULL,
  -- BVD's own words, verbatim.
  description text,
  CHECK (amount + fee = total)
);

CREATE INDEX manual_transactions_invoice_id_idx ON manual_transactions (invoice_id);
