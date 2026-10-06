# Build plan — CH Fuel App v2 (merged)

**Document version:** 2.0 — 14 September 2026
**Companion:** `TICKETS-v2.md` holds the register — goals, files, dependencies, definitions of done. This document breaks each **new** ticket (T-25 onward) into steps.
**Authority:** `PROJECT-SCOPE.md` (v1, `§`) + `PROJECT-SCOPE-v2.md` (v2, `A`).
**v1 tickets T-11…T-24 keep their steps in `BUILD-PLAN.md`** — apply the A16 amendments when you pick them up. T-01…T-10 are merged; do not rebuild them.

---

## How to use this

Same contract as v1. Every ticket is decomposed into steps that can be implemented and tested one at a time, in dependency order. Each step gives a **goal**, the **files** it touches, the **logic** involved, and **tests** with specific cases. Work one step at a time. A step is finished when its tests pass, not when the code is written.

**Conventions carried over.** Tests co-located as `*.test.ts`; anything needing a live database goes in `backend/test/integration/` and is skipped when `DATABASE_URL` is unset. Storage is miles and gallons; units convert only at the edges named in CLAUDE.md (T-52; T-22 added the map renderer). Money is in the invoice's own currency — USD, or CAD on a CA invoice (D24) — and invoice volumes are stored as printed, gallons or litres (D25, the one exception to miles-and-gallons storage); figures combine across currencies only at the API, at a stored rate (D27). No pure function performs I/O. "Pass" means an assertion.

**One new convention.** Money and per-gallon prices are compared **exactly**, as integers of cents and ten-thousandths, never as floats with a tolerance. A cent of drift is the thing reconciliation exists to catch (T-28), so no test may hide one behind `toBeCloseTo`.

---

# Phase 7 · Actuals data in

## T-25 · Actuals schema migration

**Done — merged to `main` (`324e939`, PR #12).** Steps below are kept as the record of what shipped, not a to-do list: `migrations/0003_actuals.sql` and `0004_actuals_seed.sql` are live. No service, API, or UI code consumes these tables yet — that starts at T-26.

### Step 25.1 — Reference layer tables

**Goal.** `drivers`, `driver_aliases`, `trucks`, `fuel_cards`, `truck_assignments` apply cleanly.

**Files.** New: `migrations/0003_actuals.sql`. **Left alone:** `0001_init.sql` and `0002_seed.sql` — both have applied; A16 forbids editing them.

**Logic.** A11's reference block. `trucks.unit_number` is **text**, never integer — `072` and `1012` coexist and the leading zero is meaningful (**D18, which supersedes D6**; retire T-01's three-digit pad in this step, per A16). `fuel_cards.driver_id` is a **permanent, direct** link (D19) — a card belongs to one driver for its whole life; a lost card is a new row, not a repointed `driver_id`, so it needs no date range and no exclusion constraint. `truck_assignments(driver_id, truck_id, effective_from, effective_to)` carries the relationship that actually changes (a repair swap), with `effective_to` nullable for "current" and an exclusion constraint so one driver cannot have two overlapping truck assignments.

The temptation to fold `trucks` into v1's `truck_profiles` must be resisted: a profile is a *model spec* (capacity, mpg, dimensions) shared by several trucks; a truck is a *fleet number* with an assignment history. Conflating them is why v1's placeholder `truck_number` column exists, and A16 retires it.

**Tests.**
- `db:migrate` applies; second run is a no-op.
- `unit_number = '072'` round-trips with its leading zero, and `'1012'` round-trips at four digits.
- `formatUnitNumber('1012')` returns `1012`, not a truncation or a three-digit pad; `formatUnitNumber('31')` is rejected rather than silently padded to `031`.
- Two overlapping truck assignments for one driver → rejected by constraint, not by application code.
- `effective_to = NULL` is accepted and means current.
- A second active card for one driver is rejected; an inactive card alongside a new active one for the same driver is accepted (D19).
- An alias unique on `alias_normalized` rejects a duplicate spelling of one name.
- **Pass:** all seven.

### Step 25.2 — Invoice layer tables

**Goal.** The import target exists and enforces its keys.

**Files.** Modified: `migrations/0003_actuals.sql` (continues).

**Logic.** `invoices`, `invoice_totals`, `fuel_stops`, `fuel_stop_lines`, `express_charges`, `invoice_rejections`. Prices are `numeric(9,4)`; money `numeric(12,2)`. `fuel_stops` keys on `(invoice_id, base_auth_code)`; `fuel_stop_lines` on `(fuel_stop_id, product_code)`.

`invoices` carries **both** `invoice_number` unique and `file_sha256` unique, and they catch different mistakes: the hash catches the same file twice, the number catches a *different* file claiming an invoice already imported — a corrected re-send, which needs a human decision rather than a silent second row. v1's `price_imports` deliberately dropped its uniqueness on `effective_date` (§12.1 item 2) because a corrected price sheet is legitimate; an invoice is not the same object and keeps its constraint.

`express_charges.driver_id` is **nullable** — the blank-name row in A19 is real data, not a defect.

**Tests.**
- `5.2395` inserted reads back `5.2395`, not `5.24`.
- Same `file_sha256` twice → rejected; same `invoice_number` with a different hash → rejected with a *different* constraint name.
- `(fuel_stop_id, product_code)` rejects a duplicate line.
- A stop with a null `station_id` is accepted (unresolved station, T-29).
- An express row with a null `driver_id` is accepted.
- Deleting an invoice cascades to stops, lines and express rows; deleting a referenced `station` is refused.
- **Pass:** all six.

### Step 25.3 — Receipts, anomalies, thresholds, matches

**Goal.** The write-side and analysis tables.

**Files.** Modified: `migrations/0003_actuals.sql` (completes).

**Logic.** `receipt_checks` is **append-only** — the stop's status derives from the latest row, which is what makes the queue auditable ("who checked it and when", A8.4). `anomalies` keys on `(rule, subject_type, subject_id)` so a re-run updates rather than duplicates. `anomalies.severity` is a two-value check constraint (A10). `plan_actual_matches` allows either side null, which is exactly how skipped recommendations and unplanned stops are represented (A14).

**Tests.**
- Two checks on one stop both persist; the derived status is the later one.
- `severity = 'critical'` (a third value) → rejected.
- Re-inserting the same `(rule, subject)` upserts, leaving one row.
- `plan_actual_matches` accepts a null `fuel_stop_id` and a null `plan_stop_id`, but not both null.
- `dismissed_at` is nullable and setting it does not delete the row.
- **Pass:** all five.

### Step 25.4 — Descriptor, drift test, seed

**Goal.** The new tables cannot drift, and the reference layer is populated.

**Files.** New: `migrations/0004_actuals_seed.sql`. Modified: `backend/src/db/schema.ts`, `backend/src/db/types.ts`, `backend/test/integration/drift.test.ts` (extends, does not replace).

**Logic.** Seed the 27 cards, 27 units and 27 drivers from A19: each card gets its one permanent `driver_id` (D19, a plain `UPDATE`, no date range), and each driver gets one `truck_assignments` row with a plausible `effective_from` and null `effective_to`. Seeding the assignment is what makes T-29's resolution testable against real data on day one.

**Tests.**
- Descriptor matches `information_schema` for every new table.
- An injected wrong nullability on `express_charges.driver_id` **fails** the drift test.
- Seed yields 27/27/27, all 27 cards carrying a `driver_id`, and 27 current `truck_assignments` rows, re-running without duplicating.
- **Pass:** all three.

---

## T-26 · Shared reference layer and effective-dated assignments

### Step 26.1 — Alias normalisation and driver lookup

**Goal.** Free-text invoice names reach a driver record, or admit they did not.

**Files.** New: `backend/src/catalog/drivers.ts`, `backend/src/resolve/normalizeName.ts` + tests.

**Logic.** Case fold, collapse internal whitespace, strip punctuation, expand the same `Mc`/`Mt`/`St` prefixes `cityNormalize.ts` handles (T-09 step 9.1) — reuse that vocabulary rather than writing a second one. Lookup hits `driver_aliases.alias_normalized`, falling back to `drivers.display_name` normalised the same way.

**An unmatched name returns unmatched.** No fuzzy match, no Levenshtein, no "closest driver". A wrong attribution is worse than a blank, because every per-driver metric downstream inherits it and nothing flags it.

**Tests.**
- `ELLIS  PARK` (double space) → ELLIS PARK.
- `kit barnes`, `ARDEN L SHAW` → their records via aliases.
- `emerson` with no alias → **unmatched**, not the nearest name.
- Two aliases pointing at one driver both resolve.
- The normaliser agrees with `cityNormalize`'s prefix handling on a shared fixture.
- **Pass:** all five.

### Step 26.2 — Point-in-time assignment resolution

**Goal.** `resolveAssignment(cardId, at)` — the function the whole actuals half leans on.

**Files.** New: `backend/src/catalog/assignments.ts` + test.

**Logic.** Two hops, not one (D19): `cardId` → `driver_id` is `fuel_cards.driver_id`, a direct lookup with no time dimension. `driver_id` + `at` → `truck_id` selects the `truck_assignments` row whose `[effective_from, effective_to)` contains `at`. Pure over injected row sets in unit tests; the database version is one indexed query per hop. The function's external contract (card + instant in, truck + driver out) is unchanged from the original single-table design — only the internal join moved.

**Why point-in-time and not current.** A driver moved to a different truck in October must not change what a September stop resolves to. Getting this wrong corrupts history silently and is invisible in review — which is why it gets its own step and its own boundary tests rather than being a clause inside the importer.

**Tests.**
- A stop one second before a truck-assignment boundary resolves to the old truck; one second after, the new one.
- An open-ended truck assignment (`effective_to` null) resolves for any later instant.
- A gap with no truck assignment returns a null truck — not the nearest one.
- A card with no `driver_id` (unassigned, or between cards) resolves to a null driver and a null truck, not an error.
- `formatUnitNumber` output is used for display and `1012` is not truncated (D18).
- A truck with no `truck_profile_id` still resolves.
- **Pass:** all six.

---

## T-27 · BVD invoice parser — CSV, with PDF fallback

**Note (supersedes an earlier "Excel" framing, D13).** A real portal download of invoice 999210 confirmed the BVD export is a CSV transaction report, not an `.xlsx` workbook — no new binary-format dependency is needed, and `parseInvoiceCsv.ts` reuses `csv-parse` exactly as v1's `parseBvdCsv.ts` does.

### Step 27.1 — Header and sheet shape

**Goal.** Invoice metadata and printed totals, separated from the data rows.

**Files.** New: `backend/src/invoice/parseInvoiceCsv.ts` + test, `backend/test/fixtures/invoices/sample-redacted.csv` (synthetic; the real invoice 999210 lives locally in gitignored `data/bvd-invoices/`, never committed — see **Fixtures** below).

**Logic.** Read the header block (invoice number, period start/end, invoice date, due date, both party addresses) and the printed per-code totals block. The emailed PDF prints the header as a table and it is read from there. **The portal CSV carries no header block at all** (it opens straight into `Fuel Card Transactions`), so on that path the parser derives one: the invoice number from the filename — the number appears nowhere in the contents — the period from the file's own earliest and latest transaction dates, and the invoice/due date as period end +1 and +2. Those rules are not guesses: the same invoice's PDF prints all five outright, and the derived values match it exactly. Normalise column headers by trimming, uppercasing and collapsing whitespace — same discipline as `parseBvdCsv`.

**Never reshape one export to look like the other.** An earlier fixture was built by splicing a header row and two express columns into a CSV, producing a shape BVD does not emit and hiding the difference this step exists to describe. Each export is parsed as it actually arrives.

**Trust the printed figures as given.** They are the reconciliation target; the parser records them, it never recomputes them. Same rule as v1's `YOUR PRICE`: a supplier's number is theirs.

**Fixtures.** `backend/test/fixtures/invoices/` holds only synthetic, invented data — never a real invoice, regardless of repo visibility (root `.gitignore`). `sample-redacted.csv`/`sample-redacted.pdf` carry the structural coverage this step and step 27.4 test against: header parsing, product-line validation, 4dp precision, grouping, express rows, and the CSV/PDF parsers' shared output shape. A **real** invoice carries real per-driver, per-transaction financial data and belongs in the repo-root `data/bvd-invoices/` instead — gitignored in full, unlike v1's already-committed `data/bvd-prices/` price-sheet corpus. Drop a real invoice there locally (e.g. `invoice_999210.csv`, named as BVD downloads it) to exercise the `describe` blocks that assert exact real figures (header, printed totals, known regressions); they check for the file and skip automatically when it's absent, the same way `DATABASE_URL`-gated integration tests do.

**Tests.**
- 999210 yields number `999210`, period `2026-09-03`→`2026-09-09`, invoice date `2026-09-10`, due `2026-09-11`.
- Printed totals parse to TA 8,733.11/$48,450.68, DF 174.43/$845.40, S $90.50, Express $1,543.13, grand $50,929.71.
- A file whose header shape differs is **rejected**, not coerced.
- Company text is recorded verbatim, not corrected.
- **Pass:** all four.

### Step 27.2 — Product lines and 4dp prices

**Goal.** Every fuel line, at full precision.

**Files.** Modified: `parseInvoiceCsv.ts`. New: `backend/src/invoice/productCode.ts`.

**Logic.** One row per product line with product code, gallons, retail, billed, amount, card, unit text, driver text, station text, timestamp, auth code. Prices parse as **strings into `numeric(9,4)`-safe decimals**, never through `parseFloat` and back — `5.2395` must not become `5.239499999`.

Unmapped product codes fail their row against `product_codes` (v1 §11.1's tripwire). `TA`/`DF`/`S` are in the sample; `TF`/`AD`/`O`/`L`/`C` exist and must be mapped before they appear, not defaulted when they do.

**Tests.**
- All 4dp prices survive parse → serialise → parse identically, asserted as strings.
- `PROD = 'ZZ'` rejects its row with an unmapped-product code and does not become diesel.
- Gallons of `0.04` parse (the sub-gallon swipe), and `243.95` parses.
- Rejections carry row number, auth code and reason.
- **Pass:** all four.

### Step 27.3 — Grouping by base auth code

**Goal.** Lines → stops, with the stop total correct.

**Files.** New: `backend/src/invoice/groupByAuthCode.ts` + test.

**Logic.** Group on the base auth code, take card/unit/driver/station/timestamp from the group (asserting they agree within it), and compute `total_usd` as the sum of **all** line amounts.

This is the ticket's whole reason for existing. The legacy sheet recorded `A252014353` as $218.35 — the diesel line — and dropped $36.78 of DEF. The grouped total is $255.13, and a test asserts that number literally so the regression cannot come back.

**Tests.**
- `A252014353` groups the TA and DF lines and totals **$255.13** exactly.
- ~60 stops from the full line set.
- A group whose lines disagree on card or station is a **rejection**, not a silent pick.
- A single-line stop totals its one line.
- A scale-only group (no fuel line) produces a stop with zero gallons and a non-zero total.
- **Pass:** all five.

### Step 27.4 — Express rows and the PDF fallback

**Goal.** The second section, and the path for when CSV is not available.

**Files.** New: `backend/src/invoice/parseExpressRows.ts`, `backend/src/invoice/parseInvoicePdf.ts` + tests.

**Logic.** Express rows have their own shape: date, express code, tractor text, optional driver text, amount, fee, total, payee, note, category. **Every row carries a flat $3.00 fee** — assert it rather than assuming it, because it is the kind of constant that changes without notice.

The two exports carry genuinely different express sections, and both layouts are parsed as they arrive — neither is padded to look like the other:

- **PDF (14 columns):** `DATE, EXP. CODE, AUTH CODE, TRACTOR, TRAILER, DRIVER NAME/ID, CDL, TRIP #, AMOUNT CASHED, FEE, TOTAL, CUR, Payee, NOTES`.
- **CSV (9 columns):** `DATE, EXPRESS CODE NUMBER, AUTH CODES, AMOUNT CASHED, FEE, TOTAL, CUR, PAYEE, NOTES`.

So tractor and driver are readable only from the PDF. A CSV import leaves `unit_raw`/`driver_name_raw` null for every express row — a property of the file, not a resolution failure (D20).

The PDF path produces the **same output type** as the CSV path, so everything downstream is oblivious. It is the fuller source (D13), not a best-effort fallback: measured against the real 999210 it parses all 86 lines with no rejections and balances to the invoice's own printed $50,929.71, so reconciliation tests can use either fixture. The synthetic PDF fixture describes the same invoice as the synthetic CSV one, which is what lets a test assert the two agree.

**Tests.**
- The four A19 express rows parse, including the blank-driver row at $200.00 + $3.00 = $203.00.
- Every parsed express row has `fee_usd = 3.00`; a fixture with $3.50 **fails loudly** rather than passing through.
- Express amounts sum to $1,543.13.
- The PDF parser returns the same shape for the same invoice; a type-level test asserts the two parsers are interchangeable.
- Neither parser prints or performs I/O (console spy).
- **Pass:** all five.

---

## T-28 · Reconciliation and quarantine

### Step 28.1 — The balance check

**Goal.** Parsed rows against printed totals, per product code.

**Files.** New: `backend/src/invoice/reconcile.ts` + test.

**Logic.** For each product code: sum parsed amounts and gallons, compare to the printed figure **exactly in integer cents**. Return `balanced` or an imbalance report listing, per failing code, expected, parsed, delta and the contributing rows.

**Per code, never in total.** A missing $36.78 of DEF and a $36.78 over-count of diesel sum to zero. The legacy sheet's exact failure mode is a compensating error, so a single grand-total check would rubber-stamp it.

**Tests.**
- 999210 balances on all four codes and on the grand total.
- One cent removed from a DF line → DF fails, TA passes, the report names DF with a delta of `-0.01`.
- A compensating pair (DF short by $36.78, TA long by $36.78) → **both codes fail**, proving the per-code check.
- Gallons imbalance is reported independently of amount imbalance.
- Floats are never used: the test asserts on exact integer cents.
- **Pass:** all five.

### Step 28.2 — `importInvoice()` and the quarantine path

**Goal.** A11's write, or a quarantine with nothing written.

**Files.** New: `backend/src/invoice/importInvoice.ts`, `backend/src/invoice/report.ts` + integration test.

**Logic.** Hash → dedupe on `file_sha256` → check `invoice_number` → parse → group → reconcile → **promote in one transaction** or write the invoice row with `status='quarantined'` plus `invoice_rejections` and stop.

The quarantined invoice row is the deliberate exception to "nothing is written" (D12): the header and the report persist so the user can come back to it from the sidebar, and **zero child rows** exist. A toast would lose the report the moment the tab closed.

No HTTP, no argv, no printing — the rule that makes T-34's route and T-48's backfill wrappers rather than rewrites.

**Tests.**
- Balanced 999210 → 1 invoice, ~60 stops, all lines, express rows, `status='imported'`.
- Imbalanced fixture → 1 invoice `status='quarantined'`, **0** stops, **0** lines, **0** express rows, ≥1 rejection row naming the code and rows.
- Same bytes twice → the existing invoice, nothing written.
- Different bytes, same invoice number → refused with a reason distinct from the duplicate.
- A failure injected mid-promotion leaves no partial invoice (transaction rolled back).
- `SELECT` asserts `Σ lines + Σ express = 50929.71`.
- Console spy proves no output.
- **Pass:** all seven.

---

## T-29 · Raw→resolved resolution at import

### Step 29.1 — Truck resolution and the mismatch flag

**Goal.** The resolved truck comes from the card, and disagreement is recorded.

**Files.** New: `backend/src/resolve/resolveTruck.ts` + test. Modified: `importInvoice.ts`.

**Logic.** `resolveAssignment(card_id, occurred_at)` (T-26) gives the truck. The entered unit text is stored as `unit_raw` and **compared**, never trusted. Disagreement sets a flag the anomaly engine reads (T-30) and the UI renders in amber (A9.2).

**Tests.**
- Card 9000005 at `2026-09-03 05:35` with `unit_raw = '0'` → truck **072**, `agrees = false`.
- Same card at `2026-09-09 00:41` with `unit_raw = '072'` → truck 072, `agrees = true`.
- `unit_raw = '072'` on two different cards the same day → **two different trucks**, both `agrees` per their own assignment.
- `unit_raw = '1012'` from two different drivers → resolved per card, not per unit text.
- A card with no assignment at that instant → null truck plus a named exclusion, never a guess.
- `unit_raw` is byte-identical to the invoice text after the write.
- **Pass:** all six.

### Step 29.2 — Driver and station resolution

**Goal.** Names and sites resolved, misses admitted.

**Files.** New: `backend/src/resolve/resolveStation.ts` + test. Modified: `importInvoice.ts`.

**Logic.** Driver via T-26's alias lookup. Station via **T-08's existing store-number parser** — `LOVES #294` → brand `LOVES`, number `294` — joined to `stations`. Never parse the store number from BVD's internal site field: T-08 measured that it matches in **0 of 605** rows.

**Tests.**
- `LOVES #294` resolves to the station whose `site_ref` is 43673, via store number, not site text.
- An unlisted store number leaves `station_id` null and adds a named exclusion.
- `resolveStation` imports T-08's parser rather than reimplementing it — asserted by module reference.
- Driver misses land `unmatched` with `driver_name_raw` intact.
- Express-charge names resolve through the same path, blank name → unmatched with a null driver.
- **Pass:** all five.

### Step 29.3 — Re-resolution as an explicit job

**Goal.** An assignment edit re-resolves deliberately, never on read.

**Files.** New: `backend/src/resolve/reresolve.ts`, `backend/src/cli/reresolve.ts` + test.

**Logic.** Walks stops in a period, recomputes truck/driver, writes changes and returns a diff. D14's whole point: reads are cheap and stable, and history changes only when someone asks for it.

**Tests.**
- Editing an assignment does not change any stored stop until the job runs.
- Running the job re-resolves affected stops and returns a diff naming each change.
- Running it twice is a no-op the second time.
- Raw fields are untouched by re-resolution.
- **Pass:** all four.

---

## T-30 · Anomaly engine

### Step 30.1 — The six rules, one file each

**Goal.** Pure predicates with injected thresholds.

**Files.** New: `backend/src/anomaly/rules/*.ts` + a test per rule.

**Logic.** Each rule takes stops (and, where needed, their neighbours) plus a threshold, and returns findings with a severity and a `detail` payload. No database, no clock — the "now" a rule needs is passed in.

Severity is **two-valued**: *worth a look* and *probably a billing error*. A10 says so explicitly, and the type must make a third value unrepresentable.

**Tests, one real case each.**

| Rule | Case | Expected |
|---|---|---|
| `subGallon` | 0.04 gal, $0.20, LOVES #277 | flagged, *billing error* |
| `unitMismatch` | `unit_raw='0'` on card 9000005 | flagged, *worth a look* |
| `tooClose` | two fills at LOVES #275, 78 min apart | flagged, *worth a look* |
| `defRatio` | 15.60 DEF against 176.44 diesel (8.8%) | flagged, *worth a look* |
| `chargesNoFuel` | card with only a $15.25 scale charge | flagged, *worth a look* |
| `priceAbovePublished` | no published file for the date | **not computable**, not "no anomaly" |

Plus: a normal stop (41.67 gal, matching unit, 3% DEF) triggers **nothing** — the false-positive guard.

**Pass:** every row, plus the negative case.

### Step 30.2 — The runner

**Goal.** Rules over an invoice, idempotently, thresholds from the database.

**Files.** New: `backend/src/anomaly/runAnomalies.ts` + integration test. Modified: `importInvoice.ts` (runs it after promotion).

**Logic.** Load thresholds from `anomaly_thresholds`, run every rule, upsert on `(rule, subject_type, subject_id)`. Dismissal sets `dismissed_at` and survives a re-run — a dismissed anomaly must not come back to life on the next import.

**Tests.**
- 999210 produces the expected flag **count**, asserted as a number.
- Re-running produces no duplicates.
- A dismissed anomaly stays dismissed after a re-run.
- Changing a threshold in the database changes the outcome with no code change.
- Rules run after promotion only — a quarantined invoice produces zero anomalies.
- **Pass:** all five.

---

## T-31 · `npm run import-invoice` + the 999210 import

### Step 31.1 — The CLI

**Goal.** argv and stdout, nothing else.

**Files.** New: `backend/src/cli/importInvoice.ts`, `migrations/0006_express_charges_truck_nullable.sql`. Modified: root `package.json`, `backend/src/db/schema.ts`, `backend/src/invoice/importInvoice.ts`, `backend/src/invoice/report.ts`.

**Logic.** Importing the real 999210 invoice surfaced a schema gap: two Express Codes rows have no tractor/unit text at all (real data, the driver-name blank one column over), but `express_charges.truck_id` was `NOT NULL` — structurally impossible to insert, forcing quarantine over a blank field that isn't an error. `migrations/0006` drops `NOT NULL` from `truck_id` and `unit_raw`, matching `driver_id`'s existing nullability (PROJECT-SCOPE-v2.md D20); `resolveTruckUnitMisses` stops treating a blank unit as a lookup miss, and the report gains `expressBlankUnits` alongside `stationMisses`/`truckAssignmentMisses` so the blank is named, never guessed, never silently dropped. A unit number that's *present but unrecognised* still quarantines (`UNKNOWN_TRUCK_UNIT`) — that's a real data problem, unlike a blank one.

**Tests.**
- The command prints the report and exits 0 on a balanced file.
- A quarantined file exits **non-zero** with the imbalance on stderr.
- A duplicate exits 0 and says so.
- **Pass:** all three.

### Step 31.2 — Import the real invoice and assert the database

**Goal.** A week of real actuals, verified in SQL.

**Files.** New: `backend/test/integration/invoice999210.test.ts`.

**Logic.** The assertions live in SQL rather than in application code, so they test the data rather than the code path that wrote it.

**Tests.**
- 1 invoice, ~60 stops, every line, every express row.
- `Σ fuel_stop_lines.amount_usd + Σ express_charges.total_usd = 50929.71`.
- `Σ gallons WHERE product_code='TA' = 8733.11`; `DF = 174.43`.
- Gallons-weighted average billed price = **5.55** to 2dp.
- All 60 stops are `receipt_status='pending'` — `importInvoice()` never writes `receipt_checks` (that writer is T-35's `POST /receipt-checks`). A5's "48 of 60 confirmed" is asserted once that exists, against the Overview endpoint (T-33's own DoD already covers it) — not here.
- Anomaly count matches T-30's expected figure.
- Every stop has a resolved truck or a named exclusion; none has a guessed one.
- **Pass:** all seven.

---

# Phase 8 · Actuals API

Common steps, applied per ticket rather than repeated below: a pure query-builder module, a route that contains no logic, a test asserting numbers-not-strings and nulls-preserved, and a test asserting anonymous access is refused.

## T-32 · Transactions and transaction-detail endpoints

### Step 32.1 — Filter and sort model

**Goal.** A8.3's filters as a typed, composable query spec.

**Files.** New: `backend/src/actuals/transactionQuery.ts` + test.

**Logic.** A pure function from a filter object to parameterised SQL fragments (D1: parameters only). Every filter is optional and they compose. `anomalyOnly` is a join, not a post-filter — filtering in memory after paging returns short pages.

**Tests.**
- Each filter alone, then three in combination, produce the expected row sets over a fixture.
- `anomalyOnly` with a page size of 5 returns 5 flagged rows, not "5 rows of which some are flagged".
- An empty filter object returns everything for the period.
- No value is ever interpolated into SQL text.
- **Pass:** all four.

### Step 32.2 — The list endpoint

**Goal.** `GET /transactions`, dense and fast.

**Files.** New: `backend/src/actuals/transactions.ts`, `backend/src/api/routes/transactions.ts` + tests.

**Logic.** One row per stop with resolved/raw pairs, `lines[]` on request. Money and prices as numbers with a `currency` field.

**Tests.**
- A row's `truck` field is `{resolved, raw, agrees}` — the A13 shape, not a bare string.
- `lines[]` for `A252014353` sums to the returned stop total, $255.13.
- Billed price serialises as `5.2395` (number, 4dp preserved), not `"5.2395"` and not `5.24`.
- Pagination is stable across pages; `EXPLAIN` shows an index scan for the default sort.
- Anonymous → 401 problem+json.
- **Pass:** all five.

### Step 32.3 — Detail

**Goal.** `GET /transactions/{id}` per A8.4.

**Files.** Modified: `transactions.ts`, route.

**Tests.**
- Payload carries all lines, station, card, assigned truck and driver with assignment date, both raw fields, receipt status with checker and timestamp, anomalies, invoice link.
- A stop covered by a **dispatched** plan returns a plan link; one covered only by a non-dispatched plan returns none.
- Unknown id → 404 problem+json.
- **Pass:** all three.

## T-33 · Overview endpoint

### Step 33.1 — Period rollups

**Goal.** A5's figures from SQL, in one call.

**Files.** New: `backend/src/actuals/overview.ts` + integration test.

**Logic.** Gallons-weighted average billed price — `Σ(gallons × billed) / Σ gallons`. A mean of per-stop prices is a different and wrong number, and on this data it is close enough to look right.

**Tests.**
- Every A5 KPI matches exactly.
- A fixture where weighted and unweighted averages differ proves the weighting.
- Scale and express are reported separately, with the fee total broken out.
- A period with no invoice returns a well-formed empty payload, not an error.
- **Pass:** all four.

### Step 33.2 — Trend, top spend, digest

**Goal.** The three panels under the cards.

**Files.** Modified: `overview.ts`, new route + test.

**Tests.**
- The trend covers the last N periods; a missing period is **absent**, not zero.
- Top spend by driver is ordered and gallons-weighted where it reports a price.
- The digest returns the anomalies with enough payload to deep-link into Transactions.
- One API call serves the whole screen.
- **Pass:** all four.

## T-34 · Invoice import endpoints and history

### Step 34.1 — Upload, preview, confirm

**Files.** New: `backend/src/api/routes/invoices.ts` + tests.

**Logic.** Multipart in, T-28 called, result mapped to HTTP. The route holds no parsing and no reconciliation.

**Tests.**
- Balanced → 200 with a per-code write preview; confirm writes.
- Imbalanced → **200 with `status:"quarantined"`** and the full report; database has no child rows.
- Duplicate → **409** problem+json, distinguishable from quarantine by the caller.
- Non-CSV, non-PDF upload → 415 problem+json.
- Route module imports no parser internals — asserted by module graph.
- **Pass:** all five.

### Step 34.2 — History and re-open

**Tests.**
- `GET /invoices` paginates newest-first with the A8.2 fields.
- A quarantined invoice's report is retrievable by id without re-uploading the file.
- **Pass:** both.

## T-35 · Receipt queue endpoints

### Step 35.1 — Queue and progress

**Files.** New: `backend/src/actuals/receipts.ts` + test.

**Logic.** Deterministic ordering, with the ordering expressed as data so an exceptions-first queue needs no schema change (D17).

**Tests.**
- Returns only unconfirmed stops, with A8.5's context fields.
- `progress` reads `{done: 48, total: 60}` on 999210.
- Ordering is deterministic across calls.
- Switching to exceptions-first ordering requires no migration — asserted by swapping the order spec in the test.
- **Pass:** all four.

### Step 35.2 — Single and batch writes

**Files.** New: `backend/src/api/routes/receipts.ts` + tests.

**Tests.**
- One decision writes one append-only row with checker and timestamp; the stop's derived status follows.
- **Skip writes nothing** and leaves the item in the queue.
- Batch confirm for a driver writes one row per stop in one transaction and is idempotent.
- A confirmed stop never reappears in the queue.
- Anonymous → 401.
- **Pass:** all five.

## T-36 · Other-charges endpoints

### Step 36.1 — List with match status

**Files.** New: `backend/src/actuals/otherCharges.ts`, route + tests.

**Tests.**
- The blank-driver row returns a **null driver** and `matchStatus:"unmatched"` — never a guess.
- `sutton` resolves if aliased, is flagged unmatched if not.
- The fee total is separate from the amount total; both are returned.
- `Σ total_usd` over 999210 equals $1,543.13.
- Note and category are verbatim.
- **Pass:** all five.

## T-37 · Analysis endpoints — drivers, trucks, stations

### Step 37.1 — Driver and truck rollups

**Files.** New: `backend/src/actuals/drivers.ts`, `trucks.ts`, routes + tests.

**Tests.**
- Driver list: spend, gallons, **gallons-weighted** average billed, compliance %, anomaly count.
- Driver detail: their average against the fleet average for the same period; DEF:diesel ratio; favoured stations.
- Truck detail: assigned card **plus assignment history**; a stop before a reassignment still resolves to the old truck.
- A driver with no stops in the period returns zeros, not an error.
- **Pass:** all four.

### Step 37.2 — Station price history and the audit hook

**Files.** New: `backend/src/actuals/stations.ts`, route + test.

**Logic.** Price per site per day, with a nullable `discrepancy` against the published file.

**Tests.**
- Site 25334 on 9/7 and 9/9 returns **5.5208** for every card (three on 9/7, one on 9/9 — measured; A6.5's "five" was the station's total rows) — the A6.5 finding, asserted. The station row must be seeded with `site_ref` `25334` *before* the import, since a bare test schema loads no stations.
- `discrepancy` is `null` (not `0`) when no published file exists for the date.
- A synthetic published file 2 cents below the billed price yields a positive discrepancy at *billing error* severity.
- **Pass:** all three.

## T-38 · Plan vs Actual matching and endpoints

### Step 38.1 — The pure matcher

**Files.** New: `backend/src/planActual/match.ts` + test.

**Logic.** Truck + date window + station. Pure over injected plan stops and fuel stops; no database, no clock.

**Tests.**
- A plan stop and a fuel stop at the same site within the window → `matched` with `delta_usd = gallons × (actual − planned)`.
- A recommendation with no fuel stop → `skipped_recommendation` **as a row**.
- A fuel stop with no recommendation → `unplanned_stop` **as a row**.
- A non-dispatched plan produces **no** matches.
- Two fuel stops inside one window match deterministically (nearest in time), and the loser is an `unplanned_stop`, not dropped.
- The three exclusion classes are returned with counts.
- **Pass:** all six.

### Step 38.2 — Live endpoint and empty state

**Files.** New: `backend/src/api/routes/planActual.ts` + test.

**Tests.**
- With 999210 and a dispatched plan: matched pairs, deltas, adherence, by-truck variance, coverage counts.
- With **zero** overlap: a well-formed payload carrying coverage `{covered: 0, total: 60}` and empty arrays — not a 404, not a bare `[]`.
- Money left on the table equals the sum of positive deltas.
- **Pass:** all three.

### Step 38.3 — Historical backtest

**Files.** New: `backend/src/planActual/backtest.ts` + test.

**Logic.** For each historical stop set, rebuild the lane, re-solve against the archived price file for that date with **`dp_v1` unchanged**, and diff. Needs no plan, so it works over the full backfilled history.

**Tests.**
- A date with an archived price file produces a projected cost and a delta.
- A date with **no** archived file is an exclusion, named and counted — never a zero delta.
- `dp_v1` is called with no I/O in scope; the optimiser's own tests still pass unmodified.
- Projected cost is never above actual on a fixture where a cheaper compliant stop existed — the sanity check that the backtest is actually optimising.
- **Pass:** all four.

---

# Phase 9 · Actuals UI

`CH Fuel App.dc.html` is the visual authority: it already realises the shell, Transactions, Plan vs Actual and the ported Plan/Plans screens. Read it before building any screen here, and port its structure rather than reinterpreting it.

## T-39 · App shell

### Step 39.1 — Sidebar and routing

**Files.** New: `frontend/src/app/(app)/layout.tsx`, `Sidebar.tsx`. Modified: `page.tsx`, `Header.tsx` (absorbed into `TopBar`).

**Logic.** A7's groups, active state from the route, pending badge from the API. The v1 tab bar goes (D15); the v1 Plan and Recent screens become the `New Plan` and `Plans` routes with their behaviour unchanged.

**Tests.**
- Every A7 destination routes; active state matches the URL.
- The badge count comes from the API, not a constant.
- Plan and Plans render their v1 behaviour inside the new shell.
- A fourth nav group renders without layout changes.
- **Pass:** all four.

### Step 39.2 — Invoice period selector

**Files.** New: `TopBar.tsx`, `InvoicePeriodSelector.tsx`, `frontend/src/hooks/useInvoicePeriod.ts`.

**Logic.** Defaults to the most recent invoice, persists in the URL so a view is linkable, governs Actuals and Analysis only.

**Tests.**
- Defaults to the newest invoice.
- Changing it refetches Actuals screens and **not** Plan screens.
- Plan screens show their own price-sheet date and hide the selector.
- The period survives a reload via the URL.
- Standing receipt/flag counts come from the API.
- **Pass:** all five.

## T-40 · Transactions screen

### Step 40.1 — `RawResolved` and the formatters

**Goal.** The two conventions as components, before any table exists.

**Files.** New: `frontend/src/components/RawResolved.tsx`, `BilledPrice.tsx`, `frontend/src/lib/formatMoney.ts` + tests.

**Logic.** A9's vocabulary in exactly two components. `RawResolved` renders resolved / raw / disagreeing. `BilledPrice` renders the dominant 4dp price with its subordinate discount. Building these first is what keeps the convention from drifting screen by screen.

**Tests.**
- All three `RawResolved` states render their specified treatment; the disagreeing state includes both values and the `≠` marker.
- `BilledPrice`'s price font size is strictly larger than its discount font size — asserted on computed styles.
- Gallons 2dp, prices 4dp, money 2dp with a USD marker; `5.24` never appears where `5.2395` is the value.
- Tabular figures are applied to every numeric.
- **Pass:** all four.

### Step 40.2 — The table

**Files.** New: `frontend/src/app/(app)/transactions/page.tsx`, `TransactionsTable.tsx`.

**Logic.** TanStack Table over T-32. Columns per A8.3. The whole table — header, rows, totals footer — scrolls horizontally as **one** unit inside a single overflow container with a min-width equal to the column sum; the row expansion stacks below that width rather than squeezing to zero. (Both failure modes were found and fixed in the design file; do not rediscover them.)

**Tests.**
- Header, rows and footer stay aligned while scrolled.
- At 900px the expansion stacks and no cell overlaps another — asserted on bounding boxes.
- Filters round-trip to the query string; a filtered URL restores the view.
- Expanding `A900000001` shows both lines and a stop total of $238.26.
- Keyboard: arrows move rows, `enter` expands, `/` focuses search.
- **Pass:** all five.

## T-41 · Overview screen

### Step 41.1 — KPI cards and panels

**Files.** New: `frontend/src/app/(app)/overview/page.tsx`, `KpiCard.tsx`, `BilledPriceTrend.tsx`, `TopSpendByDriver.tsx`, `AnomalyDigest.tsx`.

**Tests.**
- Average billed price is the dominant card; discount is visually subordinate — asserted on computed emphasis, not reviewed by eye.
- Recharts trend renders gaps as gaps.
- The digest deep-links into Transactions with `anomalyOnly` applied.
- Exactly one API call.
- "No invoice imported" empty state renders on its condition.
- **Pass:** all five.

## T-42 · Import screens

### Step 42.1 — Dropzone, parsing, preview

**Files.** New: `import/page.tsx`, `Dropzone.tsx`, `ParsingState.tsx`, `ReconciliationPreview.tsx`.

**Tests.**
- Parsing shows file name, progress, row count.
- The preview shows the per-code balance check summing to $50,929.71 and a confirm that writes.
- A non-CSV/PDF drop is refused before upload.
- **Pass:** all three.

### Step 42.2 — Quarantine as a screen

**Files.** New: `QuarantineScreen.tsx`, `ImportHistory.tsx`.

**Logic.** A8.2 state 3. Full screen, reachable later from history, states plainly that nothing was written.

**Tests.**
- Renders failing code, expected vs parsed, delta, and the offending rows.
- States that nothing was written, and the database confirms it.
- Reachable from history without the original file.
- The duplicate-upload message is visibly distinct from quarantine.
- **Pass:** all four.

## T-43 · Receipt Queue screen

### Step 43.1 — The queue card and shortcuts

**Files.** New: `receipt-queue/page.tsx`, `QueueCard.tsx`.

**Tests.**
- One item at a time with the A8.5 context fields.
- `Y`/`N`/`S` work, are visible on screen, and do not require clicking first.
- Progress reads `12 of 60`.
- Skip advances without writing.
- An optimistic decision that fails on the server rolls back visibly.
- **Pass:** all five.

### Step 43.2 — Phone layout and batch confirm

**Files.** New: `BatchConfirm.tsx`. Modified: `QueueCard.tsx`.

**Tests.**
- At 390px: no horizontal scroll, hit targets ≥ 44px, Y/N within one-thumb reach.
- Batch confirm states the count before writing and writes in one transaction.
- With an exceptions-only queue (2 items of 60), the layout renders correctly and does not imply 58 pending decisions.
- **Pass:** all three.

## T-44 · Other Charges screen

### Step 44.1 — The table and the unmatched affordance

**Files.** New: `other-charges/page.tsx`, `ExpressTable.tsx`.

**Tests.**
- All A8.6 columns; fee total separate.
- The blank-driver row renders as unmatched using `RawResolved`'s raw treatment.
- An unmatched free-text name offers "add as alias" and lands in Settings.
- Totals reconcile to $1,543.13.
- **Pass:** all four.

## T-45 · Drivers, Trucks, Stations screens

### Step 45.1 — Lists and detail

**Files.** New: the three route folders and their components.

**Tests.**
- Lists reuse the Transactions formatting components — no second set of number formatters exists (grep).
- Driver detail plots their price against the fleet average and shows the DEF ratio.
- Truck detail shows assignment history with its caveat about re-resolution.
- **Pass:** all three.

### Step 45.2 — Stations map and price history

**Files.** Modified: `stations/page.tsx`; reuses T-22's map layers.

**Tests.**
- Map reuses T-22's layer styling; city-tier stations draw their uncertainty circle.
- Station detail shows billed price per day, with 5.5208 appearing once per day rather than once per card.
- The discrepancy panel renders "not computable" with no published file.
- **Pass:** all three.

## T-46 · Plan vs Actual screen

### Step 46.1 — The two views

**Files.** New: `plan-actual/page.tsx`, `LivePerformance.tsx`, `HistoricalBacktest.tsx`.

**Logic.** Port the design file's Plan vs Actual screen: segmented control, KPI row, chart, by-lane / by-truck table with adherence bars, needs-review list, flagged deviations, exclusions.

**Tests.**
- The control switches views without refetching the other.
- Live headline is money left on the table; backtest headline is projected savings.
- Skipped recommendations and unplanned stops render as rows.
- Coverage is stated on screen.
- **Pass:** all four.

### Step 46.2 — The empty state

**Files.** New: `PvaEmptyState.tsx`.

**Logic.** A8.10 says this will persist for months. It explains why it is empty and what will fill it.

**Tests.**
- A zero-overlap fixture renders the empty state, not a broken chart.
- It names the two preconditions (a dispatched plan, an imported invoice covering the same truck and date).
- The backtest view still works with zero live overlap.
- **Pass:** all three.

## T-47 · Settings

### Step 47.1 — Assignments and aliases

**Files.** New: `settings/page.tsx`, `AssignmentsTable.tsx`, `AliasList.tsx`, `backend/src/api/routes/settings.ts`.

**Tests.**
- An assignment edit writes an effective-dated row and does **not** change stored stops until the re-resolve job runs; the UI says so.
- Alias add/remove works; unmatched names from T-36 arrive as one-click candidates.
- Anonymous → 401.
- **Pass:** all three.

### Step 47.2 — Thresholds and re-resolve

**Files.** New: `ThresholdForm.tsx`.

**Tests.**
- Every A10 threshold is editable and takes effect on the next anomaly run, with no deploy.
- The re-resolve job can be triggered and reports what changed.
- No roles UI appears with a single user.
- **Pass:** all three.

---

# Phase 10 · Ship v2

## T-48 · Historical invoice backfill

### Step 48.1 — Directory walk with per-file status

**Files.** New: `backend/src/invoice/backfillInvoices.ts` + test.

**Tests.**
- Three invoices where the middle one imbalances: 2 imported, 1 quarantined, batch completes.
- Shuffled order produces identical database state.
- Quarantined files keep their reports and are queued for review.
- **Pass:** all three.

### Step 48.2 — Gap report and the real run

**Files.** New: `backend/src/invoice/invoiceGapReport.ts`, `backend/src/cli/backfillInvoices.ts` + test.

**Logic.** Any week in the range with no invoice is a gap. Never interpolated — the same rule as v1's price-sheet gap report, which correctly names `2026-01-11`.

**Tests.**
- A range missing two weeks reports both.
- A contiguous range reports none.
- An older-year file with a different sheet shape is a **parse rejection naming the year** (answering A18 Q6 with data, not a guess).
- Re-running the whole directory changes nothing.
- **Pass:** all four.

## T-49 · Deploy v2

### Step 49.1 — Migrations and CI on Neon

**Tests.**
- `0003`/`0004` apply to a fresh Neon branch; the drift test passes against it.
- CI is green from a clean checkout, including a production Next build.
- **Pass:** both.

### Step 49.2 — Runbook and the honest record

**Files.** Modified: `docs/RUNBOOK.md`, `PROJECT-SCOPE.md` §2 and §19, `PROJECT-SCOPE-v2.md` §A3.

**Logic.** §2 and §A3 describe where the build stands. On ship day they are wrong unless edited, and shipping a document that describes work which does not match the repository is the exact failure the v1 rewrite existed to correct.

**Tests.**
- A real lane plans and a real invoice imports in production.
- Anonymous API → 401; anonymous page → 307; `/health` not exempt.
- Runbook covers weekly import, quarantine triage, receipt cadence, backfill, both meters.
- §2, §19 and §A3 match the repository on the day of the deploy.
- **Pass:** all four.

---

# Cross-cutting

## T-52 · Distances in miles end to end

One commit per step. Step 52.1 changes the schema and the in-code schema together, because the drift test couples them. Step 52.3 covers the corridor, `stratifiedTopK` and `optimizerInput` in one commit, because `optimizerInput` consumes the corridor's types and the pre-commit typecheck would fail between them.

### Step 52.1 — Migration `0010` and the in-code schema

**Files.** New: `migrations/0010_distances_in_miles.sql`. Modified: `backend/src/db/schema.ts`, `backend/src/db/types.ts`, `backend/test/integration/schema.test.ts`, `migrate.test.ts` (or a new `distanceMigration.test.ts`).

**Logic.** Rename `_m` → `_miles` and convert with `USING (col / 1609.344)`: `routes.distance_m`, `plans.total_distance_m`, `plan_stops.offset_along_route_m`, `leg_distance_m`, `detour_distance_m`, `cum_distance_m`, and `uncertainty_m` on `place_centroids`, `stations`, `station_geocode_candidates`. Widths: distances `numeric(9,3)`, detour `numeric(7,3)`, uncertainty `numeric(8,3)`. Check no constraint, index or view references the columns.

**Tests.**
- A schema test asserts no public-schema column ends in `_m` (empty allowlist) and every distance column is `_miles`.
- The Python loaders are not exercised by any test (they need `psycopg` and a Census download); they are checked with `py_compile` and by reading. Say so in the PR.
- A migration test applies migrations up to `0009`, inserts rows in metres, applies `0010`, and asserts the converted values (e.g. 1609.344 → 1.000; 6031.4 → 3.748; 500 mi in metres → 500.000).
- The drift test passes.
- **Pass:** all three.

### Step 52.2 — Routing: the ORS adapter converts once

**Files.** Modified: `routing/provider.ts`, `provider.types.ts`, `ors.ts`, `ors.test.ts`.

**Logic.** `distanceMeters` → `distanceMiles` on `RouteResult`, `RouteLeg`, `MatrixResult`. `ors.ts` applies `metersToMiles` where the response is parsed; ORS response body types stay metres. `providerRaw` and the HGV restrictions stay metric. No `units` request parameter — the request body, and so `request_hash`, is unchanged.

**Tests.**
- Adapter expectations are `metersToMiles(<fixture value>)`, from the unchanged recorded fixtures.
- Legs sum to the total within a tolerance restated in miles.
- The request body carries no `units` key, so `request_hash` is unchanged; a `null` matrix cell (unreachable pair) stays `null`, never 0 miles.
- **Pass:** all three.

### Step 52.3 — Corridor

**Files.** Modified: `planning/corridor.ts`, `test/integration/corridor.test.ts`.

**Logic.** `radiusMeters` → `radiusMiles`. The SQL converts the **parameter** (`ST_DWithin(s.geom, r.line, $2 * 1609.344)`), never the column; perpendicular offset is `ST_Distance(...) / 1609.344`. Fields become `routeDistanceMiles`, `offsetAlongRouteMiles`, `perpOffsetMiles`, `uncertaintyMiles`. Still parameterised.

**Tests.** Existing corridor cases in miles; the GIST-index (EXPLAIN) test still passes; a station just inside and just outside the radius are classified correctly.

### Step 52.3 (continued) — Stratified top-K and the optimiser seam

**Files.** Modified: `planning/stratifiedTopK.ts`, `optimizerInput.ts` (+ tests); `optimizer/model.ts`, `optimizer/types.ts` (comments).

**Logic.** `stratifiedTopK` takes `offsetAlongRouteMiles` and buckets on `bucketMiles` directly. `toOptimizerLane` stops converting; it reduces to a plain mapping, or is deleted if trivial. `LEG_TOLERANCE_MILES` is kept and its comment reworded honestly (it no longer compensates for a metres round trip).

**Tests.** Bucketing cases unchanged in outcome; the metres-round-trip "float noise" tests are removed or rewritten; `dp_v1`/`greedy_v1` suites pass unmodified.

### Step 52.4 — Resolution, the resolve CLI and the Python loaders

**Files.** Modified: `resolution/gazetteer.ts`, `operatorExport.ts`, `cli/resolve.ts` (+ tests, `resolveCli.test.ts`); `scripts/load_gazetteer.py`, `scripts/resolve_from_operator.py`.

**Logic.** `uncertaintyM` → `uncertaintyMiles`. `CITY_TIER_MAX_UNCERTAINTY_M = 8_000` became `8000 / 1609.344` miles here, and was then restated as a plain `5` miles on 2026-09-20 (see TICKETS-v2 T-52). `uncertainty_from_land_area` in the loader drops its `* METERS_PER_MILE` (the source is already miles).

**Tests.** The threshold boundary is asserted at the exact converted value; the real-data operator-export resolve still matches 604 of 605 where `data/` exists. (The scope's "595 city tier" is an unverified gazetteer name-match count and is not asserted.)

### Step 52.5 — API type and the frontend mock

**Files.** Modified: `domain/planResponse.ts` (+ test), `frontend/src/data/trips.ts`.

**Logic.** `uncertaintyMeters` → `uncertaintyMiles`. Record for T-22 that MapLibre circle radii need metres, so the frontend converts at render.

**Tests.** `planResponse` test; frontend typecheck.

### Step 52.6 — Docs and the residual sweep

**Files.** Modified: `PROJECT-SCOPE.md` (§8.4, DDL blocks, §13.1, §15.4, §15.4.1, §17, the "every other `_m` column is metres" sentence), `TICKETS.md`, `BUILD-PLAN.md`, `CLAUDE.md`.

**Logic.** Migrations are authoritative; then scope; then tickets and build plan. CLAUDE.md gains the `_miles` convention and names the three conversion edges, without duplicating scope content. The "perp_offset_m < 200 m" rule becomes its mile equivalent (≈ 0.124).

**Tests.** The repo-wide sweep from the ticket's DoD; every remaining hit is listed and justified. `npm run verify` green.

---

# Definition of done — project overall (v2)

**Function**
- [ ] A dispatcher plans a lane, dispatches it, imports the week's invoice, and sees what the deviation cost.
- [ ] Every fuel stop shows every product line; no DEF is ever dropped from a stop total.
- [ ] Billed price per gallon is the headline metric on every screen that shows a price; discount is never more prominent.
- [ ] Raw driver entry and resolved values are always distinguishable, everywhere raw text appears.
- [ ] An imbalanced invoice is quarantined with a report, and nothing is written.
- [ ] Plan vs Actual works live and as a backtest, and its empty state explains itself.

**Data**
- [ ] Invoice 999210 reconciles to $50,929.71 in SQL.
- [ ] 27 cards, 27 trucks, 27 drivers in one shared reference layer used by both halves.
- [ ] Assignments are effective-dated; editing one does not silently rewrite history.
- [ ] Missing invoice weeks are reported, not interpolated.

**Correctness**
- [ ] Reconciliation is per product code and compares exact integer cents.
- [ ] Averages that are prices are gallons-weighted, asserted against a fixture where it matters.
- [ ] Anomaly rules are pure, two-severity, threshold-driven, and idempotent.
- [ ] `dp_v1` is unchanged by the backtest and still performs no I/O.

**Honesty of the record**
- [ ] Unmatched is shown as unmatched — no guessed drivers, no guessed stations, no guessed trucks.
- [ ] "Not computable" and "no anomaly" are different answers.
- [ ] §2, §19 and §A3 describe the repository as it is on ship day.

---

## T-53 · Migrations organised by domain (squash, pre-deploy)

One commit per step. Old files are not deleted until step 53.2 has proved the new ones equivalent.

### Step 53.1 — Write the five files beside the old ten

**Files.** New: five files in a scratch directory outside `migrations/`.

**Logic.** Sections follow the current headings. `express_charges.truck_id` and `unit_raw` are nullable from creation, with D20's reason in the comment. `trailer_raw`, `cdl_raw`, `trip_number_raw`, `invoice_totals.discount_usd` and `fuel_stops_occurred_at_id` are in their `CREATE`s. Every `_m` distance is `_miles` at the widths from T-52 step 52.1. Stale headers ("never edited", "additive to 0001") are rewritten.

### Step 53.2 — Prove the catalog is identical

**Logic.** Apply the old ten to one scratch schema and the new five to another; fingerprint each — columns (type, precision, scale, nullability, default), `pg_get_constraintdef`, `pg_indexes.indexdef` — sorted by table then name, and diff. The drift test cannot do this alone: it does not see bare indexes.

**Pass:** the diff is empty apart from column ordinal position. Seed rows also match (truck profiles, product code, thresholds, roster counts).

### Step 53.3 — Swap the files in and repoint every reference

**Files.** Remove the ten old files; add the five. Modified: `actualsSchema.test.ts`, `schema.test.ts`, `optimizer/registry.test.ts`, `actualsSeed.test.ts`, `distancesInMiles.test.ts` → `distanceUnits.test.ts`; comments and messages in `anomaly/types.ts`, `runAnomalies.ts`, `catalog/assignments.ts`, `invoice/importInvoice.ts`, `frontend/src/data/trips.ts`, `importInvoice.test.ts`; docs that name a migration file.

**Pass:** `npm run typecheck` and the integration suite green against a fresh database.

### Step 53.4 — Runner: fail clearly on a stale database

**Files.** Modified: `backend/src/db/migrate.ts`, `backend/test/integration/migrate.test.ts`.

**Logic.** If `schema_migrations` lists a filename absent from the directory, throw a message that says to run `npm run db:reset`, before applying anything.

**Test.** Record a filename that has no file; assert the throw and that nothing was applied.

### Step 53.5 — Reset and repopulate

**Logic.** Snapshot row counts and `provider_usage`; `db:reset`; restore `provider_usage`; `seed`; re-ingest prices, resolve stations, import invoices. No hand-entered data exists to preserve (confirmed 2026-09-21).

**Pass:** counts equal the snapshot; the fingerprint of the live database equals step 53.2's.

---

## T-54 · ORS budget guard re-based to the provider's daily limits

One commit per step. Tests come first in each step. Every test runs against a fake `fetch` or a direct call to the guard — **never a live ORS call.** Confirm each **Open** item in TICKETS-v2 T-54 with the owner before step 54.2.

### Step 54.1 — The semantics, as failing tests

**Goal.** State the new guard in tests before changing it.

**Files.** Modified: `backend/test/integration/budgetGuard.test.ts`, `backend/test/integration/orsMetering.test.ts`.

**Tests.**
- 200 directions calls, then a matrix call, all inside one UTC day: the matrix call succeeds.
- N calls to an endpoint with ceiling N succeed; call N+1 throws `BudgetExceededError` and the fetch is not made.
- **25 plans of calls** (3 directions, 2 matrix, 2 geocoding each) at the default ceilings all succeed; the 26th plan's first matrix call throws.
- A reserved call whose request then fails still counts.
- A call at 23:59:59 UTC and one at 00:00:00 UTC the next day count against different days.
- The thrown error carries the endpoint, the day, the ceiling and the next UTC midnight.
- Two reservations racing for the last free slot: exactly one is admitted.
- A ceiling of 0 blocks the first call and writes no row.
- **Pass:** every one of these fails against the current guard for the reason it should, then passes after 54.2.

### Step 54.2 — The guard

**Goal.** Per-endpoint, per-UTC-day, atomic.

**Files.** Modified: `backend/src/routing/budgetGuard.ts`.

**Logic.** `period` is the UTC date of `now`. The reservation is one statement — `INSERT … ON CONFLICT (provider, period, endpoint) DO UPDATE SET call_count = provider_usage.call_count + 1 WHERE provider_usage.call_count < $ceiling RETURNING call_count` — and no returned row means the ceiling was hit. A ceiling of 0 is refused before it, because the insert half would otherwise write a first call. All values are parameters. `now` stays injectable, so the day boundary is testable with no clock.

**Pass:** the 54.1 tests.

### Step 54.3 — Ceilings from configuration

**Goal.** The defaults are the measured limits; a paid tier is a setting, not a code change.

**Files.** Modified: `backend/src/routing/ors.ts`, `backend/src/routing/factory.ts`, `backend/.env.example`. New: a small pure parser and its test, beside them.

**Logic.** Read the overrides in the factory and pass them through the adapter's existing `budgetCeilings` option. Unset → default; a value that is not a non-negative integer → throw at startup naming the variable; `0` is accepted.

**Tests.** Unset keeps 200 / 50 / 100; a set value overrides one endpoint and leaves the others; `abc`, `-1`, `1.5` and the empty string throw; `0` is accepted and blocks.
**Pass:** all of these.

### Step 54.4 — Documents

**Goal.** No document contradicts the code.

**Files.** Modified: `docs/PROJECT-SCOPE.md` §8.3, `docs/TICKETS.md` T-10, `docs/BUILD-PLAN.md` step 10.x, the `provider_usage` comment in `migrations/0001_planning_schema.sql`.

**Logic.** §8.3's "Ours" column: a per-endpoint ceiling, counted per UTC day, atomic. Record the decision with its date and the reason (the daily figures were being applied as monthly, pooled). Say that a monthly spend ceiling returns when a paid provider is adopted.

**Tests.** Grep the four files for "monthly" beside "pooled" or "ceiling": no remaining claim that the guard is a pooled monthly ceiling.
**Pass:** the grep is clean; `npm run verify` green.

---

## T-55 · Whole seconds when a plan is saved

Two commits: the failing tests, then the fix. No live ORS call except the single check in 55.2.

### Step 55.1 — The defect, as failing tests

**Goal.** Reproduce the 500 without ORS.

**Files.** Modified: `backend/test/integration/planService.test.ts`, `backend/test/integration/plansEndpoint.test.ts`.

**Tests.**
- A fake provider whose baseline, via-route and matrix durations have fractional parts (`67817.7`, `21000.4`, `600.6`): `createPlan` resolves and a `plans` row exists.
- Through the API: `POST /plans` → 201; `GET /plans/{id}` → `optimized.driveSeconds`, `totalSeconds`, `addedDurationSeconds` equal `POST`'s and are `Number.isInteger`.
- Every `stops[].detourSeconds` and `cumulativeDurationSeconds` is an integer on both endpoints (already true; pinned so it stays true).
- **Pass:** the first two fail against `main` — the first with `invalid input syntax for type integer` — and the third passes.

### Step 55.2 — Round once in the planning service

**Goal.** One whole-second value, used everywhere.

**Files.** Modified: `backend/src/planning/planService.ts`.

**Logic.** `const totalDurationS = Math.round(validatedPlan.totalDurationSeconds)`, used for `insertPlanRow`'s `totalDurationS` and for `optimized.driveSeconds` / `totalSeconds` / `addedDurationSeconds`. Nothing in `planPersistence.ts` changes.

**Tests.** The 55.1 tests. Then one real lane from the UI: it saves, reopens from Recent, and draws on the map.
**Pass:** all of these; `npm run verify` green.

---

# Phase 11 · Canada invoices

Decisions D24–D30 (PROJECT-SCOPE-v2 §A15). Order: T-60 and T-62 in parallel → T-61 → T-63 and T-66 in parallel → T-64 → T-65. All seven land before T-49, because T-61, T-63 and T-66 edit `0003_actuals_schema.sql` in place (D21). **No real driver name or card number goes into a step, a committed fixture or an always-run test** — real-data assertions sit in `skipIf(!hasRealFixture)` blocks that migrate from `migrations/real` (T-58).

## T-60 · Canadian stations from BVD's travel-centre directory

### Step 60.1 — Rename the folder

**Goal.** `data/loves/` becomes `data/US-CA-GasStations/` with nothing else changing.

**Files.** `git mv data/loves data/US-CA-GasStations`; `git mv backend/test/fixtures/loves backend/test/fixtures/US-CA-GasStations`. Modified: `scripts/resolve_from_operator.py` (`DEFAULT_XLSX`, fixture path), `package.json` (`db:reset:real`), every test reading the fixture path, `CLAUDE.md` Data on disk table.

**Tests.** `git grep -n "data/loves\|fixtures/loves"` is empty. `npm run verify` green. `npm run db:reset:real` green; US resolution still 604/605, #306 `unresolved`.
**Pass:** all of these, with `bvd-travel-centres-2026-10-01.csv` committed in the same commit.

### Step 60.2 — Parse the directory (pure)

**Goal.** A directory row maps to a station insert/update with no database.

**Files.** Modified: `backend/src/resolution/operatorExport.ts` (+ test). New fixture: `backend/test/fixtures/US-CA-GasStations/bvd_directory.json`, written by the Python loader the same way `operator_export.json` is.

**Logic.** `BvdDirectoryRow` → `{ siteRef, nameRaw, cityRaw, provinceCode, country: 'CA', latitude, longitude, operatorAttrs }`. A province-name → code map for the ten provinces and three territories; an unknown province is an error naming the row, never a guess. `operatorAttrs` is the closed set `Status, StoreId, Address, PostalCode, Highway, Exit, DEFAtPump, TruckParking, CatScale` — `Yes`/blank → `true`/`false`, a numeric parking count → number, otherwise `null`.

**Tests.**
- Comber (58156): `siteRef '58156'`, `provinceCode 'ON'`, coordinates as printed.
- Every row of the committed file: keys of `operatorAttrs` ⊆ the closed set; no key contains a price word.
- The one row with no `Site #` is reported, not mapped.
- `Province 'Narnia'` throws, naming the row.
- The file read with CRLF line endings (built in the test) maps identically.
**Pass:** all.

### Step 60.3 — Load into `stations`

**Goal.** 91 CA stations exist, idempotently.

**Files.** Modified: `scripts/resolve_from_operator.py`.

**Logic.** Upsert on `(supplier, site_ref)` with parameterised SQL: insert when absent (`country 'CA'`, `resolution 'exact'`, `uncertainty_miles 0`, `resolution_source 'bvd_directory'`, `truck_accessible 'unverified'`, `geom`), update coordinates/attrs/`last_seen_at` when present. Print the counts and the skipped row's name.

**Tests.** Integration (`DATABASE_URL`-gated): load twice — 91 rows after the first run, no change after the second; Love's rows untouched. `resolveStation(pool, '58156', 'BVD COMBER')` returns the Comber row.
**Pass:** all; `db:reset:real` runs the loader.

### Step 60.4 — Keep CA out of the planner

**Goal.** No CA station in corridor candidates, exclusions or `GET /stations`.

**Files.** Modified: `backend/src/planning/corridor.ts`, `backend/src/catalog/stations.ts` (+ tests).

**Logic.** `AND s.country = 'US'` in the corridor's station scan and in the stations listing — a fixed literal, not a parameter that could be omitted.

**Tests.** Insert a CA station 1 mile from a test route line: absent from candidates and from `exclusions`; absent from `GET /stations`. A US station at the same distance is unaffected.
**Pass:** all; the T-11/T-13 corridor suites unchanged.

---

## T-62 · CA fleet roster additions

### Step 62.1 — Real set

**Goal.** `migrations/real/0005` carries the 21 cards and drivers, 20 trucks and 16 assignments.

**Files.** Modified: `migrations/real/0005_fleet_roster_seed.sql` (gitignored).

**Logic.** Cards and driver names transcribed from 999217's PDF, `Unit #` per stop tallied per driver: a driver with one unit across every stop gets that unit, from the first transaction date; the five with several units or a shared one get none (decided 2026-10-01). Trucks: the 20 listed in T-62.

**Tests.** Gated: migrate a scoped schema from `migrations/real`, then every card number on 999217 resolves to a driver.
**Pass:** that test, locally.

### Step 62.2 — Synthetic mirror

**Goal.** The same structure with invented identities.

**Files.** Modified: `migrations/synthetic/0005_fleet_roster_seed.sql`, `backend/test/integration/actualsSeed.test.ts`, `referenceLayer.test.ts`.

**Logic.** 21 invented names (mixed one-, two- and three-token), 21 cards continuing past the highest `90000xx` card, identical units and assignment pattern — including one driver with three units, one with two, and two shared units.

**Tests.** Counts identical between the two sets (asserted by applying each into its own scoped schema). `git grep` for each real name and card from 62.1 is empty.
**Pass:** all; `npm run verify` green.

---

## T-61 · Currency and native units at invoice import

### Step 61.1 — Schema

**Goal.** Invoice columns are currency- and unit-neutral, with tax columns.

**Files.** Modified: `migrations/{synthetic,real}/0003_actuals_schema.sql`, `backend/src/db/types.ts`, `backend/src/db/schema.ts` (drift descriptor).

**Logic.** As T-61's design. `currency text NOT NULL CHECK (currency IN ('USD','CAD'))`, `qty_unit text NOT NULL CHECK (qty_unit IN ('gal','L'))`; renames; `pre_tax_amount numeric(12,2)`, `hst`/`gst`/`pst`/`qst numeric(12,2) NOT NULL DEFAULT 0`. Column comments keep the "as printed" rule beside each.

**Tests.** Drift test green. `actualsSchema.test.ts`: the CHECKs reject `'EUR'` and `'m3'`.
**Pass:** all, with every query and test carried through the renames in the same commit — `npm run verify` stays green and US behaviour is unchanged.

### Step 61.2 — Synthetic CA fixture

**Goal.** A CA invoice PDF CI can import.

**Files.** Modified: `backend/test/fixtures/invoices/generateSamplePdf.ts`. New: `sample-ca.pdf`.

**Logic.** The generator gains a CA mode drawn from 999217's **layout**, not its data: `CN` on every row, litres, CAD/L to 4dp, HST at 13% with GST/PST/QST zero, a TA+DF pair sharing one base auth code, a Scale line (QTY 0, 23.01 + 2.99 = 26.00), a DEF line of 0.01 L, a diesel line under 3.785 L, one transaction dated just after the printed period end, and a printed period start weeks before the first transaction. Cards and names come from T-62's synthetic set.

**Tests.** The generated file's own totals reconcile (asserted in the generator's test).
**Pass:** regenerating is byte-stable.

### Step 61.3 — Parsers accept `CN`

**Goal.** Both parsers read a currency instead of assuming one.

**Files.** Modified: `backend/src/invoice/parseInvoicePdf.ts`, `parseInvoiceCsv.ts` (+ tests).

**Logic.** The PDF row readers anchor on `US|CN` (and the express reader likewise); the captured code is returned per row. Header gains `currency` mapped `US → USD`, `CN → CAD`; any other code is a row rejection `UNKNOWN_CURRENCY`; two codes in one file reject the invoice. The CSV parser returns `CA_CSV_UNVERIFIED` on a `CN` row (D30). Tax cells are now kept, thousands separators stripped at the existing boundary.

**Tests.** `sample-ca.pdf` → every row `CAD`, tax cells present, 4dp per-litre prices intact. `sample-redacted.pdf` unchanged. A hand-built CSV with `CN` → `CA_CSV_UNVERIFIED`. A row ending `EU` → `UNKNOWN_CURRENCY`. Mixed `US`/`CN` → invoice rejected.
**Pass:** all.

### Step 61.4 — Import, reconcile, anomalies

**Goal.** A CA invoice persists as printed and reconciles exactly.

**Files.** Modified: `importInvoice.ts`, `reconcile.ts`, `backend/src/anomaly/rules/subGallon.ts`, `priceAbovePublished.ts`, `backend/src/actuals/*.ts` (renamed columns; a temporary `currency = 'USD'` filter on every period-scoped query).

**Logic.** `qty_unit` from currency. Reconciliation per line, integer arithmetic: `pre_tax + hst + gst + pst + qst = amount` and `retail − billed = disc_rate` exactly; `|qty × billed − amount|` and `|qty × disc_rate − discount|` within the printed figures' rounding bound (½¢ + 0.005 × price + 0.00005 × qty), skipped when `qty = 0`. Per printed product row the tax identity; the grand-total row's pre-tax and tax columns equal the sums over TA/TF/DF (T-61 design, amended 2026-10-01). Sub-gallon: `qty_unit = 'L'` → gallons at the rule's input via the existing `units.ts` constant. Price-above-published: no published row → `discrepancy: null`. `occurred_at`: pin the interpretation with a test on the after-period-end transaction.

**Tests.** `sample-ca.pdf` imports with no quarantine; every check passes; the sub-diesel line is flagged and the DEF line not; the post-period-end transaction imports. `sample-redacted.pdf` results are byte-for-byte the same as before the ticket. `/overview?period=` and `/transactions?period=` for the CA fixture's printed start return nothing CA.
**Pass:** all.

### Step 61.5 — The real 999217

**Goal.** The real CA invoice imports clean.

**Files.** New: `backend/test/integration/invoice999217.test.ts` (`skipIf(!hasRealFixture)`, schema from `migrations/real`).

**Tests.** 60 lines, 59 fuel stops, 34 cards, 9 stations resolved, 0 quarantined; grand total 46,837.33 CAD = 41,356.89 + 5,376.44 + Scale 104.00; TA 21,318.77 L; DF 113.09 L; Scale 104.00. 999210's gated suite unchanged.
**Pass:** all, locally; `npm run verify` green in both views; `CLAUDE.md` rules updated.

---

## T-63 · Billing weeks

### Step 63.1 — Schema and import

**Goal.** Every invoice has a billing week and an actual range.

**Files.** Modified: `migrations/{synthetic,real}/0003_actuals_schema.sql`, `importInvoice.ts`, `db/types.ts`.

**Logic.** `billing_week_end` ← printed `period_end`; `actual_start`/`actual_end` ← min/max transaction date (per 61.4's `occurred_at` rule); `UNIQUE (billing_week_end, currency)`.

**Tests.** 999210 and 999217 (gated) share `2026-09-09`. The synthetic fixtures do not (`sample-redacted` ends 2026-01-07, `sample-ca` 2026-09-09) and are not edited: the US one is re-dated in the test (`support/billingWeekFixtures.ts`, the way `backfillInvoices.test.ts` composes its multi-day cases). Importing a second USD invoice into an occupied week fails with a named reason (`conflict`, reason `billing_week`).
**Pass:** all.

### Step 63.2 — `/periods` and the override

**Goal.** Weeks, not invoices, are listed; an invoice can be moved.

**Files.** Modified: `backend/src/api/routes/invoices.ts` (+ test), the periods route.

**Logic.** As T-63's design. `datesDiffer = printed ≠ actual`. `PATCH` body `.strict()`: `{ billingWeekEnd }`; unique violation → 409 problem+json.

**Tests.** Shape and ordering; `datesDiffer` on the CA fixture only; a move and a 409.
**Pass:** all.

### Step 63.3 — Period-scoped routes take `week` and `currency`

**Goal.** Every Actuals endpoint serves one week, one side or both.

**Files.** Modified: `backend/src/api/routes/{overview,transactions,drivers,trucks,stations,expressCharges,receipts}.ts`, `backend/src/actuals/*.ts`, `docs/UI-DATA-CONTRACT.md`, `PROJECT-SCOPE-v2.md` §A13.

**Logic.** Zod `week` (date) and `currency` (`USD|CAD`); remove T-61's temporary filter; field renames off `Usd`; `?units=` converts `qty` and per-unit prices only. Plan vs Actual: `currency = 'USD'` fixed.

**Tests.** Each route: missing/malformed `week` → 400; bad `currency` → 400; CAD returns only CA rows; `units=imperial` on CAD returns gallons with identical money; no field name ends in `Usd` (asserted by walking the response keys).
**Pass:** all.

### Step 63.4 — Gap report and frontend compile

**Goal.** Coverage uses actual ranges; the frontend still works on US.

**Files.** Modified: `invoiceGapReport.ts` (+ test), frontend API types and hooks.

**Tests.** Aug 1 – Sep 2 is a gap for CAD despite 999217's printed start. Frontend suites green with a US default.
**Pass:** all; `npm run verify` green.

---

## T-66 · Exchange rate on the CA invoice, entered by the dispatcher

### Step 66.1 — Stored on the invoice, entered and corrected through `PATCH`

**Goal.** A CA invoice carries the rate the dispatcher entered; nothing is fetched.

**Files.** Modified: `0003_actuals_schema.sql` (both sets: `fx_cad_per_usd numeric(10,6)`, `fx_entered_at timestamptz`, CHECK null on USD), `backend/src/api/routes/invoices.ts` (`PATCH` accepts `fxCadPerUsd`; list and detail return `fxCadPerUsd`, `fxEnteredAt`), `importInvoice.ts` and the import CLI (`--fx-rate`) (+ tests).

**Tests.** `PATCH { fxCadPerUsd: 1.3712 }` on a CA invoice stores it and `fx_entered_at`; a second value replaces it; `null` clears both; on a USD invoice → 400; `0`, `-1`, `0.4`, `3.1`, a string → 400 with nothing changed; `{ billingWeekEnd, fxCadPerUsd }` together applies both or neither. `--fx-rate 1.3712` on a CA file stores it; on a USD file it fails before any row is written. The drift test sees the new columns in both migration sets.
**Pass:** all, with no network.

### Step 66.2 — Import screen: ask, show, correct

**Goal.** The dispatcher enters the rate where the CA invoice arrives, and can fix it later.

**Files.** Modified: `frontend/src/lib/api.ts`, `ReconciliationPreview.tsx`, `ImportHistory.tsx`, `import/page.tsx` (+ tests).

**Tests.** A CA preview shows "Exchange rate (CAD per USD)"; entering 1.3712 calls `PATCH` with it; skipping calls nothing and the history row reads "rate pending". A CA history row shows its rate, and editing it calls `PATCH`; a 400 shows its reason on the row. A USD row has no rate field.
**Pass:** all.

### Step 66.3 — Money in the Transactions conversion

**Goal.** T-64's `USD/gal` | `CAD/L` control converts money too, at the entered rate.

**Files.** Modified: `backend/src/actuals/transactions.ts`, `backend/src/api/routes/transactions.ts` (`?convertTo=USD|CAD`), `frontend/src/lib/conversion.ts` (`conversionParams` adds `convertTo`), `TransactionsTable.tsx` (rate line, `ratePending` cells, the link to enter a missing rate), `docs/UI-DATA-CONTRACT.md` §9, `PROJECT-SCOPE-v2.md` D25 (+ tests).

**Tests.** 999217's week with `convertTo=USD`: every money field and line (amount, pre-tax, HST, GST, PST, QST, total) = CAD ÷ rate, rounded once to the cent; prices to 4dp; the row carries `fx` and `invoiceCurrency`; a USD row is unchanged; no entered rate → money `null`, `ratePending: true`, never 1.0; a corrected rate changes the next read; the response-key walk still finds no `Usd`. Frontend: `USD/gal` on the CA invoice sends `convertTo=USD&units=imperial` and shows USD money with the rate and when it was entered; with no rate, "rate pending" and a link to Import history.
**Pass:** all; `npm run verify` green.

---

## T-64 · Week selector, "Invoices in view", Transactions in native units

### Step 64.1 — Week selector and context

**Files.** New: `WeekSelector.tsx`, `hooks/useWeek.tsx` (the shell's week context, mounted in the `(app)` layout), `lib/weeks.ts` (+ tests). Modified: `TopBar.tsx`, `(app)/layout.tsx`. Removed: `InvoicePeriodSelector.tsx`, `useInvoicePeriod.ts`.

**Tests.** Options read "Week ending Sep 9, 2026 · 🇺🇸 999210 · 🇨🇦 999217"; a one-sided week shows "🇨🇦 —"; ⚠ on `datesDiffer`; navigation does not refetch `/periods` (T-39's rule).
**Pass:** all.

### Step 64.2 — "Invoices in view" strip as the invoice picker

**Files.** New: `InvoicesInView.tsx`, `hooks/useInvoiceInView.ts` (+ tests).

**Tests.** Chip states (in view, not in view, not imported, ⚠ tooltip text); a chip opens that invoice on Transactions (`?invoice=<id>`), "All invoices" (`?invoice=all`) appears only for a two-invoice week; on Transactions a chip keeps the filters; a screen that reads no invoice dims nothing.
**Pass:** all.

### Step 64.3 — Transactions in native units

**Files.** New: `ConversionToggle.tsx`, `lib/conversion.ts` (+ tests). Modified: `transactions/page.tsx`, `TransactionsTable.tsx`, `StopExpansion` (+ tests).

**Tests.** Each invoice opens as it came in (CA: L and CAD/L; US: gal and USD/gal) with no `units`; `USD/gal` on the CA invoice asks for `units=imperial` and keeps money in CAD with "rate pending" (money converts in T-66); `CAD/L` on the US invoice asks for `units=metric`; choosing the invoice's own format sends nothing; the choice applies under All invoices and does not carry over to another invoice, or back. Every money header carries its currency; under All invoices no total adds litres to gallons or CAD to USD. A CA stop's detail shows Pre-tax, HST, GST, PST, QST and Final. The strip highlights exactly the invoices whose rows are shown — asserted against the request made.
**Pass:** all.

### Step 64.4 — Import screen: mismatch note and week override

**Files.** Modified: the Import screens (T-42) (+ tests).

**Tests.** The amber note text for a `datesDiffer` invoice; the override calls `PATCH` and the selector updates without a reload; a 409 shows its reason.
**Pass:** all; `npm run verify` green.

---

## T-65 · Overview — US, CA and combined

### Step 65.1 — `/overview?week=` returns three bodies

**Files.** Modified: `backend/src/actuals/overview.ts`, `backend/src/api/routes/overview.ts` (+ tests).

**Logic.** `us`, `ca` (existing body per invoice, or `null`), `combined` (`partial` flag, `beforeTax`/`tax`/`withTax`, rates in the requested unit, `currency`), `fx` (`rate`, `enteredAt`, or `null` → combined money fields `null` with `ratePending: true`). One rounding point for conversion, in integer cents, documented in the function.

**Tests.** For the fixtures' shared week: CA `withTax` = the CA grand total; `beforeTax + tax = withTax` exactly; combined USD = US + round(CA ÷ rate); US-only week → `ca: null`, `partial: true`; null rate → every converted field `null`, never computed.
**Pass:** all.

### Step 65.2 — Three panels

**Files.** Modified: the Overview page and KPI components (+ tests).

**Tests.** US top left, CA top right, combined below; the CA panel shows before tax / tax / with tax and both per-litre rates; "HST" vs "Sales tax" label rule; "Partial — CA invoice not imported"; "rate pending"; the rate and its date beside the combined figures; the actual-range footnote on `datesDiffer`; both chips highlighted.
**Pass:** all; `npm run verify` green.
