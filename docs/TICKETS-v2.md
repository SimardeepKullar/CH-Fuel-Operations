# Ticket register — CH Fuel App v2 (merged)

**Document version:** 2.0 — 14 September 2026
**Companion:** `BUILD-PLAN-v2.md` decomposes each ticket into steps that can be implemented and tested one at a time.
**Authority:** `PROJECT-SCOPE.md` (v1) + `PROJECT-SCOPE-v2.md` (v2). `§` refers to v1, `A` to v2. Where they disagree, v2 wins and v1 gets edited.
**Repository:** `CH-Fuel-Planner` (single repo, single deployment — D11).

---

## Kickoff prompt — template for every ticket

Copy, replace `T-NN`, `<title>` and `<slug>`, paste as the first message of a fresh session. One ticket per session, one branch per ticket (D9).

```
Ticket T-NN · <title>

Read, in order:
  HANDOFF-PROMPT.md            — what this project is and where it stands
  TICKETS-v2.md § T-NN         — goal, files, dependencies, definition of done
  BUILD-PLAN-v2.md § T-NN      — the steps, in dependency order
  the scope sections T-NN cites

Then read the code the first step touches before writing anything.

Branch: ticket/T-NN-<slug>
Work one step at a time. A step is done when its assertions pass.
Gate: npm run verify must be green before the PR.
If the spec and the repository disagree, say so and propose the edit.
```

---

## Ticket index

| ID | Title | Depends on | Phase | State |
|---|---|---|---|---|
| T-01 | Toolchain and workspace skeleton | — | 0 | ✅ merged |
| T-02 | Rewrite the database schema | T-01 | 0 | ✅ merged |
| T-03 | Seed reference data | T-02 | 0 | ✅ merged |
| T-04 | Next.js + TypeScript migration | T-01 | 1 | ✅ merged |
| T-04B | Backend build step and package boundary | T-04 | 1 | ✅ merged |
| T-05 | Auth and login page | T-03, T-04B | 1 | ✅ merged |
| T-06 | Price-sheet ingest service and `npm run ingest` | T-02 | 2 | ✅ merged |
| T-07 | Backfill CLI and the January import | T-06 | 2 | ✅ merged |
| T-08 | Station resolution from the operator export | T-06 | 2 | ✅ merged |
| T-09 | Gazetteer fallback and manual entry | T-03, T-08 | 2 | ✅ merged |
| T-10 | ORS adapter, budget guard, both meters | T-01 | 3 | ✅ merged |
| T-11 | Corridor query | T-09, T-10 | 3 | ✅ merged (`e6dc487`, PR #35) |
| T-12 | Optimiser registry, `dp_v1`, `greedy_v1` | T-01 | 3 | ✅ merged (`9960bb0`, PR #36) |
| T-13 | Validation loop and two-pass relaxation | T-11, T-12 | 3 | ✅ merged (`993943e`, PR #41) |
| T-14 | Detour costing | T-10, T-11, T-12 | 3 | done — merged (`1dce66a`, PR #44) |
| T-15 | Address geocoding and `saved_locations` | T-02, T-10 | 4 | done — merged (`062b684`, PR #46) |
| T-16 | Plan orchestration, `POST /plans`, `GET /plans/{id}` | T-13, T-14, T-15 | 4 | done — merged (`31d128d`, PR #48) |
| T-17 | Google Maps URL and disclaimers | T-16 | 4 | done — merged (`4eb510e`, PR #50) |
| T-18 | Supporting read endpoints | T-16 | 4 | done — merged (`e97cf9d`, PR #52) |
| T-19 | `sentToDriver` write path | T-16 | 4 | done — merged (`5f6442e`, PR #54) |
| T-20 | Route geometry retention job | — | 4 | ⛔ deferred (§17) |
| T-21 | Frontend API client, retire the mock | T-16, T-18, T-38 | 5 | done — merged (`14b00c3`, PR #61) |
| T-22 | MapLibre map | T-21 | 5 | done — merged (`8bde45f`, PR #65) |
| T-23 | Missing UI states | T-21 | 5 | specified · amend per A16 (tab bar, not sidebar) |
| T-24 | Deployment — Vercel + Neon | T-21 | 6 | ⛔ folded into T-49 (A16, decided) — no standalone v1 deploy |
| **T-25** | **Actuals schema migration** | T-02 | **7** | **done — merged (`324e939`, PR #12)** |
| **T-26** | **Shared reference layer and effective-dated assignments** | T-25 | **7** | **done — merged (`6d7f188`, PR #13)** |
| **T-27** | **BVD invoice parser — CSV, with PDF fallback** | T-25 | **7** | **done — merged (`eb1d757`, PR #14)** |
| **T-28** | **Reconciliation and quarantine** | T-26, T-27 | **7** | **done — merged (`8b6be62`, PR #15)** |
| **T-29** | **Raw→resolved resolution at import** | T-26, T-28 | **7** | **done — merged (`aa92917`, PR #17)** |
| **T-30** | **Anomaly engine** | T-29 | **7** | **done — merged (`85d98f3`, PR #18)** |
| **T-31** | **`npm run import-invoice` + the 999210 import** | T-28, T-29, T-30 | **7** | **done — merged (`48009d2`, PR #19)** |
| **T-32** | **Transactions and transaction-detail endpoints** | T-31 | **8** | **done — merged (`f196ec7`, PR #20)** |
| **T-33** | **Overview endpoint** | T-31 | **8** | **done — merged (`115b6ae`, PR #22)** |
| **T-34** | **Invoice import endpoints and history** | T-31 | **8** | **done — merged (`4b8e899`, PR #24)** |
| **T-35** | **Receipt queue endpoints** | T-31 | **8** | **done — merged (`bed13eb`, PR #27)** |
| **T-36** | **Other-charges endpoints** | T-31 | **8** | **done — merged (`d925cd1`, PR #28)** |
| **T-37** | **Analysis endpoints — drivers, trucks, stations** | T-31 | **8** | **done — PR #29** |
| **T-38** | **Plan vs Actual matching and endpoints** | T-19, T-31 | **8** | **done — merged (`6737c0f`, PR #56)** |
| **T-39** | **App shell — sidebar IA and invoice-period selector** | T-21 | **9** | **done — merged (`6bf9d8b`, PR #72)** |
| **T-40** | **Transactions screen** | T-32, T-39 | **9** | **done — merged (`c04eb0b`, PR #75)** |
| **T-40A** | **Remove the DEF ratio anomaly rule** | T-30, T-40 | **9** | **done — merged (`69ca7f0`, PR #3)** |
| **T-40B** | **Relabel the "No fuel" flag to "Scale"** | T-30, T-40 | **9** | **done — merged (`91086f4`, PR #4)** |
| **T-40C** | **Products-bought column on the transaction row** | T-32, T-40 | **9** | **done — merged (`b44b66d`, PR #5)** |
| **T-40D** | **Filter bar spacing** | T-40 | **9** | **done — merged (`3d73602`, PR #7)** |
| **T-40E** | **Unit column: invoice unit primary, assigned truck secondary** | T-40 | **9** | **done — merged (`3e02a8a`, PR #9)** |
| **T-40F** | **Sub-gallon flag: diesel only, not DEF** | T-30, T-40 | **9** | **done — merged (`4aecaf3`, PR #11)** |
| **T-40G** | **Colour-code product badges; drop the redundant Scale flag** | T-40B, T-40C | **9** | **done — merged (`c93176e`, PR #6)** |
| **T-40H** | **Drop the Scale flag everywhere, not just alongside a Scale badge** | T-40G | **9** | **done — merged (`5635e0d`, PR #8)** |
| **T-40I** | **"Flagged only" no longer matches a charges_no_fuel-only stop** | T-40H | **9** | **done — merged (`987cc02`, PR #10)** |
| **T-40J** | **Sort Transactions by date — newest or oldest first** | T-32, T-40, T-64 | **9** | **new** |
| **T-41** | **Overview screen** | T-33, T-39 | **9** | **done — merged (`1b36ae7`, PR #12)** |
| **T-42** | **Import screens, including quarantine** | T-34, T-39 | **9** | **done — merged (`3ce1791`, PR #13)** |
| **T-43** | **Receipt Queue screen — desktop and phone** | T-35, T-39 | **9** | **new** |
| **T-44** | **Other Charges screen** | T-36, T-39 | **9** | **new** |
| **T-45** | **Drivers, Trucks, Stations screens** | T-37, T-22, T-39 | **9** | **new** |
| **T-46** | **Plan vs Actual screen — live and backtest** | T-38, T-39 | **9** | **new** |
| **T-47** | **Settings — assignments, aliases, thresholds** | T-26, T-30, T-39 | **9** | **new** |
| **T-48** | **Historical invoice backfill** | T-31 | **10** | **done — merged (`f4c94a5`, PR #26)** |
| **T-49** | **Deploy v2** | T-40…T-47, T-50, T-51, T-60…T-66 | **10** | **new** |
| **T-50** | **Invoice fixtures, the test-worker crash, and real data out of history (before ship)** | T-40…T-47 | **10** | **new — deliberately deferred; lands before T-49** |
| **T-51** | **BVD price-sheet fixtures; `data/bvd-prices/` out of the repo** | — | **10** | **done — merged (`3fdeac0`, PR #33; `d536409`, PR #34)** |
| **T-52** | **Distances in miles end to end** | T-11, T-12 | **3** | **done — merged (`15181bf`, PR #37)** · landed before T-13/T-14 |
| **T-53** | **Migrations organised by domain (squash, pre-deploy)** | — | **3** | **done — merged (`c4c2ef9`, PR #40)** · landed before T-13 and T-49 |
| **T-54** | **ORS budget guard re-based to the provider's daily limits** | T-10 | **3** | **done — merged (`bc97210`, PR #42)** · landed before T-14's live measurement (14.3) and before T-16 |
| **T-55** | **Whole seconds when a plan is saved — `POST /plans` 500s on a real lane** | T-16 | **4** | **done — merged (`2571081`, PR #68)** |
| **T-56** | **Collapse `trucks` + `truck_profiles` into one table** | T-25, T-26 | **4** | **done — merged (`6f8d454`, PR #77)** |
| **T-57** | **"Show all sheet stations" silently does nothing on a failed fetch** | T-23 | **5** | **done — merged (`3c8e56f`, PR #79)** |
| **T-58** | **Real data out of the working tree — synthetic fleet roster, before the repo goes public** | T-25, T-51 | **10** | **in progress — history rewrite (T-50's original scope) still open** |
| **T-59** | **"Show all sheet stations" dots vanish on a re-plan** | T-23 | **5** | **done — PR pending** |
| **T-60** | **Canadian stations from BVD's travel-centre directory** | T-08 | **11** | **done — merged (`13e7c88`, PR #14)** |
| **T-61** | **Currency and native units at invoice import — the CA invoice** | T-31, T-62 | **11** | **done — merged (`22496c8`, PR #16)** |
| **T-62** | **CA fleet roster additions — 21 cards and drivers, 20 trucks** | T-58 | **11** | **done — merged (`043eee2`, PR #15)** |
| **T-63** | **Billing weeks — pair US and CA invoices on period end** | T-61 | **11** | **done — merged (`7c008b0`, PR #17)** |
| **T-64** | **Week selector, "Invoices in view", and Transactions in native units** | T-63, T-40, T-42 | **11** | **done — merged (`cfff981`, PR #18)** |
| **T-65** | **Overview — US, CA and combined panels** | T-63, T-64, T-66, T-41 | **11** | **new** |
| **T-66** | **Exchange rate on the CA invoice, entered by the dispatcher** | T-61, T-64 | **11** | **new** |

**Phase 11 (Canada invoices)** lands before T-49: T-61, T-63 and T-66 edit `0003_actuals_schema.sql` in place, which D21 allows only until the first deploy. Order: T-60 and T-62 in parallel → T-61 → T-63 and T-66 in parallel → T-64 → T-65. Decisions D24–D30 (PROJECT-SCOPE-v2 §A15) govern all seven.

**Critical path:** T-25 → T-27 → T-28 → T-29 → T-31 → T-32 → T-40. Everything else in Phase 8/9 hangs off T-31 and can run in parallel once it lands. T-38/T-46 additionally need the v1 plan path (T-11…T-19) finished.

---

## How to read this

Each ticket states a **goal**, the **files** it touches (new vs existing, and for existing files what specifically changes), its **dependencies**, and a **definition of done**. Tickets are sized to one branch and one session. A ticket is done when its DoD holds, not when the code looks finished.

---

# Phase 7 · Actuals data in

## T-25 · Actuals schema migration

**Priority 25. Blocks all of Phase 7–9.**

**Goal.** Every table in A11 exists, keyed and constrained, with the descriptor and drift test extended to cover them.

**Files.** (Squashed into five domain files by T-53 — D21.) New: `migrations/0003_actuals.sql`, `migrations/0004_actuals_seed.sql`. Modified: `backend/src/db/schema.ts` (descriptor), `backend/src/db/types.ts`. **Left alone:** `0001_init.sql` — it has applied; additions are new migrations, never edits (A16).

**Dependencies.** T-02.

**Definition of done.**
- [ ] `db:reset` applies all four migrations; a second `db:migrate` is a no-op.
- [ ] `fuel_stop_lines.billed_usd_per_gal` is `numeric(9,4)` — 4dp survives a round trip (`5.2395` in, `5.2395` out, not `5.24`).
- [ ] `invoices.file_sha256` and `invoices.invoice_number` are both unique; the same bytes twice are refused.
- [ ] `truck_assignments` rejects overlapping effective ranges for one driver.
- [ ] `fuel_cards` rejects a second active card for one driver (D19), but allows a replaced (inactive) card alongside a new active one.
- [ ] Deleting an invoice cascades to `fuel_stops`, `fuel_stop_lines` and `express_charges`; deleting a `station` referenced by a stop is **refused**.
- [ ] `anomalies.severity` rejects anything outside two values.
- [ ] The drift test covers every new table and **fails** on an injected wrong nullability.
- [ ] `0004_actuals_seed.sql` seeds the 27 cards, 27 units and 27 drivers from A19, each card carrying its driver and each driver one initial truck assignment.

---

## T-26 · Shared reference layer and effective-dated assignments

**Priority 26.**

**Goal.** One truck, one driver, one card, one station — usable by both halves — with assignment history that does not rewrite the past.

**Files.** New: `backend/src/catalog/trucks.ts`, `drivers.ts`, `cards.ts`, `assignments.ts` + tests. Modified: `backend/src/catalog/truckProfiles.ts` (T-03/T-18) — profiles stop pretending to be the roster (A16).

**Dependencies.** T-25.

**Definition of done.**
- [ ] `resolveAssignment(cardId, at)` returns the driver (`fuel_cards.driver_id`, permanent — D19) and the truck in force **at that instant** (`truck_assignments`), not the current one.
- [ ] Reassigning a driver's truck tomorrow does not change what yesterday's stop resolves to — asserted with a stop either side of the boundary.
- [ ] `formatUnitNumber` (T-01) is the only place unit numbers are validated for display (D18); `1012` is not truncated.
- [ ] Alias lookup is case- and whitespace-insensitive and shares its normaliser with `cityNormalize.ts`'s conventions (`Mc`/`Mt`/`St`, title casing).
- [ ] An unmatched driver name returns **unmatched**, never a best guess.
- [ ] A truck with no profile still resolves (profiles are optional metadata, not the key).

---

## T-27 · BVD invoice parser — CSV, with PDF fallback

**Priority 27.**

**Goal.** Bytes → header metadata + product lines + express rows, grouped into stops by base auth code. Pure, no I/O.

**Files.** New: `backend/src/invoice/parseInvoiceCsv.ts`, `parseInvoicePdf.ts`, `groupByAuthCode.ts` + tests, `backend/test/fixtures/invoices/sample-redacted.csv` (synthetic; the real invoice 999210 lives locally in gitignored `data/bvd-invoices/`, never committed — see `docs/BUILD-PLAN-v2.md` step 27.1).

**Dependencies.** T-25.

**Note (supersedes an earlier "Excel" framing, and the later "CSV primary" one — D13).** BVD issues two exports of each invoice, both verified against real downloads of 999210: an **emailed PDF** and a **portal CSV transaction export** — column headers, no letterhead — not an `.xlsx` workbook. `parseInvoiceCsv.ts` reuses `csv-parse` (already a dependency, same as v1's `parseBvdCsv.ts`); `parseInvoicePdf.ts` reads the PDF's text layer. The PDF is the fuller export and the one to prefer. The committed fixtures are synthetic, invented data shaped like each export — never a real invoice, which stays local-only in gitignored `data/bvd-invoices/` (see step 27.1 in `BUILD-PLAN-v2.md`). The CSV carries no header block at all, so that path derives one from the filename and the file's own transaction dates; neither fixture is reshaped to resemble the other.

**Definition of done.**
- [ ] Invoice 999210 parses to its header (number, period 2026-09-03→09, invoice date 09-10, due 09-11) and its printed per-code totals.
- [ ] **~60 stops** from the full line set, grouped by base auth code; auth `A252014353` groups the TA and DF lines and no others.
- [ ] Per-gallon prices parse at **4dp** with no rounding (`5.2395`, `5.9890`, `4.8890`).
- [ ] An unmapped product code **fails its row** with a reason code; it is never default-mapped to diesel (v1 §11.1's tripwire, reused).
- [ ] Express rows parse separately, including the row with **no driver name** and the flat `$3.00` fee on every one.
- [ ] `parseInvoicePdf` produces the same shape for the same invoice, and is only reached when the CSV path is absent (D13).
- [ ] The parser prints nothing and performs no I/O — asserted by a console spy.

---

## T-28 · Reconciliation and quarantine

**Priority 28. The ticket that protects the database.**

**Goal.** Parsed rows either balance against the printed totals and get written, or the invoice is quarantined with a report and **nothing is written**.

**Files.** New: `backend/src/invoice/reconcile.ts`, `backend/src/invoice/importInvoice.ts`, `backend/src/invoice/report.ts` + tests.

**Dependencies.** T-26, T-27. `importInvoice`'s two card/truck lookups (`getCardByNumber`, `getTruckByUnitNumber`) are T-26's catalog functions — the plain, unambiguous FK resolution needed to satisfy `fuel_stops.card_id`/`express_charges.truck_id`'s NOT NULL constraints. The harder resolution (assignment history, disagreement flags) stays T-29's job.

**Definition of done.**
- [ ] 999210 balances: TA $48,450.68 + DF $845.40 + S $90.50 + Express $1,543.13 = **$50,929.71**, and gallons reconcile per code (8,733.11 TA / 174.43 DF).
- [ ] A fixture with one cent of drift in DF **quarantines**: `invoices.status='quarantined'`, zero `fuel_stops`, zero `fuel_stop_lines`, zero `express_charges`, and an `invoice_rejections` row naming the code, the expected figure, the parsed figure and the offending lines.
- [ ] The imbalance report is **per product code**, not a single total — a compensating pair of errors must not pass.
- [ ] Re-uploading the same bytes returns the existing invoice unchanged and writes nothing (`file_sha256`).
- [ ] Re-uploading a **different** file for an invoice number already imported is refused with a distinct reason from the duplicate case.
- [ ] Promotion is one transaction: a failure mid-write leaves no partial invoice.
- [ ] `importInvoice` performs no HTTP, reads no argv, prints nothing.

---

## T-29 · Raw→resolved resolution at import

**Priority 29.**

**Goal.** Every stop carries a resolved truck and driver **and** the raw text that produced them, with disagreement recorded rather than smoothed over (D14, A9).

**Files.** New: `backend/src/resolve/resolveDriver.ts`, `resolveTruck.ts`, `resolveStation.ts` + tests. Modified: `backend/src/invoice/importInvoice.ts`.

**Dependencies.** T-26, T-28.

**Definition of done.**
- [ ] Truck resolves from `card_id` → `driver_id` (`fuel_cards`) + `occurred_at` via `truck_assignments` — **never** from the entered unit text.
- [ ] `unit_raw` and `driver_name_raw` are stored verbatim and never overwritten.
- [ ] The real cases resolve as specified: `0` entered on card 9000005 → truck **072**, flagged disagreement; `072` entered on two different cards the same day → two different trucks, no flag; `1012` entered by two drivers → resolved per card.
- [ ] Station text (`LOVES #294`) resolves through **T-08's existing store-number parser** — asserted by import, not reimplementation.
- [ ] A station that does not resolve leaves the stop with a null station and a named exclusion; it is never planned or reported against a guessed site.
- [ ] Express-charge driver names resolve through the alias table and land `matchStatus='unmatched'` when they miss, including the blank-name row.
- [ ] Re-resolving is an explicit job, not a side effect of reading.

---

## T-30 · Anomaly engine

**Priority 30.**

**Goal.** A10's six rules as pure functions over stored stops, two severities, thresholds from data.

**Files.** New: `backend/src/anomaly/rules/subGallon.ts`, `unitMismatch.ts`, `tooClose.ts`, `priceAbovePublished.ts`, `defRatio.ts`, `chargesNoFuel.ts`, `backend/src/anomaly/runAnomalies.ts` + tests.

**Dependencies.** T-29.

**Definition of done.**
- [ ] Each rule is pure, takes its threshold as an argument, and has its own test with a real 999210 case: 0.04 gal at LOVES #277; the `0`/072 mismatch; the 78-minute pair at LOVES #275; the 8.8% DEF ratio; the card carrying only a $15.25 scale charge.
- [ ] **Exactly two severities.** A third value is rejected by the schema and by type.
- [ ] 999210 yields the expected flag count and no false positives on the other stops — asserted as a count, not a spot check.
- [ ] `priceAbovePublished` degrades cleanly when no published price file exists for the date (A18 Q5): it reports *not computable*, not *no anomaly*.
- [ ] Dismissing an anomaly is recorded (`dismissed_at`), not deleted.
- [ ] Re-running the engine is idempotent — no duplicate rows for the same `(rule, subject)`.

---

## T-31 · `npm run import-invoice` + the 999210 import

**Priority 31. The end of Phase 7.**

**Goal.** One command imports a real invoice end to end, and the database holds a week of real actuals.

**Files.** New: `backend/src/cli/importInvoice.ts`, `migrations/0006_express_charges_truck_nullable.sql`. Modified: root `package.json`, `backend/src/db/schema.ts`, `backend/src/invoice/importInvoice.ts`, `backend/src/invoice/report.ts`.

**Dependencies.** T-28, T-29, T-30.

**Definition of done.**
- [ ] `npm run import-invoice -- ./data/bvd-invoices/invoice_999210.csv` prints the report and exits 0.
- [ ] Database holds: 1 invoice, ~60 `fuel_stops`, every product line, the express rows, resolved trucks/drivers, and the anomaly rows from T-30.
- [ ] `Σ fuel_stop_lines.amount_usd + Σ express_charges.total_usd = 50929.71` — asserted in SQL, not in application code.
- [ ] A quarantined file exits **non-zero** with the imbalance on stderr and writes no child rows.
- [ ] A duplicate exits 0 and says so.
- [ ] The CLI contains argv and stdout only.

---

# Phase 8 · Actuals API

Every ticket here: numbers not strings, nulls preserved, `currency: "USD"` on money, resolved fields shipped beside their raw twin (A13), RFC 9457 errors, auth enforced.

## T-32 · Transactions and transaction-detail endpoints

**Priority 32.**

**Goal.** `GET /transactions` and `GET /transactions/{id}` — the highest-traffic surface in the app.

**Files.** New: `backend/src/actuals/transactions.ts`, `backend/src/api/routes/transactions.ts` + tests.

**Dependencies.** T-31.

**Definition of done.**
- [ ] Every A8.3 filter works, including `anomalyOnly` and a real date range; filters compose.
- [ ] One row per stop; `lines[]` returned on request and the **stop total is the sum of all lines**, never diesel alone — asserted against auth `A252014353` at $255.13.
- [ ] Sort is stable and index-backed; `EXPLAIN` shows no sequential scan on `fuel_stops` for the default sort.
- [ ] Pagination is stable across pages with a fixed period.
- [ ] Detail carries raw values, resolution source, receipt status with checker and timestamp, anomaly flags, invoice link, and a plan link when a dispatched plan covered that truck and date.
- [ ] Unknown id → 404 problem+json.

---

## T-33 · Overview endpoint

**Priority 33.**

**Goal.** `GET /overview?period=` returns A8.1 in one call.

**Files.** New: `backend/src/actuals/overview.ts`, `backend/src/api/routes/overview.ts` + tests.

**Dependencies.** T-31.

**Definition of done.**
- [ ] Against 999210 every KPI matches A5 exactly, including `$50,929.71`, `8,733.11 gal`, `$5.55/gal` average billed, `48 of 60` receipts, `3` anomalies.
- [ ] **Average billed price is computed gallons-weighted**, not as a mean of prices — asserted against a fixture where the two differ.
- [ ] Discount is returned but is **not** the primary metric in the payload's own ordering (A6.3, A9).
- [ ] The trend series covers the last N periods and omits nothing silently — a missing period is absent, not zero-filled.
- [ ] Other charges split scale ($90.50) from express ($1,543.13) and surface the fee total separately.

---

## T-34 · Invoice import endpoints and history

**Priority 34.**

**Goal.** `POST /invoices/import`, `GET /invoices`, `GET /invoices/{id}` — the HTTP wrapper over T-28.

**Files.** New: `backend/src/api/routes/invoices.ts` + tests.

**Dependencies.** T-31.

**Definition of done.**
- [ ] A balanced file returns **200 with a write preview** and, on confirm, the imported invoice.
- [ ] An imbalanced file returns **200 with `status: "quarantined"`** and the full imbalance report — *not* a 4xx (D12).
- [ ] A duplicate returns **409 problem+json** distinguishable from the quarantine case by the caller.
- [ ] `GET /invoices` paginates newest-first with number, period, total, status, imported-at.
- [ ] The route contains no parsing or reconciliation logic — it calls T-28.

---

## T-35 · Receipt queue endpoints

**Priority 35.**

**Goal.** A queue that can be worked one item at a time, in batch, and later automated.

**Files.** New: `backend/src/actuals/receipts.ts`, `backend/src/api/routes/receipts.ts` + tests.

**Dependencies.** T-31.

**Definition of done.**
- [ ] `GET /receipt-queue` returns unconfirmed stops with the context A8.5 needs, plus `progress: {done, total}`.
- [ ] `POST /receipt-checks` writes one append-only `receipt_checks` row with `checked_by` and `checked_at`; the stop's status derives from the latest check.
- [ ] Batch confirm for one driver writes one row per stop, in one transaction, and is idempotent.
- [ ] Skip does **not** write a check and does not remove the item from the queue.
- [ ] Queue order is deterministic (D17: an exceptions-first ordering must be expressible without a schema change).
- [ ] A confirmed stop never reappears.

---

## T-36 · Other-charges endpoints

**Priority 36.**

**Goal.** `GET /express-charges` with the quirks intact.

**Files.** New: `backend/src/actuals/otherCharges.ts`, `backend/src/api/routes/expressCharges.ts` + tests.

**Dependencies.** T-31.

**Definition of done.**
- [ ] The blank-driver row (tractor 073, $200.00 + $3.00 = $203.00, "lumper") returns with a null driver and `matchStatus: "unmatched"` — **never** a guessed driver.
- [ ] `sutton` / `Finn` style free text resolves through aliases where it can and is flagged where it cannot.
- [ ] The fee total is a separate field, not folded into the amount.
- [ ] Category and note are returned verbatim.
- [ ] Sum of `total_usd` over the period equals the invoice's printed express total.

---

## T-37 · Analysis endpoints — drivers, trucks, stations

**Priority 37.**

**Goal.** Period rollups and detail series for the three reference entities.

**Files.** New: `backend/src/actuals/drivers.ts`, `trucks.ts`, `stations.ts`, routes + tests.

**Dependencies.** T-31.

**Definition of done.**
- [ ] Driver list returns spend, gallons, gallons-weighted average billed $/gal, receipt compliance %, anomaly count.
- [ ] Driver detail returns their average billed price **against the fleet average** for the same period, favoured stations, and the DEF:diesel gallon ratio.
- [ ] Truck detail returns the assigned card **and the assignment history**, and past stops resolve against the assignment in force then (T-26).
- [ ] `GET /stations/{id}/billed-prices` shows price per site per day and demonstrates the A6.5 finding: every card at site 25334 on 9/7 (three) and 9/9 (one) at **5.5208**. *(Measured on the real 999210 file: A6.5's "five drivers on 9/7 and 9/9" is wrong — five is the station's total diesel rows, including 9/3 at 5.6593.)*
- [ ] A discrepancy field is present and is `null` (not `0`) when no published price file exists (A18 Q5).

---

## T-38 · Plan vs Actual matching and endpoints

**Priority 38. The payoff.**

**Goal.** A14 as a pure matcher plus two endpoints — live and backtest.

**Files.** New: `backend/src/planActual/match.ts`, `backtest.ts`, `backend/src/api/routes/planActual.ts` + tests.

**Dependencies.** T-19 (dispatched flag), T-31.

**Definition of done.**
- [ ] `match()` is pure and matches on truck + date window + station.
- [ ] Only **dispatched** plans are matched — a non-dispatched plan covering the same truck and date produces no matches, asserted.
- [ ] `skipped_recommendation` and `unplanned_stop` are returned as rows, not omissions.
- [ ] `delta_usd` on a matched pair uses actual gallons × (actual billed − planned expected), and the fleet rollup is the sum.
- [ ] The three exclusion classes (split fill, unresolved station text, no archived price file) are **named and counted**, never silently dropped.
- [ ] Backtest re-solves a historical invoice against the archived price file for that date using **`dp_v1` unchanged** — asserted by the optimiser's own tests still requiring no I/O.
- [ ] With zero overlap the endpoint returns a **well-formed empty result with its coverage counts**, not an error and not an empty array with no context.

---

# Phase 9 · Actuals UI

The design file **`CH Fuel App.dc.html`** is the visual authority. It already realises the shell, Transactions and Plan vs Actual, plus the ported Plan and Plans screens. Every screen below reuses A9's two conventions. Desktop-first except where stated.

## T-39 · App shell — sidebar IA and invoice-period selector

**Priority 39. Supersedes the tab bar (D15).**

**Goal.** The shell every Phase 9 screen mounts into.

**Files.** New: `frontend/src/app/(app)/layout.tsx`, `frontend/src/components/Sidebar.tsx`, `TopBar.tsx`, `InvoicePeriodSelector.tsx`. Modified: `page.tsx`, `Header.tsx` (absorbed).

**Dependencies.** T-21.

**Definition of done.**
- [ ] A7's eleven destinations in three groups plus Settings; active state marked; Receipt Queue carries a live pending badge.
- [ ] The period selector defaults to the most recent invoice and governs Actuals and Analysis; **Plan screens ignore it** and show their own price-sheet date.
- [ ] Standing receipt and flag counts appear in the top bar and come from the API, not constants.
- [ ] The v1 Plan and Plans screens mount inside the shell with their v1 behaviour intact.
- [ ] Navigation does not refetch the period on every route change.
- [ ] Sidebar tolerates a fourth group without redesign (A18 Q4).

---

## T-40 · Transactions screen

**Priority 40. Sets the tone for every other table.**

**Goal.** A8.3 at real density, wired to T-32.

**Files.** New: `frontend/src/app/(app)/transactions/page.tsx`, `TransactionsTable.tsx`, `StopExpansion.tsx`, `RawResolved.tsx`, `AnomalyFlag.tsx`, `frontend/src/lib/formatMoney.ts`.

**Dependencies.** T-32, T-39.

**Definition of done.**
- [ ] Columns, filters and grouping per A8.3; every filter round-trips to the query string so a filtered view is linkable.
- [ ] **Billed $/gal is the dominant numeral**; retail muted; discount a subline (A9.1) — asserted by a component test on computed font size, not by eye.
- [ ] `RawResolved` implements all three A9.2 states and is the **only** component that renders raw invoice text anywhere in the app.
- [ ] Gallons 2dp, prices 4dp, money 2dp, right-aligned, tabular figures; a USD marker is present on the money column.
- [ ] Expanding a row shows every product line and an unmissable stop total ($238.26 for `A900000001`).
- [ ] The table scrolls horizontally as one unit — header, rows and totals footer stay aligned; the expansion never overlaps the panel beside it.
- [ ] Keyboard: arrow-key row movement, `enter` to expand, `/` to focus search.
- [ ] Anomaly flags render at two severities only.

---

## T-40A · Remove the DEF ratio anomaly rule

**Priority 40A — polish pass on T-40's Transactions screen, from dispatcher review 2026-09-26.**

**Goal.** `def_ratio` no longer runs as an anomaly rule. Stops with a high DEF-to-diesel ratio produce no finding, and the Flags column never shows a "DEF ratio" chip.

**Why.** Not needed for how this fleet is dispatched — DEF top-offs vary enough in normal use that the rule mostly adds noise to the Flags column rather than directing attention anywhere useful, at only "amber" severity to begin with.

**Fix.** Remove `"def_ratio"` from `RULE_NAMES` and its whole call path in `runAnomalies.ts`. Delete `backend/src/anomaly/rules/defRatio.ts` and `defRatio.test.ts`. Drop the `def_ratio` row from `anomaly_thresholds`'s seed — `migrations/synthetic/0004_actuals_config_seed.sql` and the mirrored `migrations/real/0004_actuals_config_seed.sql` (editing 0004 directly is fine pre-deploy, D21). Remove the `def_ratio` entry from `AnomalyFlag.tsx`'s `RULE_LABELS`. Clear any `def_ratio` rows a past run already wrote (`DELETE FROM anomalies WHERE rule = 'def_ratio'`, one-off, alongside the code change) so no orphaned flag with a since-removed rule lingers in the UI. Update `runAnomalies.test.ts` and any sibling test asserting a fixed per-rule or total finding count to drop the rule.

**Files.** Modified: `backend/src/anomaly/runAnomalies.ts`, `migrations/synthetic/0004_actuals_config_seed.sql`, `migrations/real/0004_actuals_config_seed.sql`, `frontend/src/components/AnomalyFlag.tsx`, `backend/test/integration/runAnomalies.test.ts` (and sibling tests with a fixed finding count). Deleted: `backend/src/anomaly/rules/defRatio.ts`, `backend/src/anomaly/rules/defRatio.test.ts`.

**Not in scope.** `backend/src/actuals/drivers.ts`'s own DEF-ratio figure — a separate, driver-level consumption statistic for the not-yet-built Drivers screen (T-45), computed directly from `fuel_stop_lines` rather than the anomaly engine. That stays; only the per-stop anomaly rule goes.

**Dependencies.** T-30, T-40.

**Definition of done.**
- [ ] `runAnomalies` produces zero `def_ratio` findings on any invoice, existing or newly imported.
- [ ] No orphaned `def_ratio` row remains in `anomalies`.
- [ ] `npm run verify` green.

---

## T-40B · Relabel the "No fuel" flag to "Scale"

**Priority 40B — polish pass on T-40, from dispatcher review 2026-09-26.**

**Goal.** The `charges_no_fuel` anomaly flag reads **"Scale"** in the Flags column, not "No fuel".

**Why.** Every real occurrence of this flag to date has been BVD's scale-weighing charge (§A10's own worked example — a card carrying only a $15.25 scale charge). "No fuel" reads like an error to a dispatcher scanning the column; "Scale" reads as the routine, expected thing it actually is.

**Fix.** Display-only change: `RULE_LABELS.charges_no_fuel` in `frontend/src/components/AnomalyFlag.tsx` becomes `"Scale"`. The rule's slug (`charges_no_fuel`), its detection logic (a stop with a charge and zero fuel gallons), and every stored `anomalies.rule = 'charges_no_fuel'` row are untouched — only the label a dispatcher reads changes.

**Files.** Modified: `frontend/src/components/AnomalyFlag.tsx`, `frontend/src/components/AnomalyFlag.test.tsx`.

**Not in scope.** Renaming the backend rule slug itself (`charges_no_fuel`) — that touches existing `anomalies` rows, `anomaly_thresholds`, and every test keyed on the string, for no behavioral gain over a label change.

**Dependencies.** T-30, T-40.

**Definition of done.**
- [x] A `charges_no_fuel` finding renders as "Scale" in the Flags column.
- [x] `npm run verify` green.

---

## T-40C · Products-bought column on the transaction row

**Priority 40C — polish pass on T-40, from dispatcher review 2026-09-26.**

**Goal.** Each transaction row shows which products it carries (e.g. Diesel, DEF) as small badges, visible without expanding the row — the same way anomaly flags are already visible inline.

**Why.** Today, seeing whether a stop bought DEF alongside diesel means expanding the row. The data is already on the wire: `frontend/src/app/(app)/transactions/page.tsx` already requests `includeLines: true` for the *whole* list (purely so `StopExpansion` can open instantly), so every row's `lines[]` is already sitting on the client, unused at the row level. This is a pure frontend read of existing data — no new backend request, no schema change.

**Fix.** Add a `columnHelper.display({ id: "products", ... })` column to `TransactionsTable.tsx` (position TBD against the live layout — likely beside Flags) that reads `row.original.lines`, dedupes by `productCode`, and renders one small badge per distinct product via the existing `productLabel()` helper (`frontend/src/lib/transactionFilterConstants.ts`). Reuse the Flags column's visual language (small uppercase pill, `.anomaly-flag`'s sizing) but a neutral color — these are facts, not warnings. A row with `lines` undefined (shouldn't happen given `includeLines: true`, but the field is optional in the type) renders no badges rather than guessing from the diesel-only `gallons` summary.

**Files.** Modified: `frontend/src/components/TransactionsTable.tsx`, `frontend/src/App.css` (new badge styling), `frontend/src/components/TransactionsTable.test.tsx`.

**Not in scope.** Changing `StopExpansion`'s own product-line table (price, gallons, amount per line) — this column is a summary at a glance, not a replacement for the full detail.

**Dependencies.** T-32, T-40.

**Definition of done.**
- [x] A stop with both a TA and a DF line shows both a "Diesel" and a "DEF" badge collapsed.
- [x] A stop with one product shows only that badge.
- [x] `npm run verify` green.

---

## T-40D · Filter bar spacing

**Priority 40D — polish pass on T-40, from dispatcher review 2026-09-26.**

**Goal.** The filter bar's controls (search box, Driver/Truck/Card/State/Product/Receipt selects, the Flagged-only toggle, and the count + Clear group) read as one evenly spaced row — not the current uneven bunching — at both full desktop width and at the point the row wraps.

**Why.** Reported live against the running Transactions screen. `.tx-toolbar-row` (`frontend/src/App.css`) mixes a flex-growing search input, several `flex: none` filter groups each with their own internal gap, and a `margin-left: auto` meta block on the end — a combination that can crowd or misalign once the row wraps at narrower widths.

**Fix.** Needs a side-by-side look at the live screen before committing to specific values — this ticket starts with that review, not a blind CSS edit. Likely touches `.tx-toolbar-row`'s gap, `.tx-filter`'s internal spacing, and how `.tx-toolbar-meta` behaves once the row wraps.

**Files.** Modified: `frontend/src/App.css` (`.tx-toolbar-row`, `.tx-filter`, `.tx-filter-label`, `.tx-filter-select`, `.tx-toolbar-meta` and neighbors).

**Dependencies.** T-40.

**Definition of done.**
- [x] Filter bar spacing confirmed even at desktop width and at the wrap breakpoint — the one visual check CLAUDE.md allows in place of an assertion (as T-04 step 4.2 does).
- [x] `npm run verify` green (no test-suite claim here beyond "nothing else broke" — this ticket is visual).

---

## T-40E · Unit column: invoice unit primary, assigned truck secondary

**Priority 40E — polish pass on T-40, from dispatcher review 2026-09-26.**

**Goal.** In the Unit column, the large/primary value becomes the unit number as entered on the invoice (`unit_raw` — what was actually pumped into that day); the driver's normally-assigned truck (resolved via the card→driver→assignment lookup) becomes the smaller secondary line. The `unit_mismatch` anomaly flag keeps firing exactly as it does today when the two disagree — this is a display-emphasis swap only, not a change to what counts as a mismatch.

**Why.** The assigned truck is a schedule expectation; the invoice's raw unit is what actually happened that day, and a driver can legitimately run a different truck (a breakdown, a shop day) without that being wrong — just worth a glance via the existing flag. Today `RawResolved` (shared by the Driver and Unit columns; confirmed via `truckRawResolved()` in `backend/src/actuals/transactions.ts` and `resolveTruckForStop()` in `backend/src/resolve/resolveTruck.ts`) always renders `resolved` big and `raw` small — correct for Driver, backwards for Unit.

**Fix.** Add a prop to `frontend/src/components/RawResolved.tsx` (e.g. `primary?: "resolved" | "raw"`, defaulting to `"resolved"` so every other caller, including the Driver column, is unaffected) and pass `primary="raw"` from the Unit column only, in `TransactionsTable.tsx`. Update the component's `resolved` and `disagreeing` states so each renders raw-big/resolved-small when `primary="raw"` — `unmatched` already shows raw alone and needs no change. No change to `agrees`, `truckRawResolved()`, or the `unit_mismatch` rule: they already compute exactly the right mismatch signal; only which already-computed value is styled as primary changes.

**Files.** Modified: `frontend/src/components/RawResolved.tsx`, `frontend/src/components/TransactionsTable.tsx`, `frontend/src/App.css` (if the swapped state needs its own class), `frontend/src/components/RawResolved.test.tsx`.

**Not in scope.** `backend/src/actuals/transactions.ts`'s `truckRawResolved()` and `backend/src/anomaly/rules/unitMismatch.ts` — both already correct; only frontend emphasis changes.

**Dependencies.** T-40.

**Definition of done.**
- [x] A stop where the invoice unit matches the assigned truck shows the invoice unit as the primary value.
- [x] A stop where they disagree still shows the `unit_mismatch` flag in the Flags column, with the invoice's (pumped) unit primary and the assigned truck as the smaller secondary value.
- [x] The Driver column's rendering is unchanged — still resolved-primary.
- [x] `npm run verify` green.

---

## T-40F · Sub-gallon flag: diesel only, not DEF

**Priority 40F — polish pass on T-40, from dispatcher review 2026-09-26.**

**Goal.** `sub_gallon` fires only on an implausibly small **diesel** (`TA`) line; a small DEF (`DF`) line no longer trips it.

**Why.** DEF top-offs are routinely well under a gallon in normal use, unlike diesel. Flagging a tiny DEF line the same way an implausibly small diesel purchase is flagged produces a finding that's almost always noise for DEF specifically.

**Fix.** Config-only — `subGallon.ts` already reads its eligible `productCodes` from `anomaly_thresholds` (D16: thresholds are data, not constants), currently seeded `["TA", "DF"]`. Change the `sub_gallon` row in `migrations/synthetic/0004_actuals_config_seed.sql` and the mirrored `migrations/real/0004_actuals_config_seed.sql` to `productCodes: ["TA"]`. No change to `subGallon.ts` itself.

**Files.** Modified: `migrations/synthetic/0004_actuals_config_seed.sql`, `migrations/real/0004_actuals_config_seed.sql`, and any test fixture that currently relies on a sub-gallon DEF line being flagged (`backend/src/anomaly/rules/subGallon.test.ts`, `backend/test/integration/runAnomalies.test.ts`).

**Not in scope.** A blanket "DEF is exempt from every rule" policy — `charges_no_fuel` still considers DEF where relevant; this change is specific to `sub_gallon`.

**Dependencies.** T-30, T-40.

**Definition of done.**
- [x] A DEF line under the configured minimum no longer produces a `sub_gallon` finding.
- [x] A diesel line under the minimum still does.
- [x] `npm run verify` green.

**Correction (2026-09-30, caught live post-merge).** The Fix above was incomplete for any database that had already seeded the `sub_gallon` row before this ticket merged: 0004's `INSERT ... ON CONFLICT (rule) DO NOTHING` only ever applies to a fresh database — by design, so it never clobbers a value someone's since edited in Settings — but that also means it silently skips a legitimate code change to an already-seeded row. `runAnomalies` compounds it: it only upserts findings a rule currently produces and never deletes one a rule no longer does, so a pre-existing DEF `sub_gallon` finding survives a re-run untouched. T-40A hit this same class of problem retiring `def_ratio` and called out the one-off cleanup in its own Fix; this ticket's Fix should have too. The missing step, run once per already-seeded environment: `UPDATE anomaly_thresholds SET config = '{"minGallons": "1.00", "productCodes": ["TA"]}'::jsonb WHERE rule = 'sub_gallon'` followed by `DELETE FROM anomalies WHERE rule = 'sub_gallon' AND detail->>'productCode' = 'DF'`. Applied to the local dev database (one stale finding, Lovepreet Singh's 0.46 gal DEF stop); needs the same pair run against any other already-seeded environment before the next deploy.

---

## T-40G · Colour-code product badges; drop the redundant Scale flag

**Priority 40G — polish pass on T-40C, from dispatcher review.**

**Goal.** The Products column's badges (T-40C) are colour-coded per product — the site's light blue for Diesel, navy for DEF, green for Scale — instead of one neutral grey for every product. Separately, when a stop carries a Scale line, the Flags column no longer also shows the `charges_no_fuel`/"Scale" flag (T-40B) for that stop — the Products badge already states the fact, so the Flags column stops repeating it.

**Why.** T-40C shipped every product badge in the same neutral grey, which reads fine for an unfamiliar product but doesn't let a dispatcher tell Diesel from DEF at a glance the way colour would. Separately, once Products shows a "Scale" badge, a stop with only a scale charge now says the same thing twice — once as a fact (Products: Scale) and once as a warning (Flags: Scale) — which reads as more alarming than it is.

**Fix.**
- `frontend/src/lib/transactionFilterConstants.ts`: add a `productBadgeVariant(code): string` alongside `productLabel`, mapping `InvoiceProductType` → `"diesel" | "def" | "scale" | "neutral"` (same tripwire map, same unmapped-code fallback as `productLabel`).
- `frontend/src/components/TransactionsTable.tsx`: the `products` column applies `product-badge product-badge-${productBadgeVariant(line.productCode)}` per badge. The `flags` column reads `row.original.lines`; when any line's product is `scale`, it filters `charges_no_fuel` out of the flags it renders for that row. Every other flag (including `charges_no_fuel` on a stop with *no* scale line — e.g. a trailer- or cash-only charge) is unaffected.
- `frontend/src/App.css`: `.product-badge` keeps `.anomaly-flag`'s pill sizing; `.product-badge-diesel`/`-def`/`-scale` use the site's existing `--color-accent` (light blue), `--color-accent-800` (navy) and `--color-candidate` (green) as solid fills with white text; `.product-badge-neutral` keeps T-40C's grey for the remaining product types (Trailer, Additive, Oil, Lubricant, Cash).

**Files.** Modified: `frontend/src/lib/transactionFilterConstants.ts`, `frontend/src/components/TransactionsTable.tsx`, `frontend/src/App.css`, `frontend/src/components/TransactionsTable.test.tsx`.

**Not in scope.** The `charges_no_fuel` detection rule itself or its stored `anomalies` rows (backend, T-30) — this is a display-only suppression in the Flags column, same boundary T-40B drew.

**Dependencies.** T-40B, T-40C.

**Definition of done.**
- [x] A Diesel badge, a DEF badge and a Scale badge render in three visually distinct colours (light blue / navy / green).
- [x] A stop with a Scale product line and a `charges_no_fuel` finding shows the Scale product badge but not the Scale flag.
- [x] ~~A stop with a `charges_no_fuel` finding and no Scale line (e.g. a cash-only charge) still shows the Scale flag.~~ Superseded by T-40H — the Scale flag is no longer shown in either case.
- [x] `npm run verify` green.

---

## T-40H · Drop the Scale flag everywhere, not just alongside a Scale badge

**Priority 40H — polish pass on T-40G, from dispatcher review 2026-09-29.**

**Goal.** The Flags column never shows the `charges_no_fuel`/"Scale" flag, on any stop — not only the ones that also carry a Scale product line.

**Why.** T-40G suppressed the flag only when the stop's own Products badges already stated the same fact ("Scale"), reasoning that repeating it as a warning overstated a routine charge. Dispatcher review found the same overstatement applies to every `charges_no_fuel` stop, not just scale ones — a cash-only or other no-fuel charge is a routine business fact visible in the row's line items, not something that needs flagging as an anomaly.

**Fix.** `frontend/src/components/TransactionsTable.tsx`'s `flags` column: drop the `hasScaleLine` conditional and always filter `charges_no_fuel` out of the flags rendered for a row — the Scale-line branch T-40G added is no longer a special case, it's the only case. `isScaleProductCode` (`frontend/src/lib/transactionFilterConstants.ts`) becomes unused once that conditional is gone and is deleted along with its import.

**Files.** Modified: `frontend/src/components/TransactionsTable.tsx`, `frontend/src/lib/transactionFilterConstants.ts`, `frontend/src/components/TransactionsTable.test.tsx`.

**Not in scope.** The `charges_no_fuel` detection rule or its stored `anomalies` rows (backend, T-30), and any anomaly count that sums undismissed anomalies system-wide (T-39/T-41's `openAnomalyCount`) — this is a Transactions Flags-column display suppression only, the same boundary T-40B/T-40G drew. `AnomalyFlag.tsx`'s `charges_no_fuel` → "Scale" label mapping is untouched.

**Dependencies.** T-40G.

**Definition of done.**
- [x] A stop with a `charges_no_fuel` finding and a Scale product line shows the Scale product badge but not the Scale flag (unchanged from T-40G).
- [x] A stop with a `charges_no_fuel` finding and no Scale line (e.g. a cash-only charge) also no longer shows the Scale flag.
- [x] Every other flag (`unit_mismatch`, `too_close`, `sub_gallon`, `price_above_published`) is unaffected.
- [x] `npm run verify` green.

---

## T-40I · "Flagged only" no longer matches a charges_no_fuel-only stop

**Priority 40I — polish pass on T-40H, from dispatcher review 2026-09-30.**

**Goal.** The "Flagged only" checkbox on Transactions (`anomalyOnly`) never matches a stop whose *only* undismissed anomaly is `charges_no_fuel` — the same stop T-40H already made the Flags column render with zero flag pills.

**Why.** T-40H stopped rendering the `charges_no_fuel`/"Scale" flag anywhere in the Flags column, but never touched `anomalyOnly`'s `EXISTS` clause, which still matches on any undismissed anomaly regardless of rule. The result: a cash- or scale-only stop with no other anomaly still passes "Flagged only" and appears in that filtered list, but its Flags cell renders empty — it looks flagged with nothing to show why. `charges_no_fuel` is no longer surfaced as a flag anywhere on this screen (T-40H's own framing: "the Scale flag is no longer shown in either case"), so it should not be able to satisfy a filter whose whole purpose is "show me the rows with a flag."

**Fix.** `backend/src/actuals/transactionQuery.ts`'s `anomalyOnly` condition adds `AND a.rule <> 'charges_no_fuel'` to the existing `EXISTS` clause. No other filter changes; `state` and `product` stay `EXISTS`-based as before. A stop with `charges_no_fuel` *and* another undismissed anomaly is unaffected — the `EXISTS` still finds the other row.

**Files.** Modified: `backend/src/actuals/transactionQuery.ts`, `backend/src/actuals/transactionQuery.test.ts`, `backend/test/integration/transactions.test.ts` (the real-fixture `anomalyOnly` count comparison excludes `charges_no_fuel` the same way, so it still cross-checks against `listTransactions`'s own count).

**Not in scope.** `openAnomalyCount` (T-39/T-41, system-wide, regardless of invoice) and any driver/truck/station anomaly-count rollup — none of those render a Flags column or claim to mean "this row has a flag chip," so T-40H's own scope boundary (display-only suppression, backend `anomalies` rows untouched) still holds for them. The `charges_no_fuel` detection rule itself and `AnomalyFlag.tsx`'s label mapping are untouched.

**Dependencies.** T-40H.

**Definition of done.**
- [x] A stop whose only undismissed anomaly is `charges_no_fuel` is absent from the "Flagged only" result set.
- [x] A stop with `charges_no_fuel` plus another undismissed anomaly (e.g. `unit_mismatch`) still appears, with that other flag shown.
- [x] Every other filter (`state`, `product`, `receiptStatus`, date range, etc.) composes with `anomalyOnly` exactly as before.
- [x] `npm run verify` green.

---

## T-40J · Sort Transactions by date — newest or oldest first

**Priority 40J — follow-up to T-40, from dispatcher review 2026-10-05 (raised during T-64).**

**Goal.** The Transactions table's "Date · time" header toggles the row order between newest first (the default) and oldest first.

**Why.** §A8.3 calls the screen "sortable", and `GET /transactions` has sorted since T-32 (`sortField` = `occurred_at` | `total`, `sortDirection` = `asc` | `desc`, default `occurred_at desc`), but T-40 never wired a control: the frontend sends neither param, so the rows only ever come in the API's default order. Reading a week from its first stop forward — reconciling against a driver's paper log, say — currently means scrolling to the bottom and reading up.

**Design.**
- The "Date · time" header becomes a button with a direction mark (`↓` newest first, `↑` oldest first) and `aria-sort` (`descending` / `ascending`). A click flips it.
- The page sends `sortField: "occurred_at"` and `sortDirection` on the table's request; the order comes from the server, not a client-side re-sort, so it stays index-backed (T-32's DoD) and holds under every filter and under All invoices (T-64), where both invoices' rows interleave by time.
- The direction round-trips through the URL like every other filter (T-40 DoD: a filtered view is linkable) — `sort=asc` when oldest first, absent for the default — and **Clear** resets it with the filters.
- The free-text search (client-side) and the row keyboard navigation (↑/↓/Enter) keep working on the sorted rows; the active row resets to the first.

**Files.** Modified: `frontend/src/components/TransactionsTable.tsx` (header button), `frontend/src/app/(app)/transactions/page.tsx` (sends the sort), `frontend/src/hooks/useTransactionFilters.ts` (the `sort` URL key), `frontend/src/App.css` (+ tests). No backend change.

**Not in scope.** Sorting by total, or by any other column — the API offers `total`, but nobody has asked for it; adding it later is the same header pattern on the Total column. The filter-option seed fetch (`useTransactionFilterOptions`) is unsorted on purpose and stays so.

**Dependencies.** T-32, T-40, T-64.

**Definition of done.**
- [ ] The table opens newest first with no sort param in the URL or the request (the API's default).
- [ ] Clicking "Date · time" requests `sortField=occurred_at&sortDirection=asc`, writes `sort=asc` to the URL, and shows `↑` with `aria-sort="ascending"`; clicking again returns to newest first and removes `sort` from the URL — asserted against the request made.
- [ ] A URL with `sort=asc` opens oldest first; **Clear** returns to newest first.
- [ ] Under All invoices the request carries the sort and no `currency`, so both invoices' rows interleave by date.
- [ ] `npm run verify` green.

---

## T-41 · Overview screen

**Priority 41.**

**Goal.** A8.1 — how last week went, in five seconds.

**Files.** New: `frontend/src/app/(app)/overview/page.tsx`, `KpiCard.tsx`, `BilledPriceTrend.tsx`, `TopSpendByDriver.tsx`, `AnomalyDigest.tsx`.

**Dependencies.** T-33, T-39.

**Definition of done.**
- [ ] KPI cards show the A5 figures with a USD marker; **average billed price is the visually dominant card** and discount is subordinate (A6.3).
- [ ] Trend and bars use Recharts; a period with no data is a gap, not a zero.
- [ ] The anomaly digest links into Transactions with the `anomalyOnly` filter pre-applied.
- [ ] The screen makes exactly **one** API call.
- [ ] Empty state for "no invoice imported yet" is designed, not a spinner forever.

---

## T-42 · Import screens, including quarantine

**Priority 42.**

**Goal.** A8.2's three states, with quarantine as a **full screen**.

**Files.** New: `frontend/src/app/(app)/import/page.tsx`, `Dropzone.tsx`, `ParsingState.tsx`, `ReconciliationPreview.tsx`, `QuarantineScreen.tsx`, `ImportHistory.tsx`.

**Dependencies.** T-34, T-39.

**Definition of done.**
- [ ] Parsing shows file name, progress and row count.
- [ ] The preview shows the **balance check explicitly**, per product code, summing to $50,929.71, with a confirm that writes.
- [ ] Quarantine is a full screen naming the failing code, expected vs parsed, and the offending rows, and states plainly that nothing was written.
- [ ] Duplicate upload renders the designed rejection message, distinct from quarantine.
- [ ] History lists invoice number, period, total, status and imported-at, and a quarantined row can be reopened.
- [ ] A quarantined invoice is reachable from the sidebar without re-uploading the file.

---

## T-43 · Receipt Queue screen — desktop and phone

**Priority 43. The only write-heavy screen.**

**Goal.** A8.5, optimised for speed and built to survive automation.

**Files.** New: `frontend/src/app/(app)/receipt-queue/page.tsx`, `QueueCard.tsx`, `BatchConfirm.tsx`.

**Dependencies.** T-35, T-39.

**Definition of done.**
- [ ] One transaction at a time with enough context to search Samsara (driver, date/time, truck, station, gallons, total).
- [ ] `Y` / `N` / `S` keyboard shortcuts, visible on screen, working without focus gymnastics.
- [ ] Progress reads `12 of 60`.
- [ ] Batch confirm for a driver who uploaded everything, with an explicit count before it writes.
- [ ] **Works on a phone**: hit targets ≥ 44px, one-thumb reach for Y/N, no horizontal scroll at 390px.
- [ ] The layout does not assume every item needs a decision — an exceptions-only queue renders correctly with no code change (D17).
- [ ] An optimistic decision that fails on the server rolls back visibly.

---

## T-44 · Other Charges screen

**Priority 44.**

**Goal.** A8.6, with the quirks visible rather than tidied away.

**Files.** New: `frontend/src/app/(app)/other-charges/page.tsx`, `ExpressTable.tsx`.

**Dependencies.** T-36, T-39.

**Definition of done.**
- [ ] All A8.6 columns; the fee total surfaced separately from the amount total.
- [ ] A row with no driver renders as **unmatched**, using A9.2's raw treatment for the free-text name.
- [ ] Free-text names that did not match a driver are visibly unmatched and offer "add as alias" into Settings.
- [ ] Category filter and date range; totals reconcile to the invoice's express total.

---

## T-45 · Drivers, Trucks, Stations screens

**Priority 45.**

**Goal.** A8.7–A8.9, reusing the v1 map treatment.

**Files.** New: `frontend/src/app/(app)/drivers/[...]`, `trucks/[...]`, `stations/[...]` pages and their list/detail components.

**Dependencies.** T-37, T-22, T-39.

**Definition of done.**
- [ ] Driver and truck lists share one table component with the Transactions formatting rules.
- [ ] Driver detail plots their average billed price against the fleet average and shows the DEF:diesel ratio.
- [ ] Truck detail shows the card assignment **history**, with a note that reassignment changes how past stops resolve.
- [ ] Stations list + map reuse MapLibre and the T-22 layer styling; city-tier stations still draw their uncertainty circle.
- [ ] Station detail shows billed price history per day and a place for a published-price discrepancy that renders "not computable" when there is no file.

---

## T-46 · Plan vs Actual screen — live and backtest

**Priority 46.**

**Goal.** A8.10, both views, and an empty state that will be seen for months.

**Files.** New: `frontend/src/app/(app)/plan-actual/page.tsx`, `LivePerformance.tsx`, `HistoricalBacktest.tsx`, `PvaEmptyState.tsx`.

**Dependencies.** T-38, T-39.

**Backend prerequisite (A14) — partly closed.** `GET /plan-actual`'s
`byTruckVarianceUsd` now ships `{ truckId, unitNumber, stopCount, plannedUsd,
actualUsd, varianceUsd, adherencePct }` per truck, matching the design's "By
truck" table. **Still outstanding:** its "Needs review" ranking needs
matched-row detail (station names, both prices) that `MatchRow` carries as
dollars (`plannedUsd`/`actualUsd`) but not station identity — amend
`planActual/live.ts` again (a join, not a matching-logic change) before
building that part of the screen. T-38's matching logic itself already
matches the design exactly (exclusion class names, `moneyLeftOnTableUsd`,
both `adherencePct` formulas, all 1:1 down to the worked numbers).

**Definition of done.**
- [ ] One segmented control switches the two views; the design file's layout is followed (KPIs → chart → by-lane/by-truck table + needs-review → flagged deviations).
- [ ] Skipped recommendations and unplanned stops are visible as rows.
- [ ] Coverage is stated on screen ("14 of 60 stops covered by a plan"), never implied.
- [ ] The empty state explains **why** it is empty and what will fill it — asserted with a zero-overlap fixture.
- [ ] Exclusions are listed with their counts.
- [ ] Money left on the table is the headline of the live view; savings is the headline of the backtest.

---

## T-47 · Settings — assignments, aliases, thresholds

**Priority 47.**

**Goal.** A8.11. The data that every resolution and every anomaly depends on.

**Files.** New: `frontend/src/app/(app)/settings/page.tsx`, `AssignmentsTable.tsx`, `AliasList.tsx`, `ThresholdForm.tsx`, `backend/src/api/routes/settings.ts`.

**Dependencies.** T-26, T-30, T-39.

**Definition of done.**
- [ ] Card→truck→driver assignments are editable **with effective dates**, and the UI states that editing does not retroactively re-resolve until the job runs (D14).
- [ ] Alias add/remove, with the unmatched names from T-36 as one-click candidates.
- [ ] Every A10 threshold is editable and takes effect on the next anomaly run.
- [ ] No roles matrix (A2). User management appears only when a second user exists.
- [ ] A re-resolve job can be triggered and reports what changed.

---

# Phase 10 · Ship v2

## T-48 · Historical invoice backfill

**Priority 48.**

**Goal.** Ten years of Gmail invoices in, gaps reported rather than papered over.

**Files.** New: `backend/src/invoice/backfillInvoices.ts`, `backend/src/cli/backfillInvoices.ts`, `backend/src/invoice/invoiceGapReport.ts` + tests.

**Dependencies.** T-31.

**Definition of done.**
- [ ] A directory of invoices imports per-file, one quarantine not sinking the run (mirrors T-07's batch behaviour).
- [ ] Missing weeks are **reported** as gaps, never interpolated.
- [ ] Order-independent: shuffled input produces identical database state.
- [ ] Quarantined historical invoices are queued for review with their reports intact.
- [ ] A shape change in older years is reported as a parse rejection naming the year, answering A18 Q6 with data.

---

## T-49 · Deploy v2

**Priority 49.**

**Goal.** The merged app live. **Absorbs T-24** (A16, decided) — the pre-sidebar tab-bar UI has no deploy of its own; the first deploy is this one, on the finished v2 shell.

**Files.** Modified: `vercel.json`, `docs/RUNBOOK.md`, `PROJECT-SCOPE.md` §2 and §19, `PROJECT-SCOPE-v2.md` §A3.

**Dependencies.** T-40…T-47, T-50, T-51, T-60…T-66 (Phase 11 edits `0003` in place — D21).

**Definition of done.**
- [ ] A real lane plans and a real invoice imports, both in production.
- [ ] Anonymous API → 401, anonymous page → 307, including `/health`.
- [ ] All five migrations apply to Neon; the drift test passes against it.
- [ ] Runbook covers weekly invoice import, quarantine triage, receipt-queue cadence, backfill, and both call meters.
- [ ] **§2 and §A3 describe the repository as it actually is on the day v2 ships** — the failure the v1 rewrite existed to correct must not recur.

---

## T-50 · Invoice fixtures, the test-worker crash, and real data out of history (before ship)

**Priority 50 — but it lands before T-49.**

**Goal.** When most of the app exists, finish tidying how the tests get their data: make the invoice fixtures match the real PDF, fix the intermittent worker crash, and decide whether the real sheets that were once committed come out of git history.

**Why it is deferred (decision, 2026-09-19).** While there is one developer, tests that read the real invoice are *more* useful than synthetic ones: they assert real figures (the invoice total, gallons per product). Do this once, when the suite has stopped growing. The BVD price-sheet half of the original T-50 was pulled forward as **T-51**.

**Scope.**

1. **Invoice fixtures that match the real PDF** (the PDF is the source of truth, D13). Compared with real invoice 999210 (9 pages; layout read with every value masked, nothing copied) the current `sample-redacted.pdf` lacks: a time line after each header date and a multi-line client address; a `SUBTOTAL` row (8 numerics) after each fuel line; a per-card product-totals block (`SUBTOTAL <prod> … US`, `Card # TF …`, `<n> Fuel Total …`, `DF …`, `Sub Total …`); page breaks *inside* a card, with a `Page N of N Pages` footer and a repeated table header; one-, two- and three-word driver names; an express section with its own `SUBTOTAL`; a closing legend (TF Trailer, TA Tractor, DF DEF, S Scale, C Cash, AD Additive, O Oil, L Lubricant) and the `HST#` trailer. Rebuild the sample from invented data only — never edit or copy the real PDF. Add edge-case PDFs, one failure mode each: totals that do not add up; a changed table header (`InvoicePdfFormatError`); a card spanning a page break; blank driver / blank tractor on express rows; thousands separators; an unmapped product code. A local-only check compares the sample's masked line shapes against the real invoice's.
2. **The intermittent test-worker crash.** About one full backend run in three ends `exit 1` with `Error: Worker exited unexpectedly` (tinypool); one file goes unreported, every reported test passes, a re-run usually passes. Evidence (2026-09-19): it reproduces on untouched `main`; the lost file varies (`transactions`, `drivers`, `backfillInvoices`, …); Postgres logged no `FATAL` and `max_connections` is 100, so it is not connection exhaustion despite the comment in `backend/vitest.config.ts`; Linux CI was 25 of 25 green. A crashed worker skips its `afterEach` and leaves `test_*` schemas behind (25 had built up). Hypotheses, in order: an idle `pg.Pool` `error` with no listener kills the fork; a native crash in `pdf-parse`/`pdfjs`; Windows file locking from OneDrive or antivirus (`git worktree remove` also failed with `Permission denied`); `maxForks: 2` too high beside the Docker Postgres. The developer suspects part of it came from the machine shutting down mid-run, which would explain some of the leftover schemas but not the crashes seen during clean runs — confirm it still happens before spending time on it.
3. **History.** T-51 stops tracking `data/bvd-prices/`, but the sheets remain in earlier commits. Decide whether to rewrite history (`git filter-repo` + force-push): they are contract pricing and history keeps them otherwise. Must be settled before the repository is shared or the app is deployed.

**Files.** `backend/test/fixtures/invoices/` (`generateSamplePdf.ts`, the sample PDF/CSV and new edge-case PDFs), the invoice tests that read them, `backend/vitest.config.ts`, `CLAUDE.md`.

**Dependencies.** T-40…T-47 (the app is substantially built, so the suite has stopped growing). Blocks T-49.

**Definition of done.**
- [ ] The sample PDF reproduces the real layout from invented data only; edge-case PDFs each cover one failure mode.
- [ ] A test that reads a file at `describe` level is a bug: a skipped suite's factory still runs. Read inside `it`.
- [ ] Ten consecutive full backend runs with no worker exit, or the crash is shown not to occur; stale `test_*` schemas are swept at the start of a run.
- [ ] The history decision is made and recorded.
- [ ] `npm run verify` is green with `data/bvd-invoices/` absent, and with it present.

**Not in scope.** Changing what any test asserts. Parser changes, unless a new fixture exposes a bug — then the test comes first, per CLAUDE.md.

---

## T-51 · BVD price-sheet fixtures; `data/bvd-prices/` out of the repo

**Priority 51 — lands before T-49.**

**Goal.** The real BVD price sheets (`data/bvd-prices/`, contract pricing) leave the repository and stay on the developer's machine, exactly like `data/bvd-invoices/`. Tests still check against them locally; CI checks against small synthetic fixtures.

**The pattern (copies the invoice tests).** Each of the nine tests that read `data/bvd-prices/` gets two blocks: one that reads committed files in `backend/test/fixtures/bvd-prices/` and always runs (CI and local), and one wrapped in `describe.skipIf(!hasRealData)` that asserts the real figures and runs only where the files exist. Real reads happen inside `it()`, never at `describe` level.

**Fixtures — `backend/test/fixtures/bvd-prices/`** (hand-written, invented prices and `SITE` ids; store numbers, cities and states are public Love's data so the operator-export join works):
- `sample.csv` (12 rows): clean baseline — capped-at-retail rows, `SITE` ≠ store number, ambiguous city/state pairs, one store the operator export cannot place (#306).
- `edge-rejections.csv`: good rows plus one bad row per reason code (`UNMAPPED_PRODUCT`, `INVALID_STATE`, `NUMERIC_PARSE_ERROR`, `PRICE_INVARIANT_VIOLATION`, `SCHEMA_ERROR`).
- `edge-format.csv`: stray header whitespace, blank lines, dirty cities (`city_raw` kept, `city_normalized` derived).
- `edge-bad-header.csv`, `edge-missing-effective-date.csv`, `edge-short-row.csv`: each must fail the whole file with a `BvdCsvFormatError` naming the problem.
- Composed in the tests, not committed: CRLF, an empty file, byte-identical duplicates and `(1)` copies, gaps and multi-day sets (the sample re-dated into a temp directory).

**Files.** New: `backend/test/fixtures/bvd-prices/*.csv`. Modified: `.gitignore`, `CLAUDE.md`; the nine tests — `parseBvdCsv`, `validate`, `gapReport`, `storeNumber`, `gazetteer`, `operatorExport` (unit) and `ingestFile`, `backfillCli`, `resolveCli` (integration); `ingestCli.test.ts` (drops an unused path). Untracked: `data/bvd-prices/` (the files stay on disk).

**Dependencies.** None.

**Definition of done.**
- [ ] `data/bvd-prices/` is gitignored and untracked; the files are unchanged on disk.
- [ ] `npm run verify` is green with `data/bvd-prices/` absent (the CI view) and with it present (the local view, where every real block runs).
- [ ] Every fixture file is exercised by at least one test that fails if the file changes unexpectedly.
- [ ] CI (Linux, no `data/bvd-prices/`) is green.

**Not done.** The sheets remain in git history — see T-50.

---

## T-52 · Distances in miles end to end

**Priority 3 — lands before T-13 and T-14, which build on the distance fields.**

**Goal.** Every distance the system stores or passes internally is in **miles**. CLAUDE.md already says "Storage is miles and gallons; convert at the API boundary only"; the schema and code violate it (distances are `_m` metres, and T-12 added a metres→miles seam in `planning/optimizerInput.ts`). This ticket makes the rule true and deletes the seam.

**The conversion edges — the only places a unit is converted.** (Three when T-52 landed; T-22 added the fourth, which this ticket's *Not in scope* already anticipated.)
1. **The ORS adapter** converts the provider's metres on the way in (`metersToMiles`).
2. **SQL that calls a PostGIS geography function** converts at that call: the *parameter* is scaled (`$2 * 1609.344`), never the column, so the GIST index still serves the predicate; a returned distance is divided (`/ 1609.344`).
3. **The API**, for the future `?units=metric` toggle (not built here).
4. **The map renderer** (T-22), for geometry drawn on the ground in metres: `uncertaintyRadiusMeters()` in `frontend/src/map/layers.ts`. Draw-only — the metres are never stored or returned.

**Why.** One internal unit removes a class of silent unit-mix bugs. Miles→metres is exact (1 mi = 1609.344 m); metres→miles is not, so convert **once**, on ingest, and store 3 decimal places (1.6 m — finer than routing data is accurate to). Nothing in the schema needs sub-metre precision, so no information is lost.

**Decisions (2026-09-20).**
- Convert uncertainty too, so no `_m` distance column remains.
- Rename `_m` → `_miles` (matches `max_leg_miles`, `max_detour_miles`).
- Convert in the ORS adapter, **not** via ORS's `units=mi` request parameter: that changes the request body and therefore `routes.request_hash`, the cache key.
- Preserve the city-tier rule numerically: `u < 8 km and ≥ 2u slack` became `8000 / 1609.344` miles (≈ 4.971). **Superseded 2026-09-20:** the rule is now stated as `u < 5 miles` so no metric figure remains; this admits centroids between 4.971 and 5 mi, and no v1 station is affected (604 of 605 are `exact`, #306 is closed).

**Stays metric (deliberately).**
- `backend/test/fixtures/ors/*.json` — recorded ODbL responses, committed as recorded.
- `providerRaw` on route results — the raw provider payload stays raw.
- ORS HGV restrictions in `routing/ors.ts` — vehicle height/width/length in metres and weight in kg are ORS's vehicle spec, not measured distances.
- `duration_s`, coordinates, PostGIS `geography` internals.

**Files.**
- New: `migrations/0010_distances_in_miles.sql`.
- Modified: `backend/src/db/schema.ts`, `db/types.ts`; `routing/provider.ts`, `provider.types.ts`, `ors.ts` (+ `ors.test.ts`); `planning/corridor.ts`, `stratifiedTopK.ts`, `optimizerInput.ts` (+ tests); `optimizer/model.ts`, `optimizer/types.ts` (comments); `resolution/gazetteer.ts`, `operatorExport.ts`, `cli/resolve.ts` (+ tests); `domain/planResponse.ts` (+ test); `frontend/src/data/trips.ts`; `scripts/load_gazetteer.py`, `scripts/resolve_from_operator.py`; every integration test that touches a renamed column; `PROJECT-SCOPE.md`, `TICKETS.md`, `BUILD-PLAN.md`, `CLAUDE.md`.
- Unchanged: `domain/units.ts` keeps `metersToMiles` / `milesToMeters` (used at edges 1 and 2).

**Dependencies.** T-11 (corridor), T-12 (optimiser and its seam).

**Definition of done.**
- [x] A schema test asserts **no** column in the public schema ends in `_m` (allowlist empty) and that every distance column is `_miles`.
- [x] A repo-wide search for `Meters`, `_m\b`, `distance_m`, `metersToMiles`, `milesToMeters`, `1609` finds only: the ORS adapter, the corridor SQL, `units.ts` and its test, the migration, the Python loader comment if any, the unchanged fixtures, and docs that explain the conversion. Every remaining hit is listed and justified in the PR description.
- [x] Corridor integration tests, the GIST-index test and the drift test pass; the operator-export resolve still matches 604 of 605. *(The original wording also asked for "595 city tier at the 8 km rule" (the rule is now 5 miles). That figure is the scope's unverified gazetteer name-match count, not something the repo asserts or the city-tier rule produces, so it was not checked — see PROJECT-SCOPE §11.4 step 3.)*
- [x] ORS adapter tests pass from the unchanged recorded fixtures.
- [x] A migration test shows existing `_m` rows are converted correctly.
- [x] CLAUDE.md's "Storage is miles and gallons" is literally true of the schema, and CLAUDE.md names the `_miles` suffix and the three conversion edges.
- [x] `npm run verify` is green.

**Not in scope.** A metric toggle (`?units=metric`). Map rendering: MapLibre circle radii need **metres**, so the frontend converts at render — record this for the map ticket (T-22), do not build it here.

---

## Deferred, deliberately

| Item | Why not now | Ref |
|---|---|---|
| Samsara receipt automation | Needs A18 Q3 answered. The queue is already shaped for it (D17). | A8.5 |
| Cost per mile as a headline | Needs odometer data (A18 Q1). Changes the Trucks screen's shape. | A8.8 |
| Currency toggle | Needs A18 Q2. Until then everything is USD and says so. | A6.1 |
| Published-price audit | Needs the BVD price file as a file (A18 Q5). The field exists and returns null. | A10 |
| Gmail poller for invoices | Same seam as v1's price-sheet poller; `importInvoice` does not change. | §20 |
| HERE routing, Canada, multi-stop | Unchanged from v1's deferred list. | §20 |

---

## T-53 · Migrations organised by domain (squash, pre-deploy)

**Priority 3 — lands before T-13 and before T-49, the first deploy.**

**Goal.** Replace the ten accumulated migrations with five, so the schema reads as it is *now* rather than as the history of decisions that shaped it, and schema is kept apart from seed data.

**Decision (2026-09-21, D21).** Nothing is deployed, so applied migrations may be squashed. From the first deploy they are append-only again.

**Target layout.**

| File | Contents |
|---|---|
| `0001_planning_schema.sql` | PostGIS; `users`, `truck_profiles`, `product_codes`, `place_centroids`, `stations` + candidates, imports/prices, `saved_locations`, `routes`, `plans`, `plan_stops`, provider metering. Distances in miles. |
| `0002_planning_seed.sql` | The 3 system truck profiles and the BVD/ULSD product code. |
| `0003_actuals_schema.sql` | `btree_gist`; drivers, trucks, cards, assignments, invoices, totals (with `discount_usd`), fuel stops (with the `occurred_at` index), lines, express charges (PDF columns, nullable truck/unit), receipts, anomalies, thresholds, plan/actual matches. |
| `0004_actuals_config_seed.sql` | `anomaly_thresholds` — required in every environment; the anomaly engine throws without them. |
| `0005_fleet_roster_seed.sql` | The 27 drivers, cards, trucks and assignments — this company's data, replaceable. |

**Folded in.** Old 0006–0009 fold into 0003; old 0010 folds into 0001 and 0003 as the final `_miles` names and widths. Old 0005 becomes 0004; old 0004 becomes 0005.

**Out of scope.** `truck_profiles.truck_number` (superseded by A16, still in the schema) — its removal touches the API and frontend and is not an "alter later" case. Moving the roster out of migrations — several integration tests rely on it after `runMigrations`; that belongs with T-50.

**Files.**
- New: the five files above.
- Removed: all ten of the old files.
- Modified: `backend/src/db/migrate.ts` (a stale database fails with an instruction to `db:reset`); the tests and comments that name the old files; `PROJECT-SCOPE-v2.md` (D21, A16), `BUILD-PLAN-v2.md`, `CLAUDE.md`.
- Removed test: the first `describe` in `distancesInMiles.test.ts` (it tests a conversion that no longer exists); the file is renamed `distanceUnits.test.ts` and keeps the live-schema assertions.

**Definition of done.**
- [x] The five files applied to an empty schema produce a catalog identical to the live schema of the ten (columns, types, widths, nullability, defaults, constraints, indexes), apart from column order.
- [x] `npm run db:reset` followed by the normal repopulation gives the same row counts as before.
- [x] `provider_usage` was preserved across the reset.
- [x] `npm run verify` green locally (724 backend + 23 frontend tests). **CI green on the PR: pending.**

---

## T-54 · ORS budget guard re-based to the provider's daily limits

**Priority 3 — lands before T-14's live measurement (step 14.3) and before T-16, the first code that spends calls on every plan.**

**Goal.** The budget guard stops a runaway retry loop without throttling normal use. The target is **about 25 plans a day**, which must fit with headroom under the free tier's measured limits.

**Why.** T-10 measured ORS's free-tier limits on 2026-09-14 (§8.3): **200 directions, 50 matrix, 100 geocoding per day**, each its own pool. It then applied those daily figures as *monthly* ceilings, and `reserveProviderCall` compares the *calling endpoint's* ceiling against the *sum of every endpoint's calls for the month*. So a matrix call is refused once the month's total ORS calls reach 50. At T-13's and T-14's call counts that is roughly 8–12 plans a month — about 30 times tighter than the provider, and it would block the target from day one.

**A plan's call budget** (the arithmetic the ceilings must fit).

| Endpoint | Per plan | At 25 plans/day | ORS daily limit |
|---|---|---|---|
| directions | 2–4 (baseline; one via route, up to three — T-13) | 50–100 | 200 |
| matrix | 2 (T-14, two N × N) | **50** | **50** |
| geocoding | ≤ 2 (typed addresses) | ≤ 50 | 100 |

Matrix is the binding limit, and 25 plans a day is *exactly* ORS's daily matrix quota. Real use below that is the headroom; the guard must not add a second, tighter limit on top.

**Design** (the three items that were Open are settled with the owner, 2026-09-21).
1. **A ceiling per endpoint, not pooled, counted per UTC day.** `provider_usage.period` is already a `date`, so the day's date goes there and no schema change is needed. A retry loop that burns an endpoint's day stops at that endpoint's ceiling and leaves the others working.
2. **Defaults are the measured daily limits** — 200 / 50 / 100. **Decided:** no margin below the limit: ORS's window is rolling, not a UTC day (§8.3), so the guard is an approximation of the provider's limit either way, and a 429 from ORS is already a typed `RoutingProviderError`.
3. **Overridable by environment**, so a paid tier or a raised limit needs no code change. An unset variable means the default; a malformed one fails at startup rather than silently disabling the guard; `0` is a real value that blocks every call. Nulls stay meaningful. **Decided:** `ORS_DAILY_LIMIT_DIRECTIONS`, `ORS_DAILY_LIMIT_MATRIX` and `ORS_DAILY_LIMIT_GEOCODING`. Geocoding is included although no adapter calls it until T-15 (typed addresses need it), so T-15 takes its ceiling from configuration instead of inventing one.
4. **The monthly pooled spend ceiling is not built.** On a $0 tier there is no spend to protect. §8.3 keeps it as the design for a paid provider, the way §17 keeps expiry, and says so. **Decided:** no monthly figure.
5. **The reservation becomes one atomic statement** (`INSERT … ON CONFLICT DO UPDATE … WHERE call_count < ceiling`), which per-endpoint counting makes possible, so two concurrent plans cannot both read the last free slot. A ceiling of 0 is refused before the statement.
6. **`BudgetExceededError` says which endpoint, which day, the ceiling, and when the counter resets** (the next UTC midnight), so T-16 can tell a dispatcher when to retry. Its message no longer says "Monthly".

**Files — modified**
- `backend/src/routing/budgetGuard.ts` — per-endpoint, per-UTC-day, atomic; the error's new fields.
- `backend/src/routing/budgetCeilings.ts` (new, with its test) — `DEFAULT_BUDGET_CEILINGS` (daily limits now) and the pure `resolveBudgetCeilings(env)`; `ors.ts` imports them.
- `backend/src/routing/factory.ts`, `backend/.env.example` — the environment overrides.
- `backend/src/routing/quotaObserver.ts` and its test — comment and test title only (our counter resets at UTC midnight).
- `backend/test/integration/budgetGuard.test.ts`, `backend/test/integration/orsMetering.test.ts` — rewritten for the new semantics.
- `migrations/0001_planning_schema.sql` — the `provider_usage` comment ("a monthly spend ceiling") only. Editable until the first deploy (D21); no column changes.
- `docs/PROJECT-SCOPE.md` §8.3 (the two-meters table, the measured paragraph) — authoritative, so it is edited first; `docs/TICKETS.md` T-10 and `docs/BUILD-PLAN.md` step 10.x, which repeat "monthly ceiling pooled across endpoints", are edited to agree.

**Out of scope.**
- What the planning service does when the guard throws. That is T-16's rule already: a technical failure is not persisted and returns an RFC 9457 error. This ticket only gives that error what it needs to say.
- A matrix-result cache keyed on (route, candidate set), so a re-run of the same lane spends no matrix calls. Decided 2026-09-21: it belongs to T-16, not T-14 (see T-16).
- Showing both meters in the UI (§8.3, "show both, separately"). Nothing renders either meter yet.
- Local rows keyed by a month's first day, left by T-10's live calls and the old guard, are read as that day's usage. They are past dates and harmless; do not migrate them.

**Dependencies.** T-10.

**Definition of done**
- [x] 200 directions calls in a UTC day do not use up that day's matrix allowance: a matrix call succeeds after them.
- [x] **25 plans' worth of calls fit in one UTC day at the defaults** (3 directions, 2 matrix, 2 geocoding each); the 26th plan's first matrix call is the one refused.
- [x] Call N+1 to an endpoint throws and the HTTP call is not made; a call reserved and then failing still counts.
- [x] The counter resets at the UTC day boundary; the error names the endpoint, the day, the ceiling and the reset time.
- [x] Concurrent reservations at the last free slot admit exactly one.
- [x] Ceilings can be set by environment; an unset variable keeps the default, a malformed one throws at startup, `0` blocks.
- [x] §8.3 and the T-10 text describe the guard as it is now, and no document still says "monthly ceiling pooled across every endpoint".
- [x] `npm run verify` green (804 backend + 23 frontend tests, 2026-09-21); CI green on PR #42.

---

## T-55 · Whole seconds when a plan is saved — `POST /plans` 500s on a real lane

**Priority 4 — a defect in T-16. Lands before T-23, and before anything that needs a live plan.**

**Goal.** A real lane plans, saves and reopens. The duration the API returns from `POST /plans` is the same whole number that is stored and that `GET /plans/{id}` returns.

**Why.** Found 2026-09-23 while checking T-22 against a real lane (Dallas, TX → Atlanta, GA): `POST /plans` returns **500** `invalid input syntax for type integer: "67817.7"`, and no plan row is written.
- ORS reports durations with a fractional part. `plans.total_duration_s` is `integer` (`0001_planning_schema.sql`).
- `planService.ts` passes `validatedPlan.totalDurationSeconds` into `insertPlanRow` unrounded (`totalDurationS`), and `planPersistence.ts` writes it as-is. The three other integer duration columns are already rounded before the write: `routes.duration_s` in `routePersistence.ts`, and `plan_stops.detour_duration_s` / `cum_duration_s` in `planPersistence.ts`. Only this one was missed.
- The routing and matrix calls are spent **before** the failing insert. Every attempt uses up ORS's daily allowance (T-54) and saves nothing, so Recent stays empty and Plan vs Actual has no plans to match.
- Every test fake uses whole-second durations (42000, 21000, 600 in `test/integration/planService.test.ts`), which is why nothing caught it.
- **Second symptom, same cause:** even where the write succeeds, `POST /plans` returns the fractional `optimized.driveSeconds`, `totalSeconds` and `addedDurationSeconds`, while `GET /plans/{id}` returns them rebuilt from the stored integer. One plan should not read differently depending on which endpoint returned it.

**Design.** **Decided:** round **once, in `planService.ts`**, where `validatedPlan.totalDurationSeconds` is first consumed. One local value feeds both `insertPlanRow` and the `optimized` summary in the response, so the response, the stored row and a later `GET` agree by construction. Rounding only inside `planPersistence.ts` would fix the 500 but leave `POST` and `GET` disagreeing. The existing `Math.round` calls on the other three columns stay as they are.

**Files — modified**
- `backend/src/planning/planService.ts` — round `totalDurationSeconds` once; use it for the insert and the response.
- `backend/test/integration/planService.test.ts` — a fake ORS response with fractional durations.
- `backend/test/integration/plansEndpoint.test.ts` — `POST` then `GET` through the API, with durations compared.

**Out of scope.**
- Changing any column type. Whole seconds are finer than routing is accurate to, and the schema is right.
- The zeroed-bounds coercion in `planPersistence.boundsFromRow` (noted in PR #65). It is a separate "nulls are meaningful" question with no crash attached.

**Dependencies.** T-16.

**Definition of done**
- [x] With a fake provider returning fractional seconds (e.g. `67817.7`, and stop legs with fractions), `POST /plans` returns 201 and a `plans` row exists. This test fails before the fix, with the same Postgres error.
- [x] `POST`'s `optimized.driveSeconds`, `totalSeconds` and `addedDurationSeconds` are integers and equal `GET /plans/{id}`'s for the same plan.
- [x] Every duration the plan response carries is an integer, on both endpoints.
- [x] One real lane planned from the UI saves, reopens from Recent, and draws on the T-22 map. Dallas, TX → Atlanta, GA: total_duration_s = 67818 in the database (was the value that 500'd); driveSeconds/totalSeconds/addedDurationSeconds all integers; ORS usage for the day stayed at 6/200 directions, 6/50 matrix, 2/100 geocoding.
- [x] `npm run verify` green (1,068 backend incl. DB integration + 92 frontend); CI green on PR #68.

---

## T-56 · Collapse `trucks` + `truck_profiles` into one table

**Priority 56 — a defect in the abstract-class design carried since T-02/T-26. Lands before any further plan-orchestration or fleet-screen work touches either table.**

**Goal.** One row per real fleet truck, carrying both its identity and its own mpg/tank/dimension spec, so picking a truck in the UI is enough to plan a route. No more indirection through an abstract `truck_profiles` class that nothing populates for the real fleet.

**Why.** Found 2026-09-24 while testing the New Plan screen (Dallas, TX → Atlanta, GA, truck 031): "Plan route" silently did nothing. The visible truck selector only sets `plans.truck_id` (a real fleet unit, used to match a plan against later invoices); the optimiser reads `truckProfileId`, an abstract mpg/tank/leg-cap class settable only from the buried Dev Tools panel. None of the 27 real trucks have a `truck_profile_id` set, so `buildCreatePlanRequest` returns `null` with no explanation. Full reasoning, the exact target schema, and the application-layer blast radius are recorded in `docs/design/truck-consolidation.md` — read it before touching schema or code; this ticket entry does not repeat it.

**Design (decided in that session, not re-litigated here).**
1. Drop the abstract-class use case entirely — every plan is for one of the 27 real trucks.
2. Keep the 8 currently-unused dimension columns (`height_cm`, `width_cm`, `length_cm`, `gross_weight_kg`, `axle_count`, `trailer_count`, `hazmat_class`, `max_gallons_per_fill`), moved onto the merged table as real per-truck fields — informational until a routing feature reads them.
3. Drop `owner_user_id` and `is_system` (vestigial multi-tenant scaffolding; single user, per CLAUDE.md).
4. Collapse `plans`'/`routes`' two truck FKs into one `NOT NULL truck_id` each; `truck_profile_id` disappears from both.
5. The 7 planning-relevant spec columns stay nullable at the schema level, but every truck seeds to one flagged working default (`tank_gallons=200`, `avg_mpg=7.5`, `reserve_fraction=0.150`, `max_leg_miles=500`, `min_leg_miles=300`, `cost_per_mile_usd=0.000`, `fixed_stop_minutes=20`) rather than a guessed per-truck distribution — same lesson as `migrations/0005_fleet_roster_seed.sql`'s own "plausible, not verified" caveat, corrected in T-40's fix commit.
6. `slug`, `display_name` and the legacy placeholder `truck_number` are dropped; `unit_number` is the only identifier a truck needs.

**Migration mechanics.** No deploy has happened (T-49 open), so per CLAUDE.md every migration below is squashable/editable in place rather than needing a new append-only file. `truck_profiles` lives in `migrations/0001_planning_schema.sql` (with `routes`/`plans`, which reference it); `trucks` lives in `migrations/0003_actuals_schema.sql` (after 0001). The merged `trucks` table must be defined before `routes`/`plans` reference it, which means resequencing 0001/0003, not just editing columns in place — resolve this before writing the DDL. `truck_assignments`/`fuel_stops`/`express_charges` (0003, already FK straight to `trucks(id)`) must keep working against wherever `trucks` ends up.

**New validation.** Since the 7 planning fields are nullable, `POST /plans` needs an explicit check: a chosen truck missing any of them returns a `400 problem+json` naming the truck and the gap ("truck 057 has no mpg/tank spec set") instead of crashing in the optimiser or silently no-opping the way it does today.

**Files.** Per `docs/design/truck-consolidation.md`'s blast-radius section (21 non-test files) —
- **Schema:** `migrations/0001_planning_schema.sql`, `migrations/0003_actuals_schema.sql` (resequenced), `migrations/0005_fleet_roster_seed.sql` (seeds the merged table), `backend/src/db/schema.ts`, `backend/src/db/types.ts`.
- **Backend:** `catalog/trucks.ts` and `catalog/truckProfiles.ts` merge; `api/routes/truckProfiles.ts` folds into `api/routes/trucks.ts`; `planning/planDefaults.ts`, `planService.ts`, `planPersistence.ts`, `routePersistence.ts` (new source query + null-spec guard); `domain/planResponse.ts` (new `truck: {unitNumber, maxLegMiles}` shape), `domain/planResponseUnits.ts`; `planActual/match.ts` and `actuals/transactions.ts` (the plan-link join changes from `truck_profile_id` to `truck_id`, fixing the wrong-real-truck-same-class match bug this ticket incidentally closes); `api/app.ts` route wiring.
- **Frontend:** `hooks/useTruckProfiles.ts` + `hooks/useTrucks.ts` merge; `components/DevToolsTab.tsx` loses its truck-profile picker entirely; `components/PlanTab.tsx`'s real unit-number selector becomes the only truck picker; `lib/planRequestForm.ts` drops the separate `truckProfileId` field and its disabling logic; `lib/api.ts` typed client calls.

**Dependencies.** T-25 (actuals schema — `trucks`/`truck_assignments`), T-26 (catalog layer). Touches T-16's plan orchestration and T-21's frontend client without changing either ticket's own scope.

**Definition of done.**
- [x] `trucks` is one table: unit number, the 7 planning fields (nullable, all 27 rows seeded to the flagged default), and the 8 dimension fields. `truck_profiles` no longer exists.
- [x] `plans.truck_id` and `routes.truck_id` are both `NOT NULL REFERENCES trucks(id)`; neither table has a `truck_profile_id` column.
- [x] Dallas, TX → Atlanta, GA, truck 031 plans successfully end to end against the real API (real geocoding, real ORS, real BVD pricing) — 201, `truck: {unitNumber: "031", maxLegMiles: 500}`, 784.8 mi via a real Love's stop in Vicksburg, MS; `GET /plans/{id}` round-trips it. The bug that opened this ticket is closed.
- [x] A truck missing a planning field returns `400 problem+json` naming the truck and the missing field(s) (`TRUCK_SPEC_INCOMPLETE`), never a crash or a silent no-op — asserted in `planService.test.ts`.
- [x] The stale `truck_profile_id` plan-link join in `actuals/transactions.ts` now joins on `truck_id` directly.
- [x] The Dev Tools truck-profile picker is gone, not relabeled — its card now previews the spec of whichever truck `PlanTab`'s own unit-number selector picked; that selector is the only truck picker and drives both `plans.truck_id` and the optimiser's input.
- [x] The schema drift test covers the merged table and the two collapsed FKs.
- [x] `npm run verify` is green from a clean `db:reset` (113 backend + 27 frontend test files, 1066 + 195 tests); CI green on the PR: pending.

---

## T-57 · "Show all sheet stations" silently does nothing on a failed fetch

**Priority 57 — a defect in T-23 step 23.2. Found 2026-09-26 reproducing a user-reported "the button doesn't work."**

**Goal.** A failed sheet-stations load says so and offers a retry, the same way every sibling data-loading control in `PlanTab.tsx` already does — instead of silently sitting at "(0)" forever.

**Why.** `useSheetStations.ts` (T-23 step 23.2) fetches every resolved station eagerly and exposes `{ stations, loading, error }`, but `PlanTab.tsx` only ever destructured `stations` and `loading` — `error` was never read. Any failed fetch (a stale/expired auth session, a network blip, a 5xx) left `stations` at `[]` with no visible sign anything had gone wrong; the button just read "Show all sheet stations on map (0)" indefinitely, which looks identical to "there are no stations" or "the button is broken." Confirmed live: the dev server's own log showed a `JWTSessionError: no matching decryption secret` from a stale browser session, which would 401 every `GET /stations` call silently under this bug. `usePriceSheets`/`useTrucks` already had the correct pattern (`error` + `refetch`, a "Couldn't load — retry" button) — `useSheetStations` just never got it.

**Fix.** `useSheetStations` gains a `refetch()` (re-runs the fetch effect via an attempt counter, same shape as its siblings). `PlanTab.tsx` destructures `error`/`refetch`, disables the toggle while nothing has ever loaded and an error is pending (turning it "on" would show an empty layer indistinguishable from "no stations"), and renders the same `btn-link load-error` retry affordance `usePriceSheets`/`useTrucks` already use.

**Files.** Modified: `frontend/src/hooks/useSheetStations.ts`, `frontend/src/components/PlanTab.tsx`, `frontend/src/components/PlanTab.test.tsx`.

**Not in scope.** The stale-session `JWTSessionError` itself — that's a dev-environment cookie/`AUTH_SECRET` artifact, not a code defect; signing out and back in clears it. This ticket only closes the "fails silently with no feedback" gap, which is real regardless of what triggers the failure.

**Dependencies.** T-23.

**Definition of done.**
- [x] A failed `GET /stations` fetch shows "Couldn't load sheet stations — retry", not a silently stuck "(0)".
- [x] The toggle button is disabled while no stations have ever loaded and a fetch has failed.
- [x] Retrying a successful fetch after a failure updates the button's count and re-enables it.
- [x] `npm run verify` is green (113 backend + 27 frontend test files, 1066 + 196 tests); CI green on the PR: pending.

---

## T-58 · Real data out of the working tree — synthetic fleet roster, before the repo goes public

**Priority 58 — found auditing the repo for a public release. Extends T-50.**

**Goal.** Every real driver name, real BVD fuel-card number and real per-gallon contract price that had ended up committed to the working tree — outside `data/bvd-prices/` and `data/bvd-invoices/`, which T-51 and the original design already kept out — is replaced with a synthetic stand-in, without weakening any test's coverage.

**Why.** `migrations/0005_fleet_roster_seed.sql` seeded the real 27-driver/27-card roster (real employee names, real fuel-card numbers) directly into the schema every environment applies, not a gitignored data file — the T-51/T-50 split never covered it. The same real names, real card numbers and a real invoice's real contract billed prices (§A19's sample-stops table) were also duplicated across roughly twenty always-run tests, one production-code comment (`unitMismatch.ts`), and the design docs. None of this is data an open-source repo should carry.

**The roster's real/synthetic split (new) — mirrored migration directories, not a bolt-on script.** `migrations/` splits into `migrations/synthetic/` (committed) and `migrations/real/` (gitignored), file-for-file identical for `0001`–`0004` and differing only in `0005`'s names and card numbers — same shape either way (27 drivers, mixed single/two/three-token names; the same shared-truck and bad-unit-number scenarios), so schema and behaviour are identical regardless of which set applied. `runMigrations()`'s default now points at `migrations/synthetic`, so a fresh clone, CI and `db:migrate`/`db:reset` always get the synthetic set. `npm run db:migrate:real` (or `runMigrations(pool, realMigrationsDir)` directly) applies `migrations/real` instead, into whatever schema you point it at. The ~10 tests that need the real invoice to resolve point their own scoped schema's migration call at `migrations/real` directly (no dual-apply — one schema, one migration set, decided once by `hasRealFixture`), rather than migrating synthetic then patching over it. Unit numbers were left real throughout in both sets: not sensitive, and load-bearing for D18's text-typed unit-number tests. An earlier version of this ticket built a single committed `migrations/0005` plus a gitignored `data/bvd-invoices/real-roster.sql` overlay script — replaced by this mirrored-directory design, which the person driving the ticket asked for directly.

**Left alone, on purpose.** The ~19 tests gated behind `describe.skipIf(!hasRealFixture)` (`invoice999210.test.ts` and siblings) still assert the real invoice's real aggregate totals (`$50,929.71`, gallon sums, the anomaly count) — they only ever run locally against a file that was never committed, and rewriting their numbers would make them false the next time they actually run. `docs/design/CH Fuel App.dc.html` embeds a much larger real slice of the invoice (16+ rows) as inline mock data; scrubbing every figure there for a static design export wasn't worth the risk of an inconsistent sum, so it was untracked instead (gitignored, same pattern as the data directories).

**Files.** New: `migrations/synthetic/0001`–`0005` (moved from `migrations/`), `migrations/real/0001`–`0005` (gitignored). Modified: `backend/src/db/migrate.ts` (default dir, optional argv override), `backend/src/anomaly/rules/unitMismatch.ts`, `backend/src/actuals/otherCharges.ts`, `backend/src/invoice/parseInvoiceCsv.ts`, `backend/test/integration/support/actualsFixtures.ts` (`scopedSchema` takes an optional dir), roughly thirty backend test files (every one computing its own `migrationsDir`, plus `normalizeName`, `resolveDriver`, `resolveTruck`, `actualsSchema`, `actualsSeed`, `referenceLayer`, `reresolve`, `drivers`, `unitMismatch`, `transactions` for the roster names) and five frontend test files (`transactions/page`, `StopExpansion`, `TransactionsTable`, `useTransactionFilterOptions`, `useTransactionFilters`), `docs/PROJECT-SCOPE-v2.md` §A19, `docs/BUILD-PLAN-v2.md`, `docs/TICKETS-v2.md`, `CLAUDE.md`, `.gitignore`, `package.json` / `backend/package.json` (`db:migrate:real`).

**Not in scope.** The git-history rewrite — T-50's original decision item (32 real BVD price-sheet CSVs committed in `4668db0`, still reachable from `main`) is still open, and this ticket's own edits need to survive that rewrite, not precede it into a squashed history that then gets rewritten again.

---

## T-59 · "Show all sheet stations" dots vanish on a re-plan

**Priority 59 — a defect in T-23 step 23.2, distinct from T-57. Found 2026-09-26 reviewing a screenshot where the toggle read "Hide all sheet stations on map" but no green dots were drawn.**

**Goal.** The sheet-stations layer survives computing a second plan while its toggle is already on, the same way the "Cheapest along route" hover highlight already does.

**Why.** `RouteMap.tsx`'s "new plan" effect calls `buildMapSources(plan)` and writes every returned source to the map, including `SOURCE.sheet` — which `layers.ts` deliberately always returns empty for, since the sheet layer is meant to be drawn by its own dedicated effect instead. That dedicated effect only depended on `[sheetStations, ready]`. `useSheetStations` fetches once on mount and hands back a stable array reference, so on a second `POST /plans` the array never changes, the dedicated effect never re-fires, and the plan-effect's empty write is the last one to touch the source — the dots disappear even though the toggle stays on. The highlight layer's own effect already lists `plan` in its dependency array and was unaffected.

**Fix.** Added `plan` to the sheet-stations data effect's dependency array (`RouteMap.tsx`), so it redraws immediately after the plan-effect's reset, in the same commit (React fires effects in declaration order). No backend change; `GET /stations` and the local database were already correct (verified 605/605 stations resolved).

**Files.** Modified: `frontend/src/components/RouteMap.tsx`, `frontend/src/components/RouteMap.test.tsx`.

**Not in scope.** T-57's failed-fetch handling (already merged, orthogonal — that ticket covers the fetch failing; this one covers a successful fetch's data being silently overwritten later).

**Dependencies.** T-23.

**Definition of done.**
- [x] Toggling "Show all sheet stations on map" on, then computing a new plan, keeps the sheet dots drawn.
- [x] Regression test added (`RouteMap.test.tsx`, "survives a re-plan"); confirmed it fails against the pre-fix code and passes against the fix.
- [x] `npm run verify` green (other than one pre-existing, unrelated local-only failure in `backfillInvoicesCli.test.ts` gated on `data/bvd-invoices/`, not touched by this change).

**Definition of done.**
- [x] `git grep` across the tracked tree finds no real driver name, real card number, or the real A19 contract prices, outside the documented `hasRealFixture`-gated exceptions.
- [x] `npm run verify` green from a clean checkout (113 backend + 27 frontend test files, 1066 + 196 tests) — both with the real roster overlay applied (local view) and without it (CI view, synthetic only).
- [ ] CI green on the PR.

---

# Phase 11 · Canada invoices

BVD bills Canadian fuel on a second weekly invoice — CAD, litres, sales tax inside the billed price (D24). These seven tickets import it, pair it with the US invoice for the same week, and show both side by side and combined. Governing decisions: D24–D30 in PROJECT-SCOPE-v2 §A15. **Real driver names and card numbers appear only in `migrations/real/` and in gitignored data — never in this register, the build plan, a committed fixture or an always-run test (T-58).**

---

## T-60 · Canadian stations from BVD's travel-centre directory

**Priority 60. D29.**

**Goal.** Every station on a CA invoice resolves to a `stations` row with coordinates, loaded from BVD's own travel-centre directory by the same code that loads the Love's export — and none of those stations ever reaches the US planner.

**Why.** `stations` rows are created today only by the US price-sheet ingest; the Love's loader (`scripts/resolve_from_operator.py`) only *enriches* rows that already exist. A CA site has no price-sheet row, so `resolveStation` returns `null` for all 9 sites on invoice 999217. BVD's directory (`bvd-travel-centres-2026-10-01.csv`, 92 rows, 6 provinces) carries the same `Site #` the invoice prints (58156 = BVD Comber on both): all 9 of 999217's sites are in it, and none of its 91 site numbers collides with a US price-sheet `SITE`. The corridor query names an unpriced station in `exclusions` by design (`LEFT JOIN LATERAL`), so without a filter, border stations — Sarnia, Windsor, Niagara — would start appearing as "no price" on US routes.

**Design.**
- `data/loves/` is renamed `data/US-CA-GasStations/` with `git mv`. It holds `LovesSearchResults.xlsx` and `bvd-travel-centres-2026-10-01.csv`, both committed (D29); the directory CSV is already on disk, untracked, in `data/loves/`.
- The same two files gain a second source format rather than new files: `scripts/resolve_from_operator.py` (DB load) and `backend/src/resolution/operatorExport.ts` (the pure row → station mapping and its types).
- A directory row **inserts or updates** `stations` on `(supplier 'BVD', site_ref = Site #)`: `name_raw` = Site Name, `city_raw`/`city_normalized`, `state_usps` = the province's two-letter code (`Ontario` → `ON`; the column name is a misnomer the ticket notes in a comment, not a rename), `country = 'CA'`, `geom` from Latitude/Longitude, `resolution = 'exact'`, `uncertainty_miles = 0`, `resolution_source = 'bvd_directory'`, `truck_accessible = 'unverified'` (the planner never uses these stations, so there is nothing to verify them for). `store_number` stays null — BVD names carry no `#`, and `Store ID` is not a store number in the `LOVES #368` sense.
- `operator_attrs`' closed field set (§17.1) gains the directory's non-price fields: `Status`, `StoreId`, `Address`, `PostalCode`, `Highway`, `Exit`, `DEFAtPump`, `TruckParking`, `CatScale`. Rows whose `Status` is `Coming soon` or `Temporarily closed` still load (an invoice can name them); a row with no `Site #` is skipped and reported by name (one in the current file).
- The v1 planner filters `stations.country = 'US'` — corridor candidates **and** exclusions — and `GET /stations` (the "Show all sheet stations" layer) does the same.

**Files.** Moved: `data/loves/` → `data/US-CA-GasStations/`, `backend/test/fixtures/loves/` → `backend/test/fixtures/US-CA-GasStations/`. Modified: `scripts/resolve_from_operator.py`, `backend/src/resolution/operatorExport.ts` (+ test), `backend/src/planning/corridor.ts` (+ test), `backend/src/catalog/stations.ts` (+ test), `package.json` (`db:reset:real` path), `CLAUDE.md` (Data on disk table; the operator-export licensing line covers the BVD directory too), `PROJECT-SCOPE.md` §17.1 (closed attribute set).

**Dependencies.** T-08.

**Definition of done.**
- [x] `data/loves/` no longer exists; `git log --follow` traces `LovesSearchResults.xlsx` across the rename; `npm run db:reset:real` runs green on the new path.
- [x] The loader inserts 91 CA stations (`country = 'CA'`, province codes, coordinates) and names the one row it skipped; a second run changes nothing.
- [x] US resolution is unchanged: 604/605 from the Love's export, #306 still `unresolved`.
- [x] `matchStation` resolves all 9 site numbers on 999217 via `site_ref`. The directory is committed, so this runs in CI; the invoice-side assertion is `skipIf(!hasRealFixture)`.
- [x] A CA station placed 1 mile from a US route line appears in neither the corridor's candidates nor its `exclusions`, nor in `GET /stations`.
- [x] `operator_attrs` on every directory row holds only the closed key set — asserted, not eyeballed.
- [x] The committed CSV parses identically from a CRLF checkout (`core.autocrlf`; the case is built in the test, not committed).

---

## T-61 · Currency and native units at invoice import — the CA invoice

**Priority 61. D24, D25, D30.**

**Goal.** A CA invoice PDF imports, reconciles to the cent, and is stored exactly as BVD printed it — litres, CAD per litre, CAD, with its sales-tax columns — beside an explicit `currency` and `qty_unit`.

**Why.** Every invoice column is named and typed as USD-and-gallons (`grand_total_usd`, `fuel_stop_lines.gallons`, `billed_usd_per_gal`, …), and the PDF parser anchors on a literal `US` currency token (`parseInvoicePdf.ts`: the fuel-row reader near L151, the express reader near L210). A `CN` row is either rejected or mis-columned, and a CA figure stored in a `_usd` column is the silent-corruption shape CLAUDE.md exists to prevent. The tax columns (`HST`/`GST`/`PST`/`QST`) are parsed for column alignment but never stored — on a CA invoice they are 13% of the bill.

**Design.**
- `0003_actuals_schema.sql`, edited in place (D21): `invoices` gains `currency` (`'USD' | 'CAD'`) and `qty_unit` (`'gal' | 'L'`); every invoice money column drops its `_usd` suffix (`grand_total`, `total`, `amount`, `discount`, `fee`) and every volume/price column drops its unit (`gallons` → `qty`, `retail_usd_per_gal` → `retail_per_unit`, `billed_usd_per_gal` → `billed_per_unit`). `fuel_stop_lines` and `invoice_totals` gain `pre_tax_amount`, `hst`, `gst`, `pst`, `qst`. `amount` stays the printed **Final AMT** (tax included).
- `CUR` maps `US` → `USD`, `CN` → `CAD`; anything else is a row rejection with a reason code (`UNKNOWN_CURRENCY`). Mixed currencies within one invoice reject the invoice (D24). `qty_unit` follows currency (CAD → L) — verified on 999217, asserted per invoice.
- Reconciliation (T-28) adds, per line: Pre Tax AMT + HST + GST + PST + QST = Final AMT exactly; Retail − Billed = Disc Rate exactly; and QTY × Billed against Final AMT (likewise QTY × Disc Rate against Disc AMT) within the **rounding bound** of the printed figures — |QTY × Billed − Final| ≤ ½¢ + 0.005 × Billed + 0.00005 × QTY, in integer arithmetic, skipped on a zero-QTY line (Scale). Per printed product row the same tax identity; the grand-total row's Pre Tax and tax columns equal the sums of the priced product rows (TA/TF/DF) — Scale, Manual and Express print a final amount only, so their tax is in Final AMT but not in the grand total's tax columns. US lines satisfy the same checks with zero tax. *(Amended 2026-10-01, measured on 999210 and 999217: BVD prints QTY at 2dp and prices at 4dp from unrounded figures, so QTY × Billed = Final AMT to the cent fails on 103 of 146 real lines, by 1–3¢, always inside the rounding bound; the two exact identities hold on all 146.)*
- The sub-gallon rule converts litres → gallons at its input (D25); its threshold stays in gallons. "Price above published" has no Canadian published price, so it yields `discrepancy: null` for CA stops (A18 Q5's existing null path), never `0`.
- The CSV parser rejects a `CN` invoice with `CA_CSV_UNVERIFIED` (D30).
- Until T-63 lands, every period-scoped endpoint filters to `currency = 'USD'`, so a CA invoice in the database cannot leak into a US screen under the old `period_start` key. The API keeps its current field names until T-63 reshapes the contract.
- The transaction at 2026-09-10 00:45:19 on 999217 falls after the printed period end (09-09 23:59:59). It must import — the printed period is not a filter — and the ticket pins with a test how `occurred_at` is interpreted (BVD's local time vs UTC), since T-63's actual range depends on it.

**Files.** Modified: `migrations/synthetic/0003_actuals_schema.sql`, `migrations/real/0003_actuals_schema.sql`, `backend/src/invoice/parseInvoicePdf.ts`, `parseInvoiceCsv.ts`, `importInvoice.ts`, `reconcile.ts`, `backend/src/anomaly/rules/subGallon.ts`, `priceAbovePublished.ts`, `backend/src/db/types.ts`, every `backend/src/actuals/*.ts` query touching a renamed column, `backend/test/fixtures/invoices/generateSamplePdf.ts`. New: `backend/test/fixtures/invoices/sample-ca.pdf` (synthetic — invented names, `90000xx` cards from T-62's synthetic set, written in the CA layout, **not** a reshaped US fixture), `backend/test/integration/invoice999217.test.ts` (`skipIf(!hasRealFixture)`, migrates from `migrations/real`). Docs: `CLAUDE.md` ("Rules that are easy to get wrong" — `CN`, litres, tax-inclusive billed price, the D25 storage exception).

**Dependencies.** T-31, T-62 (the real 999217 cannot resolve its cards until the roster has them).

**Definition of done.**
- [x] `sample-ca.pdf` imports in CI: `currency = 'CAD'`, `qty_unit = 'L'`, every tax column stored, every reconciliation check passes (integer cents and ten-thousandths, never `toBeCloseTo` — the rounding bound is itself integer arithmetic).
- [x] The real 999217 imports locally with no quarantine: 60 lines, 59 fuel stops, 34 cards, 9 stations resolved (with T-60), grand total CAD 46,837.33 = pre-tax 41,356.89 + HST 5,376.44 + Scale 104.00 (final-only row); TA 21,318.77 L.
- [x] The real 999210 still imports exactly as before (`currency = 'USD'`, `qty_unit = 'gal'`, tax columns zero), and its gated assertions are unchanged.
- [x] A `CN` CSV is rejected with `CA_CSV_UNVERIFIED`; an unknown `CUR` is a quarantined row with `UNKNOWN_CURRENCY`; a mixed-currency invoice is rejected whole.
- [x] The sub-gallon rule judges litres in gallons: a 3 L diesel line (0.79 gal) is flagged; a 0.01 L DEF line is still exempt (T-40F).
- [x] No US screen shows a CA figure before T-63 (asserted on `/overview` and `/transactions`).
- [x] `git grep` finds no `_usd` invoice column left in `migrations/` or `backend/src/`.

---

## T-62 · CA fleet roster additions — 21 cards and drivers, 20 trucks

**Priority 62. Extends T-58's real/synthetic split.**

**Goal.** Every card and driver on the CA invoice resolves, in both migration sets, without a real name or card number ever entering a tracked file.

**Why.** Invoice 999217 carries 34 cards. 13 are already in the roster, under the same drivers as on the US invoice; **21 cards and their 21 drivers are not**, and 20 of the units entered on the CA invoice (`038 035 067 056 1004 062 1002 058 1010 029 033 005 034 054 040 028 037 049 059 074`) are not in the truck roster either. Unresolved, every one of those stops imports with no driver and no truck.

**Design.**
- `migrations/real/0005_fleet_roster_seed.sql` (gitignored): the 21 real cards and drivers, the 20 trucks, and the assignments below.
- `migrations/synthetic/0005_fleet_roster_seed.sql` (committed): 21 invented drivers and 21 cards continuing the `90000xx` range past the highest existing synthetic card — same shape (mixed one-, two- and three-token names), same trucks, same assignments, same ambiguous cases. **Unit numbers are identical in both sets** (CLAUDE.md).
- **Assignments, decided 2026-10-01:** the 16 new drivers whose CA stops all carry one unit are assigned that unit, effective from the invoice's first transaction date. The **5** whose stops carry several units, or a unit another new driver also entered (one driver entered three different units; one entered two; `062` and `031` are each shared by two new drivers), get **no assignment** — their stops import with the entered unit shown and no assigned truck, until assignments are set in Settings (T-47). One existing driver entered `074` on the CA invoice: `074` is added as a truck and that driver's existing assignment is left unchanged, so the mismatch flag fires, as it should.
- Where a newly assigned unit already belongs to another driver's assignment, that is the shared-truck scenario the US roster already models — kept, not resolved.

**Files.** Modified: `migrations/real/0005_fleet_roster_seed.sql`, `migrations/synthetic/0005_fleet_roster_seed.sql`, `backend/test/integration/actualsSeed.test.ts` (row counts), `referenceLayer.test.ts`.

**Dependencies.** T-58.

**Definition of done.**
- [x] Both sets apply cleanly and produce identical counts: 21 more cards and drivers than today, the 20 new trucks, 16 new assignments.
- [x] Against `migrations/real`, every card on 999217 resolves to a driver (gated test).
- [x] Against `migrations/synthetic`, `sample-ca.pdf` (T-61) resolves every card, and the five unassigned drivers' stops resolve a driver and no truck. *(Roster half asserted in `referenceLayer.test.ts`; the `sample-ca.pdf` half in `importInvoiceCa.test.ts`, landed with T-61.)*
- [x] `git grep` across the tracked tree finds none of the 21 real names or card numbers.

---

## T-63 · Billing weeks — pair US and CA invoices on period end

**Priority 63. D26.**

**Goal.** A "period" becomes a billing week — the invoices whose `billing_week_end` match — and every period-scoped endpoint serves one side (US or CA) or both of that week.

**Why.** Every Actuals endpoint keys on `?period=` = `invoices.period_start`. 999210 (US) prints 09-03 → 09-09; 999217 (CA) prints **08-01** → 09-09 while its transactions run 09-03 → 09-10. Keyed on start, the two can never pair, and the gap report (`invoiceGapReport.ts`) would count Aug 1 – Sep 2 as covered.

**Design.**
- `invoices` gains `billing_week_end date NOT NULL` (defaulted at import to the printed `period_end`), `actual_start date`, `actual_end date` (first/last transaction date) and a unique `(billing_week_end, currency)` — two US invoices in one week is a 409, not a silent merge. *(As built: the unique index is partial, `WHERE status = 'imported'`. A quarantined invoice has no rows and can never be re-imported under its number, so a full constraint would let it hold a week for ever and turn the replacement's import into a unique violation instead of a named conflict.)* `period_start`/`period_end` stay as printed.
- `PATCH /invoices/{id}` `{ billingWeekEnd }` moves an invoice to another week (the Import screen's override, T-64); a collision is a 409 problem+json.
- `GET /periods` returns weeks, newest first: `{ weekEnd, invoices: [{ id, invoiceNumber, currency, printedStart, printedEnd, actualStart, actualEnd, datesDiffer }] }` — `datesDiffer` when the printed range ≠ the actual range.
- Period-scoped endpoints take `?week=YYYY-MM-DD` plus `?currency=USD|CAD` where a screen shows one side (Transactions, Drivers, Trucks, Stations, Other Charges, Receipts). `/overview` takes `week` alone (T-65 shapes its body). Plan vs Actual stays US-only — plans are US-only. *(As built: `week` is required except where the screen has none of its own — `GET /trucks` (the D23 roster), `GET /transactions` (a driver's or truck's history spans weeks) and `GET /receipt-queue` (a standing worklist, D17) — and `currency` defaults to `USD` on the one-sided screens, since gallons and litres cannot be summed, but means "both sides" on Transactions and the receipt queue, whose rows each carry their own. The station billed-price series takes `currency` too, defaulting to the station's own country. `/overview` serves the week's US invoice until T-65.)*
- Money fields drop their `Usd` suffix (`amountUsd` → `amount`, `avgBilledUsdPerGal` → `avgBilledPerUnit`, …) beside the existing `currency` field, which now carries the invoice's currency (A13 as amended). `?units=` converts quantities and per-unit prices at the API (D25).
- The gap report runs over each currency's actual ranges, not printed ones.
- T-61's temporary `currency = 'USD'` filter is removed.

**Files.** Modified: `migrations/{synthetic,real}/0003_actuals_schema.sql`, `backend/src/invoice/importInvoice.ts`, `invoiceGapReport.ts`, `backend/src/api/routes/*` (every `period` schema), `backend/src/actuals/*.ts`, `docs/UI-DATA-CONTRACT.md`, `PROJECT-SCOPE-v2.md` §A13. Frontend: the API client types and every hook that passes `period` (wired to a US default, so screens keep working until T-64 adds the switch).

**Dependencies.** T-61.

**Definition of done.**
- [x] 999210 and 999217 land in one week, ending 2026-09-09; `datesDiffer` is true for 999217 only. *(Gated, `billingWeeksReal.test.ts`; the synthetic pair is composed in the test by re-dating a copy of the US fixture, `billingWeeks.test.ts`.)*
- [x] Moving an invoice to another week via `PATCH` moves it in `/periods`; moving a second US invoice into an occupied week → 409.
- [x] `/transactions?week=2026-09-09&currency=CAD` returns only 999217's stops, in litres and CAD; `?units=imperial` returns gallons with the same money.
- [x] The gap report treats Aug 1 – Sep 2 as **not** covered by 999217. *(Per currency, over each invoice's actual range; the import report carries `actualStart`/`actualEnd`.)*
- [x] Every period-scoped route rejects a missing or malformed `week` with a 400 problem+json, and an unknown `currency` likewise. *(`weekParams.test.ts`, no database; on the three routes where `week` is optional, only a malformed one.)*
- [x] No response field ends in `Usd`; every money field has a `currency` beside it. *(`responseKeys.test.ts` walks every period-scoped response, anomaly `detail` included; the legacy US `detail` keys are renamed at the API, not rewritten in the table.)*

---

## T-64 · Week selector, "Invoices in view", and Transactions in native units

**Priority 64. D26, D28.**

**Goal.** The top bar picks a week; a strip under it lists that week's invoices, shows which are behind the page, and picks which Transactions shows; one conversion control shows every row on screen in USD/gal or CAD/L.

**Design.** (Revised on review, before merge: the strip is the invoice picker, and one two-button conversion replaces the US | CA switch and the gal/L toggle.)
- **Week selector** (replaces `InvoicePeriodSelector`): options read just "Week ending Sep 9, 2026". The invoices behind a week, and its ⚠, are on the strip.
- **"Invoices in view" strip** (new, shell-level): one chip per invoice in the week — flag, number, actual range (`🇺🇸 999210 · Sep 3–9`) — plus **"All invoices"** when the week has more than one. A chip opens that invoice on Transactions (`?invoice=<id>`, or `all`); already on Transactions, the filters are kept. States: *in view* (highlighted — the invoices the screen's figures came from), *not in view* (dimmed), *not imported* (greyed "🇨🇦 Not imported", not a link), ⚠ with a tooltip giving printed vs actual range. With no `?invoice=`, Transactions shows the week's first invoice (USD before CAD). The row-level "Source: 999210" in an expanded transaction names that row's own invoice. Shared through the shell's context, so Drivers, Trucks, Stations and Other Charges (T-44, T-45) publish what they show the same way.
- **Conversion — `USD/gal` | `CAD/L`:** one control on Transactions, applied to every row on screen, one invoice or All. With nothing chosen each invoice shows **as it came in** (US: gal and USD/gal; CA: L and CAD/L), and the pressed button says which. A choice belongs to the invoice it was made on: picking another invoice, or coming back, shows that invoice as it came in again. **Money converts in T-66:** until a CA invoice carries the exchange rate the dispatcher enters (T-66), a choice converts quantity and per-unit price (`?units=`) and leaves money in its own currency, labelled, with a "rate pending" note — never a 1.0 rate (D27). The request is built in one place (`lib/conversion.ts` `conversionParams`) so T-66 adds `convertTo` there.
- **Formatting:** 4dp per-unit prices, 2dp money, `US$`/`CA$` on money cells and the currency on money headers (A6.1 as amended); per-unit headers follow the unit shown (`/gal`, `/L`). Under All invoices, each row is tagged under its date with the invoice it came from and its country (`🇨🇦 999217`), totals that would add litres to gallons or CAD to USD are withheld, and each quantity cell names its unit. A CA stop's expanded detail shows Pre-tax, HST, GST, PST, QST and Final separately.
- **Import screen:** an invoice with `datesDiffer` shows the amber note ("Printed Aug 1 – Sep 9; transactions Sep 3 – Sep 10"); a "Belongs to week ending ___" control calls T-63's `PATCH`.

**Files.** New: `frontend/src/components/WeekSelector.tsx`, `InvoicesInView.tsx`, `ConversionToggle.tsx`; `frontend/src/hooks/useWeek.tsx` (the shell's week context — it replaces `useInvoicePeriod.ts`), `useInvoiceInView.ts`; `frontend/src/lib/weeks.ts`, `conversion.ts` (+ tests). Modified: `TopBar.tsx`, `(app)/layout.tsx` (mounts the context), `frontend/src/app/(app)/transactions/page.tsx`, `TransactionsTable.tsx`, `StopExpansion`, `BilledPrice.tsx`, `lib/formatMoney.ts`, the Overview page (publishes its US invoice), the Import screens (T-42: `ImportHistory.tsx`, `import/page.tsx`, `ReconciliationPreview.tsx`). Removed: `InvoicePeriodSelector.tsx`, `useInvoicePeriod.ts`. URL keys: `week` (was `period`) and `invoice`.

**Dependencies.** T-63, T-40, T-42.

**Definition of done.**
- [ ] The selector lists weeks, not invoices: each option reads "Week ending …" alone.
- [ ] The strip lists every invoice in the week (and "All invoices" for two); a chip opens that invoice on Transactions; the highlighted chips are exactly the invoices the page's figures came from — asserted against the API calls made.
- [ ] Each invoice opens as it came in (US: gal and USD/gal; CA: L and CAD/L); a conversion applies to every row on screen, one invoice or All, and does not carry over to another invoice.
- [ ] Until T-66, a conversion changes quantity and per-unit price only; money stays in its own currency with "rate pending", never converted at 1.0.
- [ ] The Import screen's override moves an invoice and the selector reflects it without a reload; a 409 shows its reason.

---

## T-65 · Overview — US, CA and combined panels

**Priority 65. D27, D28.**

**Goal.** For the selected week: US KPIs top left, CA KPIs top right, combined totals and rates below.

**Design.**
- `GET /overview?week=` returns `{ us, ca, combined, fx }`; `us`/`ca` are the existing per-invoice overview body (or `null` when that side is not imported), in the invoice's currency and native units.
- **CA panel:** spend, diesel, DEF, discount and rates shown **before tax, tax, and with tax** — billed per litre both before and with tax (1.9046 / 2.1522 CAD/L on a 999217 line). Tax = HST + GST + PST + QST, labelled "HST" when only HST is non-zero, "Sales tax" otherwise.
- **US panel:** unchanged figures; one value each (US tax is inside the pump price).
- **Combined panel:** USD by default, CAD on request, converted at the CA invoice's entered rate (T-66), with the rate and when it was entered shown. Spend before HST = US + CA before tax; with HST = US + CA with tax; HST separately. Rates in one unit (the toggle's; USD/gal by default).
- **States:** one side missing → combined shows the present side's totals labelled **"Partial — CA invoice not imported"** (or US); rate unavailable → "rate pending" in place of every converted figure, never a 1.0 conversion; `datesDiffer` → a footnote with each invoice's actual range.
- The "Invoices in view" strip shows both chips highlighted.

**Files.** Modified: `backend/src/actuals/overview.ts`, `backend/src/api/routes/overview.ts`, the Overview page and KPI components (T-41), `docs/UI-DATA-CONTRACT.md`.

**Dependencies.** T-63, T-64, T-66, T-41.

**Definition of done.**
- [ ] For the week ending 2026-09-09 the CA panel's with-tax spend equals 999217's grand total, and before-tax + tax = with-tax exactly.
- [ ] Combined USD spend = US total + CA total ÷ stored rate, computed in integer cents with one documented rounding point.
- [ ] A week with only a US invoice shows the CA panel as "Not imported" and the combined panel as "Partial".
- [ ] A CA invoice with no rate shows "rate pending" on every converted figure, and none of them is computed.
- [ ] The units toggle changes CA's per-litre rates to per-gallon and the combined rates accordingly; money is unchanged.

---

## T-66 · Exchange rate on the CA invoice, entered by the dispatcher

**Priority 66. D27 (as amended 2026-10-06).**

**Goal.** Each CA invoice carries a USD/CAD exchange rate **the dispatcher enters** — not one fetched from the Bank of Canada for a given day — and the Transactions conversion (T-64's `USD/gal` | `CAD/L`) uses it to convert money as well as units.

**Why the change.** The rate that matters is the one the company actually settled at, which the dispatcher knows and a published daily rate does not. Entering it also drops the external dependency: no provider, no network call at import, no recorded fixtures, no terms of use to track.

**Design.**
- **One rate per CA invoice**, quoted as **CAD per 1 USD** (e.g. `1.3712`), up to 6 dp. CAD → USD divides by it; USD → CAD multiplies. `invoices` gains `fx_cad_per_usd numeric(10,6)` and `fx_entered_at timestamptz`, both nullable and both null on a USD invoice (a CHECK keeps them null there).
- **Entering it.**
  - **Import screen:** the reconciliation preview of a CA invoice asks "Exchange rate (CAD per USD)" — optional; skipping leaves it pending. A CA row in Import history shows its rate (or "rate pending") with the same field to enter or correct it.
  - **API:** `PATCH /invoices/{id}` accepts `{ fxCadPerUsd }` (a number, or `null` to clear it) alone or beside `billingWeekEnd`. On a USD invoice it is a 400; a value ≤ 0 or outside a sanity band of 0.5–3.0 is a 400 (a typo guard, not a market check). The response is the updated invoice, which carries `fxCadPerUsd` and `fxEnteredAt`.
  - **CLI:** `npm run import-invoice -- <file> --fx-rate 1.3712` sets it at import; the flag on a USD invoice is an error before anything is written.
- **Correctable, not frozen.** A rate can be changed later — a mistyped rate must be fixable — and `fx_entered_at` records when it last changed. Nothing converted is ever stored, so a corrected rate re-converts every figure the next time it is read; there is no stale converted copy to repair.
- **No rate → "rate pending"**, never a 1.0 conversion (D27). Every place that would convert shows "rate pending" with a link to the invoice's row in Import history to enter it.
- **Display conversion of money (T-64's control).** `GET /transactions` gains `?convertTo=USD|CAD` beside `?units=`. It converts every money field on a row and its lines (amount, pre-tax, HST, GST, PST, QST, stop total) and the per-unit prices at the CA invoice's entered rate — CAD → USD divides by `fx_cad_per_usd`, USD → CAD multiplies by the rate of the CA invoice in the same billing week — each stored figure converted on its own and rounded once to the cent (prices to 4dp). A converted row's `currency` is the target; it also carries `invoiceCurrency` (what BVD billed, which `StopExpansion`'s Source row and the All-invoices row tag key on) and `fx: { rate, enteredAt }`. With no entered rate the money fields are `null` and the row has `ratePending: true`. A row already in the target currency is unchanged. Nothing converted is stored. This amends D25 ("`?units=` … never money"): money converts only through `convertTo`, only at an entered rate.
- **Frontend.** `frontend/src/lib/conversion.ts` `conversionParams` adds `convertTo: choiceCurrency(choice)` (one line; nothing else builds the request). The table's caption — today "converting them needs the Bank of Canada rate (rate pending)" — becomes the rate line ("Converted at 1.3712 CAD per USD, entered Oct 6"), shown only when a row was converted; with no rate it reads "rate pending — enter the exchange rate on the Import screen" and links there. A `ratePending` row shows "rate pending" in its money cells. Under All invoices in one currency, the money totals that T-64 withholds become summable.

**Files.** Modified: `migrations/{synthetic,real}/0003_actuals_schema.sql` (D21 — still pre-deploy), `backend/src/invoice/importInvoice.ts` (optional rate at import), `backend/src/api/routes/invoices.ts` (`PATCH` accepts `fxCadPerUsd`; list and detail return it), the import CLI (`--fx-rate`), `backend/src/api/routes/transactions.ts` and `backend/src/actuals/transactions.ts` (`convertTo`), `frontend/src/lib/api.ts`, `frontend/src/lib/conversion.ts`, `TransactionsTable.tsx`, `ReconciliationPreview.tsx`, `ImportHistory.tsx`, `import/page.tsx`, `docs/UI-DATA-CONTRACT.md` §9, `PROJECT-SCOPE-v2.md` D25. No new module, no fixture, no network.

**Dependencies.** T-61, T-64.

**Definition of done.**
- [ ] `PATCH /invoices/{id}` `{ fxCadPerUsd: 1.3712 }` on a CA invoice stores it with `fx_entered_at`; a second `PATCH` corrects it; `null` clears it back to pending; on a USD invoice, or ≤ 0, or outside 0.5–3.0, it is a 400 and nothing changes.
- [ ] `--fx-rate` sets the rate at import; on a USD invoice it fails before any write.
- [ ] The Import screen asks for the rate on a CA preview (skippable) and shows, enters and corrects it on a CA history row; a USD row has no rate field.
- [ ] `GET /transactions?convertTo=USD` on 999217's week returns each CAD money field ÷ the entered rate, rounded once to the cent, with `fx` and `invoiceCurrency` on the row; with no rate, money is `null` and `ratePending: true`; a USD row is unchanged; correcting the rate changes the next read and nothing stored.
- [ ] On Transactions, `USD/gal` on the CA invoice shows USD money and the rate line; with no rate, "rate pending" and a link to enter it.
- [ ] The full suite runs with no network.
