-- Actuals schema: the backward-looking half of the app — fleet reference data,
-- BVD invoices, the fuel stops and express charges parsed from them, the
-- receipt queue, anomalies, and the plan-vs-actual match. See
-- PROJECT-SCOPE-v2.md §A11 for the design this mirrors.
--
-- Depends on 0001_planning_schema.sql (users, trucks, stations, plans,
-- plan_stops); nothing there references anything here. `trucks` (T-56, one
-- row per real fleet unit) lives in 0001, not here, because `routes`/`plans`
-- need it first — truck_assignments/fuel_stops/express_charges below
-- reference that same table. Schema only: required config is seeded by
-- 0004, this company's roster by 0005.

-- Needed for truck_assignments' EXCLUDE constraint below: it compares
-- driver_id with '=' inside a GiST index, which plain btree-only equality
-- can't do.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── Reference layer (shared by both halves) ────────────────────────────

CREATE TABLE drivers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','inactive')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Invoice driver names are free text (A6.6); this is the join back to a
-- driver record. alias_normalized is the primary key rather than a surrogate
-- id — it is the natural key a lookup is keyed on, same reasoning as
-- product_codes (§12).
CREATE TABLE driver_aliases (
  alias_normalized text PRIMARY KEY,
  driver_id        uuid NOT NULL REFERENCES drivers(id),
  source           text NOT NULL,
  confirmed_at     timestamptz
);

-- A card is permanently 1:1 with a driver — it does not get reassigned
-- between drivers. A lost card is a new row (new card_number), never a
-- repointed driver_id on the old one, so this link needs no date range.
CREATE TABLE fuel_cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_number text NOT NULL UNIQUE,
  supplier    text NOT NULL DEFAULT 'BVD',
  driver_id   uuid REFERENCES drivers(id),
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- At most one active card per driver at a time; a replaced card is
-- deactivated, not deleted, so its history stays attached to the driver.
CREATE UNIQUE INDEX fuel_cards_one_active_per_driver ON fuel_cards (driver_id)
  WHERE status = 'active' AND driver_id IS NOT NULL;

-- Effective-dated: a truck reassignment (e.g. a repair swap) must not
-- retroactively change how past transactions resolve. effective_to = NULL
-- means "current". The EXCLUDE constraint is the overlap guard — one driver
-- cannot be in two trucks at once, enforced by the database, not application
-- code. Keyed on driver_id, not card_id: the card is permanent (fuel_cards
-- above), the truck is what occasionally changes.
CREATE TABLE truck_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      uuid NOT NULL REFERENCES drivers(id),
  truck_id       uuid NOT NULL REFERENCES trucks(id),
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  EXCLUDE USING gist (
    driver_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);

CREATE INDEX truck_assignments_driver ON truck_assignments (driver_id, effective_from);

-- ─── Invoice layer ───────────────────────────────────────────────────────

-- invoice_number and file_sha256 catch different mistakes: the hash catches
-- the same file twice, the number catches a *different* file claiming an
-- invoice already imported — a corrected re-send, which needs a human
-- decision rather than a silent second row (A11).
--
-- Every quantity and money column on the invoice layer is stored as BVD
-- printed it, in the invoice's own currency and unit (D25): a CA invoice
-- is litres, CAD per litre and CAD; a US invoice gallons, USD per gallon and
-- USD. Hence no unit or currency suffix on any of those columns — currency
-- and qty_unit here say which, and conversion happens only at the API. An
-- invoice is single-currency (D24): CUR reads US or CN on every row.
CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  text NOT NULL UNIQUE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  -- D26: the week this invoice belongs to, so a US and a CA invoice for the
  -- same week pair up even though their printed starts differ. Defaults at
  -- import to the printed period_end; the Import screen can move it. The
  -- printed start/end above stay as printed; actual_start/actual_end are the
  -- first and last transaction's UTC date (NULL on a file with none).
  billing_week_end date NOT NULL,
  actual_start    date,
  actual_end      date,
  invoice_date    date NOT NULL,
  due_date        date NOT NULL,
  currency        text NOT NULL CHECK (currency IN ('USD','CAD')),
  qty_unit        text NOT NULL CHECK (qty_unit IN ('gal','L')),
  grand_total     numeric(12,2) NOT NULL,
  status          text NOT NULL
                    CHECK (status IN ('quarantined','imported')),
  file_sha256     char(64) NOT NULL UNIQUE,
  imported_at     timestamptz NOT NULL DEFAULT now()
);

-- Two imported invoices of one currency in one week is a 409, not a silent
-- merge (D26). Imported only: a quarantined invoice has no child rows and
-- must not claim a week from the invoice that replaces it.
CREATE UNIQUE INDEX invoices_billing_week_currency
  ON invoices (billing_week_end, currency)
  WHERE status = 'imported';

-- The reconciliation target: parsed rows sum to the printed grand total per
-- product code (A8.2).
CREATE TABLE invoice_totals (
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_code   text NOT NULL,
  qty            numeric(10,2) NOT NULL,
  -- Final AMT as printed: tax included.
  amount         numeric(12,2) NOT NULL,
  -- BVD's own printed Disc AMT for the product code, trusted as given (like
  -- YOUR PRICE): qty * (retail - billed) off the 4dp line columns drifts
  -- from it by cents. NULL for the scale row, which prints no discount.
  discount       numeric(12,2),
  -- Pre Tax AMT as printed; NULL where the totals row prints only a final
  -- amount. The four tax columns are as printed and zero on a US invoice;
  -- pre_tax_amount + hst + gst + pst + qst = amount (T-28, T-61).
  pre_tax_amount numeric(12,2),
  hst            numeric(12,2) NOT NULL DEFAULT 0,
  gst            numeric(12,2) NOT NULL DEFAULT 0,
  pst            numeric(12,2) NOT NULL DEFAULT 0,
  qst            numeric(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (invoice_id, product_code)
);

-- One row per base auth code (a "fuel stop"); the product lines that make up
-- its total live in fuel_stop_lines. unit_raw / driver_name_raw are what the
-- driver actually entered; driver_id resolves from the card (fuel_cards.
-- driver_id) and truck_id from that driver's truck_assignments — both may be
-- null when resolution fails (T-29).
CREATE TABLE fuel_stops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  base_auth_code  text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  card_id         uuid NOT NULL REFERENCES fuel_cards(id),
  truck_id        uuid REFERENCES trucks(id),
  driver_id       uuid REFERENCES drivers(id),
  unit_raw        text NOT NULL,
  driver_name_raw text NOT NULL,
  station_id      uuid REFERENCES stations(id),
  total           numeric(12,2) NOT NULL,
  receipt_status  text NOT NULL DEFAULT 'pending'
                    CHECK (receipt_status IN ('pending','confirmed','missing')),

  UNIQUE (invoice_id, base_auth_code)
);

-- GET /transactions sorts newest-first, tie-broken on id so pagination is
-- stable. The column order matches that ORDER BY so the planner can walk the
-- index instead of sorting. A bare index registers no pg_constraint row, so
-- it is invisible to the drift check in backend/src/db/schema.ts.
CREATE INDEX fuel_stops_occurred_at_id ON fuel_stops (occurred_at DESC, id);

-- billed_per_unit is numeric(9,4): 4dp must survive a round trip
-- (5.2395 in, 5.2395 out, never rounded to 5.24). Never derive the stop total
-- by summing only diesel — total on fuel_stops is the printed figure.
-- qty and the per-unit prices are in the invoice's qty_unit and currency
-- (D25); the billed price includes any sales tax, so qty * billed = amount.
CREATE TABLE fuel_stop_lines (
  id                   bigserial PRIMARY KEY,
  fuel_stop_id         uuid NOT NULL REFERENCES fuel_stops(id) ON DELETE CASCADE,
  product_code         text NOT NULL,
  qty                  numeric(8,2) NOT NULL,
  retail_per_unit      numeric(9,4) NOT NULL,
  billed_per_unit      numeric(9,4) NOT NULL,
  -- Final AMT as printed: tax included.
  amount               numeric(12,2) NOT NULL,
  -- Pre Tax AMT and the four tax columns, as printed; tax is zero on a US
  -- invoice. pre_tax_amount + hst + gst + pst + qst = amount (T-61).
  pre_tax_amount       numeric(12,2),
  hst                  numeric(12,2) NOT NULL DEFAULT 0,
  gst                  numeric(12,2) NOT NULL DEFAULT 0,
  pst                  numeric(12,2) NOT NULL DEFAULT 0,
  qst                  numeric(12,2) NOT NULL DEFAULT 0,

  UNIQUE (fuel_stop_id, product_code)
);

-- Separate section on the invoice, different shape from fuel stops.
--
-- truck_id / unit_raw are nullable because the portal CSV has no tractor column
-- at all, so every express row imported from a CSV legitimately has neither
-- (D20). That is a property of the file, not a resolution failure; a unit that
-- is present but unrecognised still quarantines. On a real PDF invoice every
-- row carries a tractor — what is genuinely blank is the *driver* (one row of
-- six in A19), which is why driver_id / driver_name_raw are nullable too.
--
-- trailer_raw, cdl_raw and trip_number_raw are PDF-only columns. They are blank
-- on every invoice measured so far, which is a reason to keep them nullable,
-- not to discard what the supplier sends.
CREATE TABLE express_charges (
  id              bigserial PRIMARY KEY,
  invoice_id      uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  express_code    text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  truck_id        uuid REFERENCES trucks(id),
  unit_raw        text,
  driver_id       uuid REFERENCES drivers(id),
  driver_name_raw text,
  trailer_raw     text,
  cdl_raw         text,
  trip_number_raw text,
  amount          numeric(12,2) NOT NULL,
  fee             numeric(12,2) NOT NULL DEFAULT 3.00,
  total           numeric(12,2) NOT NULL,
  payee           text,
  note            text,
  category        text,
  match_status    text NOT NULL DEFAULT 'unmatched'
                    CHECK (match_status IN ('matched','unmatched'))
);

-- Mirrors v1's import_rejections. Written on quarantine (D12); an invoice row
-- with rejections has zero child rows in fuel_stops/express_charges.
CREATE TABLE invoice_rejections (
  id          bigserial PRIMARY KEY,
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  auth_code   text,
  code        text NOT NULL,
  message     text NOT NULL
);

-- ─── Write-side and analysis ─────────────────────────────────────────────

-- Append-only: a stop's receipt status derives from the latest row here,
-- which is what makes the queue auditable — who checked it and when (A8.4).
-- Never updated or deleted, only inserted.
CREATE TABLE receipt_checks (
  id           bigserial PRIMARY KEY,
  fuel_stop_id uuid NOT NULL REFERENCES fuel_stops(id) ON DELETE CASCADE,
  checked_by   uuid NOT NULL REFERENCES users(id),
  checked_at   timestamptz NOT NULL DEFAULT now(),
  outcome      text NOT NULL CHECK (outcome IN ('confirmed','missing'))
);

-- Keyed on (rule, subject_type, subject_id) so a re-run updates rather than
-- duplicates (application code upserts against this key). Two severity
-- levels at most (A10) — do not add a third.
CREATE TABLE anomalies (
  id           bigserial PRIMARY KEY,
  subject_type text NOT NULL,
  subject_id   uuid NOT NULL,
  rule         text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('amber','red')),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,

  UNIQUE (rule, subject_type, subject_id)
);

-- Editable in Settings (A8.11); thresholds are data, never code constants
-- (D16). One row per rule; config shape is rule-specific.
CREATE TABLE anomaly_thresholds (
  rule       text PRIMARY KEY,
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Either side may be null — that is how a skipped recommendation and an
-- unplanned stop are represented (A14) — but not both, which would be a
-- match to nothing.
CREATE TABLE plan_actual_matches (
  id           bigserial PRIMARY KEY,
  plan_id      uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  plan_stop_id bigint REFERENCES plan_stops(id),
  fuel_stop_id uuid REFERENCES fuel_stops(id),
  kind         text NOT NULL
                 CHECK (kind IN ('matched','skipped_recommendation','unplanned_stop')),
  delta_usd    numeric(12,2),

  CHECK (plan_stop_id IS NOT NULL OR fuel_stop_id IS NOT NULL)
);
