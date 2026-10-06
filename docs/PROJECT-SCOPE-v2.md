# CH Fuel App — Project scope, v2 (merge addendum)

**Document version:** 2.0 — 14 September 2026
**Organisation:** 2043733 Ontario Inc., DBA CH Logistics, Burlington ON
**Relationship to v1:** this document **extends** `PROJECT-SCOPE.md` (v1.0, the Fuel Planner scope). v1 sections stay in force unless a section below supersedes them. Where the two disagree, **v2 wins and v1 gets edited** — same rule v1 applies to its own migrations.

Section numbers are prefixed `A` (A1, A2 …) so they never collide with v1's §1–§23. Cross-references to v1 keep the plain `§` form.

---

## Table of contents

- [A1. What the merged app does](#a1-what-the-merged-app-does)
- [A2. Users](#a2-users)
- [A3. Where the build stands](#a3-where-the-build-stands)
- [A4. Scope boundaries for v2](#a4-scope-boundaries-for-v2)
- [A5. The invoice data](#a5-the-invoice-data)
- [A6. Domain rules the design must respect](#a6-domain-rules-the-design-must-respect)
- [A7. Information architecture](#a7-information-architecture)
- [A8. Screens](#a8-screens)
- [A9. Two conventions established by the design](#a9-two-conventions-established-by-the-design)
- [A10. Anomaly flags](#a10-anomaly-flags)
- [A11. Schema additions](#a11-schema-additions)
- [A12. Service boundaries](#a12-service-boundaries)
- [A13. API additions](#a13-api-additions)
- [A14. Plan vs Actual matching](#a14-plan-vs-actual-matching)
- [A15. Decisions locked for v2](#a15-decisions-locked-for-v2)
- [A16. Amendments to v1 tickets](#a16-amendments-to-v1-tickets)
- [A17. Non-goals](#a17-non-goals)
- [A18. Open questions](#a18-open-questions)
- [A19. Reference data for fixtures](#a19-reference-data-for-fixtures)

---

## A1. What the merged app does

One internal web app that **plans where trucks should refuel, then measures what they actually paid** — closing the loop between recommendation and receipt.

- **Plan** (v1, forward-looking): route in, cheapest compliant Love's stops out, driver link.
- **Actuals** (v2, backward-looking): weekly BVD invoice in, every transaction / driver / truck / station / express charge recorded and reported on.
- **Shared reference layer**: trucks, drivers, fuel cards, Love's stations — single tables used by both halves. This is the whole reason for merging.
- **Plan vs Actual**: the payoff screen. Recommended stops and expected prices against the stops actually made and their billed prices, with the delta in dollars.

---

## A2. Users

| Role | Reality |
|---|---|
| **Dispatcher** (primary) | Also the developer building this. Plans routes, reviews invoices, checks receipt compliance. Uses it constantly. |
| **Management** (secondary) | Wants spend and compliance summaries. Read-mostly. |
| **Admin** (possible) | Data entry, alias cleanup. |
| **Drivers** | **Not users.** No login. They receive a read-only shared link for their fuel plan. |
| **Customers** | Never see this app. The public marketing website is a separate product sharing nothing but brand. |

Internal tool for a handful of named people, not multi-tenant SaaS. Do not design onboarding for strangers. Single-user auth today (v1 T-05, Auth.js credentials, JWT sessions per D7), with room for a small team later — **no elaborate roles UI**.

---

## A3. Where the build stands

Verified 15 September 2026. This table is the last hand-maintained status snapshot in this doc — for anything past T-25, treat `TICKETS-v2.md`'s ticket index as the source of truth rather than re-syncing this table on every merge.

| Ticket | State |
|---|---|
| T-01 … T-10 | **Complete, merged to `main` in `CH-Fuel-Planner`.** Toolchain + CI + hooks; rewritten schema + drift test; seed data (3 truck profiles, gazetteer, 1 user, 1 product code); Next.js/TS migration; `@ch/core` build boundary; auth + login; BVD price-sheet ingest + backfill (30 January dates + August sheet); station resolution 604/605 (#306 is temporarily closed and stays `unresolved`); ORS adapter + budget guard + both meters. |
| T-11 … T-24 | Specified in `TICKETS.md`; see `TICKETS-v2.md`'s index for what has merged (T-11 corridor and T-12 optimiser have). Corridor query, optimiser, validation loop, detour costing, geocoding, plan endpoints, disclaimers, read endpoints, `sentToDriver`, frontend client, MapLibre, UI states, deploy. T-20 deferred (§17). |
| T-25 | **Complete, merged to `main` (`324e939`, PR #12).** Actuals schema + seed data only — `drivers`, `driver_aliases`, `trucks`, `fuel_cards`, `truck_assignments`, invoice/fuel-stop/anomaly tables, 27-unit reference seed. No service, API, or UI touches these tables yet. |
| T-26 … T-49 | **New in v2, not built.** `TICKETS-v2.md`. |

The frontend today is the v1 three-tab shell (Plan / Recent / Dev Tools) plus a Metrics tab in the design package. v2 replaces that shell with the sidebar IA in A7 — see A16.

---

## A4. Scope boundaries for v2

**In scope**

- Weekly BVD invoice import (the emailed PDF preferred, the portal CSV also accepted — D13), with reconciliation and a quarantine state.
- Transactions, transaction detail, receipt queue, other charges.
- Drivers, trucks, stations analysis keyed on the shared reference layer.
- Plan vs Actual — live (current invoice) and historical backtest.
- Card→truck→driver assignments with effective dates; driver name aliases; anomaly thresholds.
- Ten years of historical invoices backfilled from Gmail, eventually (A19, T-48).

**Out of scope** — see A17.

---

## A5. The invoice data

Measured against invoice **999210** (period 2026-09-03 → 2026-09-09, invoice-dated 2026-09-10, due 2026-09-11; BVD Petroleum, 130 Delta Park Blvd, Brampton ON).

| Figure | Value |
|---|---|
| Active fuel cards | 27 |
| Fuel stops in the week | ~60 |
| Diesel (TA) | 8,733.11 gal / $48,450.68 |
| DEF (DF) | 174.43 gal / $845.40 |
| Scale (S) | $90.50 |
| Express | $1,543.13 |
| **Grand total** | **$50,929.71 USD** |
| Discount captured | $5,088.61 ($0.58/gal average) |
| Average billed price | $5.55/gal |
| Receipt compliance | 48 of 60 confirmed |
| Anomalies flagged | 3 |

**Shape.** Invoices are weekly. Every amount is USD. A fuel stop is a group of product lines sharing a **base auth code** — the legacy Google Sheet recorded only the diesel line and silently dropped DEF ($36.78 on one stop alone), which is the single most important reason this half exists. Express charges sit in a separate section with a different shape and were entirely absent from the spreadsheet despite being $1,543.13 in one week. Every express code carries a flat **$3.00** fee.

**Product codes.** `TA` tractor diesel · `DF` DEF · `S` scale · `TF` trailer · `AD` additive · `O` oil · `L` lubricant · `C` cash. Same tripwire rule as v1 §11.1: **an unmapped code fails its row**, never default-maps.

---

## A6. Domain rules the design must respect

From the planning side (v1 §5, unchanged): hard **500-mile cap** and **300-mile floor** between fills (the floor relaxes with a `MIN_LEG_RELAXED` disclaimer; there is **no floor on the final leg**); US trips start at 100% fuel because drivers fill before the border; Love's only; typical problem size 1–4 stops from tens of candidates.

From the invoice side (new):

1. **Currency is always visible.** USD or CAD marker — the invoice's own currency (D24) — on every money column header or value. Never a bare `$`.
2. **Number formatting.** Gallons 2dp · per-gallon prices **4dp** (`5.2395`) · money 2dp. Right-align all numerics, tabular figures. The 4dp-beside-2dp collision is a real layout constraint, solved in the design file by giving billed $/gal its own column and its own type size.
3. **Billed price per gallon is the headline metric. Discount is subordinate everywhere.** Discount is retail minus billed, and retail is whatever the pump posted that day, so a big discount can mean a bad price. Real case from 999210 (synthetic names — T-58): ROBIN CROSS paid **5.199** with a $0.900 discount; LOU FIELD paid **5.899** with a $0.400 discount. The larger discount is the better deal only by coincidence.
4. **Every list view must work with thousands of rows** and a real date-range picker — ten years of history is coming. Data volume is still modest (~3,000 fuel stops/year): design for readability and density, **not** virtualised million-row performance.
5. **Billed price appears to be set per site per day.** Three drivers at LOVES #313 (Matthews MO, site 25334) on 9/7 were all billed 5.5208, and the one stop there on 9/9 was billed 5.5208 too (measured on the 999210 CSV — an earlier draft said "five drivers on 9/7 and 9/9"; five is the station's total diesel rows for the invoice, the fifth being 9/3 at 5.6593). Across all 54 site-days on the invoice none carries two billed prices, though only five have more than one stop. That consistency means the invoice can be audited against BVD's published price file — the app needs a place to show a discrepancy when one is found.
6. **Raw driver entry is unreliable.** Drivers type their unit number at the pump and it is frequently wrong: `0` entered on one stop and `072` on another by the same driver; unit `072` entered on two different cards the same day; unit `1012` entered by two different drivers. The app resolves the true truck **from the card's driver and that driver's truck assignment** (D19), and shows both. Driver names on invoices are inconsistent free text and need an alias list.

---

## A7. Information architecture

Persistent left sidebar, three groups plus Settings. Supersedes v1's tab bar.

```
PLAN
  New Plan
  Plans

ACTUALS
  Overview
  Transactions
  Receipt Queue        [badge: count pending]
  Other Charges
  Import

ANALYSIS
  Drivers
  Trucks
  Stations
  Plan vs Actual

  Settings
```

Top bar carries a **global invoice-period selector** (default: most recent invoice) that governs Actuals and Analysis. **Plan screens ignore it** and show their own price-sheet date instead — the design file hides the selector on Plan screens and swaps in the plan's own context tags.

The shell must tolerate a larger navigation structure later (A18 Q4).

---

## A8. Screens

Numbered to match the design brief. The design file `CH Fuel App.dc.html` already realises A8.3, A8.10, and both Plan screens; the rest are specified here and ticketed from T-40.

### A8.1 Overview
Landing screen. Answers "how did last week go" in five seconds. KPI cards for the selected period using the A5 figures: total spend, diesel gal/$, **average billed price (headline)**, discount captured (subordinate), DEF, other charges, receipt compliance, anomalies flagged. Below: billed-price-per-gallon trend across recent periods, top-spend-by-driver bars, and a compact anomalies list linking into Transactions.

### A8.2 Import
Drag-and-drop for either BVD export. **Prefer the emailed PDF** — it is the only one carrying express tractor/driver and the invoice's own header dates (D13); the portal CSV is accepted too. Three states designed carefully:
1. **Parsing** — progress, file name, row/page count.
2. **Reconciliation passed** — preview of what will be written, with the balance check shown explicitly: parsed rows sum to the printed grand total per product code (TA + DF + S + Express = $50,929.71). Confirm writes.
3. **Reconciliation failed → quarantined** — a **full screen**, not a toast. Which product code failed, expected vs parsed, the offending rows. **Nothing is written.** The user must be able to decide whether to fix the file or report a BVD issue.

Plus a history list: invoice number, period, total, status, imported-at. Duplicate uploads of the same file are rejected with a designed message.

### A8.3 Transactions — *realised in the design file*
The workhorse. Dense, filterable, sortable. Columns: date/time, card, driver, truck, station (Love's number + city + state), gallons, **billed $/gal**, retail $/gal, total, receipt status, flags. Filters: date range, driver, truck, card, state, product type, receipt status, anomaly-only. One row per fuel stop grouped by base auth code; expanding reveals product lines with an unmissable **stop total**. Prioritise scannability and keyboard use over decoration.

### A8.4 Transaction detail
Full record: all product lines, station with map pin, card and its assigned truck and driver, raw entered values, receipt status with who checked and when, anomaly flags, link to the source invoice, and — when a plan covered this date and truck — a link to that plan.

### A8.5 Receipt Queue
The only write-heavy screen; optimise hard. Today it is manual: open Samsara, check whether the driver uploaded a receipt photo, type Y/N in a spreadsheet. Design a focused queue: one unconfirmed transaction at a time with enough context to search Samsara, Y/N/skip on keyboard shortcuts, progress (12 of 60), batch confirm for a driver who uploaded everything. **Must survive automation** — if Samsara's API exposes driver documents this becomes a review-exceptions queue, so the layout must not assume every item needs a human decision. **Must work well on a phone.**

### A8.6 Other Charges
Express codes: lumper fees, repairs, scale charges. The emailed PDF prints fourteen columns — date, express code, auth code, tractor, trailer, driver name/id, CDL, trip #, amount cashed, fee, total, currency, payee, notes — of which trailer, CDL and trip are blank on every invoice seen so far. **The portal CSV prints nine of them and omits tractor, trailer, driver, CDL and trip entirely**, so only a PDF import can attribute an express charge to a truck or driver (D13). Two quirks: some rows have **no driver name at all** (tractor 073, $200.00 + $3.00 = $203.00, note "lumper"), and driver names here are free text with inconsistent casing that will not always match a driver record — **show unmatched as unmatched rather than guessing**. Surface the $3.00 fee total separately.

### A8.7 Drivers
List: spend, gallons, average billed $/gal, receipt compliance %, anomaly count for the period. Detail: their average billed price against fleet average, transaction history, compliance over time, favoured stations, and **DEF-to-diesel gallon ratio** (an outlier can indicate misuse). Aliases live in Settings, not here.

### A8.8 Trucks
Same structure keyed on truck number, plus which card is assigned and **the history of that assignment** — a reassignment changes how past transactions resolve.

### A8.9 Stations
Love's locations reusing the v1 map treatment (MapLibre + OpenFreeMap, T-22). List and map views. Detail shows **billed price history at that site** and has a place to show a price discrepancy against BVD's published file (A6.5).

### A8.10 Plan vs Actual — *realised in the design file*
Two views behind one segmented control:
- **Live performance** — for the selected invoice period: recommended stops and expected prices against actual stops and billed prices, the dollar delta, skipped recommendations and unplanned stops, plan adherence, by-truck variance, needs-review list, flagged deviations.
- **Historical backtest** — past invoices re-solved against the archived BVD price file. Needs no plan, so it works over the full ten years of history once backfilled.

**The empty state is real and will persist** — plans and invoices only overlap once both halves run. Design it properly (the design file states the coverage explicitly: "14 of 60 stops covered by a plan").

### A8.11 Settings
Card→truck→driver assignments with effective dates. Driver name aliases. Anomaly thresholds. User management only if more than one person logs in.

---

## A9. Two conventions established by the design

Both are realised in `CH Fuel App.dc.html` and must be reused by every screen that shows invoice data.

**1. Billed dominant, discount subordinate.** Billed $/gal is the largest numeral in its row (14.5px condensed bold in the table, 4dp); retail is small and muted; discount is a 10px subline under billed, never coloured as a win, never given a KPI card more prominent than average billed price.

**2. Raw versus resolved.** Three states, one vocabulary:

| State | Treatment |
|---|---|
| Resolved (from the card's driver, the driver's truck assignment, or the alias table) | Solid ink, body font, semibold. |
| Raw, as entered at the pump / as printed on the invoice | Monospace, muted, **dotted underline**. |
| The two disagree | Both inside an amber-bordered cell: resolved value in ink, raw value in amber monospace prefixed `≠`. Also emits an anomaly flag. |

A legend strip under the filters teaches the vocabulary once. Anywhere raw invoice text appears — transaction rows, detail panels, other charges, import previews — it wears the raw treatment.

---

## A10. Anomaly flags

Consistent treatment across table, detail and overview. **Two severity levels at most** — *worth a look* (amber) and *probably a billing error* (red). Do not design five levels for a fleet this size.

| Rule | Example from 999210 | Severity |
|---|---|---|
| Sub-1-gallon transaction | 0.04 gal, $0.20, LOVES #277 Prescott AR | red |
| Entered unit ≠ driver's assigned truck | `0` entered on card 9000005, JORDAN's assigned truck 072 | amber |
| Two fills too close in time or distance to be plausible | same site, 78 minutes apart | amber |
| Billed price materially above BVD's published price for that site and date | — (needs the price-file audit, A6.5) | red |
| DEF ratio well outside normal | 8.8% of diesel gallons against a ~3% norm | amber |
| Card with charges but no fuel | one card carried only a $15.25 scale charge | amber |

**"Entered unit ≠ driver's assigned truck" is a driver self-report, not a system guess — the mismatch is (almost) always the driver's, and the flag is the whole point, not a false positive to design away.** The unit number on a BVD invoice is exactly what the driver typed at the pump; two real causes cover most cases, both worth surfacing rather than suppressing:
- **Wrong number entirely** — e.g. IRIS MAE BENTLEY entered `3224` on a scale transaction, which is a trailer number, not a truck number. The entered value is simply not a unit at all.
- **A different truck that day** — a driver legitimately takes a truck that isn't their usual assignment (a repair swap, a borrowed unit). The flag then reads as a reminder ("this driver was in a different truck this day"), not an error.
A leading-zero-only difference (driver enters `50` for truck `050`) is the one shape that is *not* a real mismatch — same physical truck, just typed without the pad `unit_number` (D18) stores. The rule should treat that case as a match, not a flag.

Thresholds live in Settings, not in code constants.

---

## A11. Schema additions

Additive to v1 §12. Same rules: `uuid` for URL-exposed rows, composite natural keys for reference tables, `_raw` kept beside `_normalized`, parameters only (D1), and the descriptor + drift test (T-02 step 2.4) extended to cover every new table.

**Reference layer (shared by both halves)**

| Table | Notes |
|---|---|
| `drivers` | `uuid`, `display_name`, `status`. |
| `driver_aliases` | `(alias_normalized)` unique, → `driver_id`, `source`, `confirmed_at`. Invoice names are free text; this is the join. |
| `trucks` | `unit_number` **text** — see D18, which supersedes D6. → optional `truck_profile_id` from v1 §16. **Reconciles v1's `truck_profiles.truck_number` placeholder with the real roster** (031…1023). |
| `fuel_cards` | `card_number` unique, `supplier`, → `driver_id` (nullable, **permanent 1:1 — see D19**, not effective-dated), `status`. 27 active. |
| `truck_assignments` | `(driver_id, truck_id, effective_from, effective_to)`. **Effective-dated** — a truck reassignment (e.g. a repair swap) must not retroactively change how past transactions resolve. Supersedes the original `card_assignments` design (D19); the card/driver link moved to `fuel_cards.driver_id` because it doesn't share the truck's cadence of change. |

**Invoice layer**

| Table | Notes |
|---|---|
| `invoices` | `invoice_number` unique, `period_start`, `period_end` (both as BVD printed them), `billing_week_end` (D26 — defaults to `period_end`, movable), `actual_start`/`actual_end` (first and last transaction's UTC date, null for a file with none), `invoice_date`, `due_date`, `currency` (`USD`/`CAD`, D24), `qty_unit` (`gal`/`L`, D25), `grand_total` (in `currency`, as printed), `status` (`quarantined` / `imported`), `file_sha256` unique, `imported_at`. **One imported invoice per `(billing_week_end, currency)`** — a partial unique index on `status = 'imported'`, so a quarantined invoice (no rows, nothing to serve) never holds a week. |
| `invoice_totals` | Per product code as printed: `(invoice_id, product_code, qty, amount, discount, pre_tax_amount, hst, gst, pst, qst)`. `amount` is the Final AMT, tax included; `qty` is in the invoice's `qty_unit`. The reconciliation target. |
| `fuel_stops` | `uuid`, → `invoice_id`, `base_auth_code`, `occurred_at`, → `card_id`, resolved `truck_id` / `driver_id`, **`unit_raw`**, **`driver_name_raw`**, → `station_id`, `total` (in the invoice's currency), `receipt_status`. |
| `fuel_stop_lines` | `(fuel_stop_id, product_code, qty, retail_per_unit, billed_per_unit, amount, pre_tax_amount, hst, gst, pst, qst)`, all as printed (D25). 4dp prices stored as `numeric(9,4)`. **Never** derive the stop total by summing only diesel. |
| `express_charges` | `(invoice_id, express_code)`, `occurred_at`, nullable `truck_id` + `unit_raw` (D20), nullable `driver_id` + `driver_name_raw`, `amount`, `fee` (flat 3.00), `total`, `payee`, `note`, `category`, `match_status`. |
| `receipt_checks` | `(fuel_stop_id, checked_by, checked_at, outcome)` — append-only; the queue's audit trail. |
| `anomalies` | `(subject_type, subject_id, rule, severity, detail jsonb, detected_at, dismissed_at)`. Thresholds read from settings, never hard-coded. |
| `anomaly_thresholds` | Editable in Settings. |
| `invoice_rejections` | Mirrors v1's `import_rejections`: line number, auth code, reason code. Written on quarantine. |
| `plan_actual_matches` | `(plan_id, plan_stop_id nullable, fuel_stop_id nullable, kind)` where kind ∈ `matched` / `skipped_recommendation` / `unplanned_stop`, plus `delta_usd`. |

**Extensions to existing tables**

- `stations` — already carries `(supplier, site_ref)`, resolution tier and operator attrs from T-08/T-09. Invoice station text (`LOVES #294`, site 43673) resolves through the **same store-number parser** built in T-08 step 8.1. Do not write a second parser.
- `plans` — `dispatched_at` (T-19) is what Plan vs Actual matches against (A14). **T-38 amends "no new columns":** `truck_id uuid REFERENCES trucks(id)`, nullable, captured at `POST /plans` — see A14's truck-identity note below. Migration lands in `0003_actuals_schema.sql` as an `ALTER TABLE` (not `0001`), since `trucks` is an actuals-domain table and `0001` references nothing there.

---

## A12. Service boundaries

Extends v1 §13. `backend/src/api/` stays framework-free; nothing below performs I/O except the services marked as such.

```
backend/src/
  invoice/
    parseInvoiceXlsx.ts     pure: bytes -> rows + header metadata
    parseInvoicePdf.ts      pure: fallback path
    groupByAuthCode.ts      pure: lines -> stops
    reconcile.ts            pure: parsed rows vs printed totals -> balanced | imbalance report
    importInvoice.ts        service: hash, dedupe, stage, reconcile, promote or quarantine
  resolve/
    resolveDriver.ts        pure: raw name + alias table -> driver | unmatched
    resolveTruck.ts         pure: card + occurred_at + assignments -> truck; flags unit mismatch
  anomaly/
    rules/*.ts              pure, one file per A10 rule
    runAnomalies.ts         service
  actuals/
    transactions.ts  overview.ts  receipts.ts  otherCharges.ts
    drivers.ts  trucks.ts  stations.ts
  planActual/
    match.ts                pure: plan stops + fuel stops -> matches
    backtest.ts             service: re-solve historical invoices on archived price files
```

`importInvoice.ts` does **no HTTP, reads no argv, prints nothing** — same rule as v1's `ingestFile`, which is what lets the upload route, the CLI and a future Gmail poller all be thin wrappers.

---

## A13. API additions

Versioned under `/api/v1`, RFC 9457 errors, `?units=` honoured, numbers not strings, nulls preserved.

| Method & path | Notes |
|---|---|
| `POST /invoices/import` | multipart. Returns `imported` with a write preview, or **`quarantined` with the imbalance report and offending rows** — a 200 with a status, not a 4xx: quarantine is an answer, not an error. The report carries the invoice's `currency` and `qtyUnit`, its `billingWeekEnd` and actual range, and neutral money fields (`grandTotal`, `productTotals[].qty/amount/discount`). A second imported invoice of one currency for an occupied billing week is a 409, as is a byte-different file under a used invoice number. Duplicate `file_sha256` → 409 problem+json. |
| `GET /invoices` | List with the printed `periodStart`/`periodEnd`, `billingWeekEnd`, `actualStart`/`actualEnd`, `datesDiffer`, `grandTotal` in the invoice's `currency`, status and imported-at. Paginated. |
| `PATCH /invoices/{id}` | `{ billingWeekEnd }`, strict. Moves an invoice to another billing week (D26, the Import screen's override). A week another imported invoice of the same currency holds is a 409 problem+json; an unknown or non-uuid id is a 404. |
| `GET /periods` | Billing weeks, newest first: `{ weeks: [{ weekEnd, invoices: [{ id, invoiceNumber, currency, printedStart, printedEnd, actualStart, actualEnd, datesDiffer }] }] }`, USD before CAD, imported invoices only. `datesDiffer` when the printed range ≠ the actual range — an amber note, never a block. |
| `GET /invoices/{id}` | Header, printed totals, reconciliation result. |
| `GET /transactions` | Filters (`week`, `currency`, date range, driver, truck, card, state, product, receipt status, anomaly-only), sort (`occurred_at` or `total`), pagination. `week` is optional here — a driver's or truck's history spans weeks — and `currency` omitted means both sides, each row carrying its own `currency` and `qtyUnit`; lines carry the five tax columns beside `amount`. One row per stop; `lines[]` included on request. |
| `GET /transactions/{id}` | A8.4's payload, including `rawValues` and `resolvedFrom`. |
| `GET /overview?week=` | A8.1's KPI block + trend series + top-spend + anomaly digest, for the week's **US** invoice (T-65 shapes the CA and combined panels). Takes the week alone. |
| `GET /receipt-queue` · `POST /receipt-checks` · `POST /receipt-checks/batch` | Queue order, progress counts, one write per decision, append-only. The queue is a standing worklist across every week and both sides; optional `week` and `currency` narrow it and its `progress`. |
| `GET /express-charges?week=&currency=` | One invoice's express rows, oldest first, unpaginated. Each carries `matchStatus`, a null `driver` when unmatched (never a guess), and `payee`/`note`/`category` as stored. `totals` holds `amount`, `fee` and `total` separately, beside the `currency`. |
| `GET /drivers?week=&currency=` · `GET /trucks?week=&currency=` | Every roster driver/truck for one invoice — the week's invoice of that `currency`, default `USD` (D26) — spend descending. Each row: `stopCount`, `total`, `qty` (diesel/TA), `defQty`, `avgBilledPerUnit` (quantity-weighted, **`null` — not `0` — with no diesel quantity**), `defRatio` (DF÷TA gallons, `null` with no diesel gallons), `receiptCompliance` (`confirmed`, `total`, `pct` 0–100, `pct` `null` with no stops), `anomalyCount` (undismissed). A row with no stops is zeros, not omitted. Stops with no resolved driver/truck are not a row: they are the `unresolved` bucket, and `fleet` (= rows + `unresolved`) always reconciles. A week with no invoice on that side is `rows: []` and a zero `fleet`. **`GET /trucks` alone: `week` is optional (D23).** Omitted, it skips every invoice-scoped figure above and returns just `rows: [{ id, unitNumber }]` sorted by `unitNumber` — the plain roster listing for a picker (T-21's New Plan truck field, the Plans list's `Truck` column), which carries no week of its own (A7). |
| `GET /drivers/{id}?week=&currency=` · `GET /trucks/{id}?week=&currency=` | `summary` (the list row's figures), `fleet` (the whole invoice's quantity-weighted average — never a mean of driver averages) and `avgVsFleetPerUnit`, `favouredStations` (top 5 by stop count, then diesel gallons, then station name, then id; stops with no resolved station are counted in `unresolvedStationStops`, not ranked) and `history` (trailing 8 billing weeks of that currency: average, fleet average and compliance). Figures read the stored `fuel_stops.driver_id`/`truck_id`, so a stop dated before a reassignment stays with the old truck. **Truck detail** also returns `assignments` (every assignment of the truck, oldest first, with driver, the driver's card and inclusive `effectiveFrom`/`effectiveTo`) and `assignedCard`, the card of the assignment in force on `asOf` (the invoice's printed `period_end`). A driver/truck with no stops is zeros, not a 404; an unknown or non-uuid id is a 404 problem+json. Transaction history is `GET /transactions?driverId=`/`truckId=`. |
| `GET /stations/{id}/billed-prices` | `{id}` is `stations.id`, not `site_ref`. Not week-scoped: the whole series, one row per UTC day with diesel billed at the station, oldest first, in one currency — the station's own country's (`USD` per gallon for a US station, `CAD` per litre for a CA one) unless `?currency=` says otherwise. Each day: `stopCount`, `cardCount`, `qty`, `distinctBilledPrices` (ascending — one entry across several cards *is* A6.5's finding), `avgBilledPerUnit`, `publishedPerUnit` and `discrepancy` (highest billed price minus the published `your_price`, signed, per unit; **`null`, not `0`, when `station_prices` has no row for that station and day, and always on a CA station, which has none** — A18 Q5), and `severity` (`red`, else `null`) when a price that day exceeds the published one by more than `anomaly_thresholds.price_above_published.maxOverageUsdPerGal`. Unknown or non-uuid id is a 404 problem+json. |
| `GET /plan-actual?week=` · `GET /plan-actual/backtest?from=&to=` | A14. Live matching is **US-only** (plans are): the week's USD invoice, no `currency`. |
| `GET /settings/assignments` · `PUT` · `GET /settings/aliases` · `PUT` · `GET/PUT /settings/thresholds` | Effective-dated writes. |

Every money field carries its invoice's `currency` — `"USD"` or `"CAD"` (D24) — on the object that holds it or an ancestor; a figure combined across both carries the currency it was converted into (D27). **No response field name contains `Usd`** (Plan screens' own USD-by-construction fields aside): money drops the suffix, quantities and per-unit prices drop `Gal`, and every Actuals result carries `qtyUnit` beside `currency`. **Period-scoped routes take `?week=` (a billing week's end, D26), `?currency=USD|CAD` where a screen shows one side, and `?units=imperial|metric`**, which converts quantity and per-unit price at the API and never money (D25); a missing or malformed `week` and an unknown `currency` or `units` are 400s. Free-form anomaly `detail` is normalised to the same names on the way out. See `UI-DATA-CONTRACT.md` §9. Every resolved field ships beside its raw twin: `{ "truck": {"resolved": "072", "raw": "0", "agrees": false} }`.

---

## A14. Plan vs Actual matching

**Match against dispatched plans only** (`plans.dispatched_at IS NOT NULL`, written by T-19). Matching against every exploratory plan a dispatcher computed and discarded would manufacture false mismatches — this is the payoff v1 T-19 was scheduled for.

Matching key: **truck + date window + station**. A recommended stop with no fuel stop within the window is a `skipped_recommendation`; a fuel stop with no recommendation is an `unplanned_stop`; both are first-class rows, not omissions. `delta_usd` on a matched pair is `(actual billed − planned expected) × actual gallons`.

**Historical backtest** needs no plan: re-solve a past invoice's lane against the archived price file for that date and diff. This is the only part of the actuals half that can use the full ten-year history immediately, and it reuses `dp_v1` (T-12) unchanged — which is exactly why the optimiser is pure.

Exclusions are named, not hidden: split fills with no single planned stop to match, station text that resolves to no listed site, and dates with no archived price file. The design file lists all three.

**Decided, T-38 — the truck-identity gap.** `plans.truck_profile_id` names an abstract fuel-planning class (one of three seeded profiles, e.g. "Volvo VNL 860") — not one of the 27 real units in `trucks`. With only 3 classes across 27 trucks, matching on class alone ties roughly 9 real trucks together per class, which is not a workable "truck" key. **`plans.truck_id uuid REFERENCES trucks(id)`** (nullable) closes this — captured at `POST /plans`, where the dispatcher picks the specific unit the plan is for (not just at dispatch time: a future model that solves off a real truck's measured mpg needs the unit known at solve time, not only at dispatch). A plan naming no truck (`truck_id IS NULL`) is simply never matched — it never enters A14's pool at all, which is distinct from all three named exclusion classes above.

**Decided, T-38 — date window.** Same UTC day. `plan_stops` carries no timestamp of its own (§12), so a dispatched plan's `dispatched_at` day is the window every one of its stops is checked against on the actual side (`fuel_stops.occurred_at`'s day, same UTC-day comparison). Where two actual fuel stops land in one plan stop's window, the one nearest in time to `dispatched_at` wins as `matched`; the other becomes `unplanned_stop`.

**Decided, T-38 — plan adherence and by-truck variance** (named in A8.10, no formula given there — and no design file to read one off, at the time). Adherence = `matched / (matched + skipped_recommendation) × 100` over the period, `null` with no dispatched recommendation in it at all. By-truck variance = `Σ delta_usd` on `matched` rows, grouped by the truck the matched plan named. `GET /plan-actual`'s `byTruckVarianceUsd` ships this today as `{ truckId, unitNumber, varianceUsd }` per truck.

**By-truck breakdown, enriched to match `CH Fuel App.dc.html` (received after T-38 shipped, closed as a follow-up before T-21).** The design's live-performance "By truck" table needed more per truck than T-38's original shape carried. `byTruckVarianceUsd` now ships `stopCount`, `plannedUsd`, `actualUsd`, `varianceUsd` and a **per-truck `adherencePct`** — the same `matched / (matched + skipped_recommendation) × 100` formula as the top-level figure, applied per truck; `0`, not omitted, for a truck with only skipped recommendations. `MatchRow` itself grew `plannedUsd`/`actualUsd` alongside `deltaUsd` on `matched` rows to make this possible without a second query. **Still outstanding for T-46:** the design's "Needs review" ranking (biggest per-stop overages, e.g. "Fuelled #766 at 5.8738 — plan said #313 at 5.5208") needs station names on top of the dollar figures `MatchRow` now carries — a join T-46 still needs to add. The match key, exclusion classes and top-level KPIs (`moneyLeftOnTableUsd` = "Left on the table", `adherencePct` = "Plan adherence") already matched the design exactly from T-38, confirmed 1:1 down to the worked example (10 of 14 stops used → 71%).

---

## A15. Decisions locked for v2

| # | Decision | Rationale |
|---|---|---|
| **D11** | **One repository, one deployment.** The merged app ships from `CH-Fuel-Planner`; no second service. | The shared reference layer is a join, not an integration. Two services would need it in both. |
| **D12** | **Quarantine is a persisted invoice row with `status='quarantined'` and zero child rows.** | The user must be able to come back to it. A toast loses the imbalance report. |
| **D13** | **The emailed PDF is the primary import path; the portal CSV is the lesser one. Supersedes both the earlier "Excel" framing and the later "CSV primary, PDF fallback" one.** BVD issues two exports of the same invoice and the PDF is a strict superset: it prints the invoice's own header table (number, invoice date, period start/end, due date) and the Express Codes section's `TRACTOR`, `TRAILER`, `DRIVER NAME/ID`, `CDL` and `TRIP #` columns. The CSV has none of that — it opens straight into `Fuel Card Transactions`, and its express section is nine columns. Both are parsed and both reconcile; a CSV import simply cannot attribute an express charge to a truck or driver, and has its header derived from the filename and its own transaction dates. | Measured against the real 999210 in both formats: identical on every fuel line and every money field, and the CSV's derived header comes out identical to the PDF's printed one. The earlier framing had it backwards, and cost the express tractor/driver data. |
| **D14** | **Resolution happens at import, stored, not computed per query.** Raw text is kept forever. | An assignment edit must re-resolve deliberately (a job), not silently change history on next read. |
| **D15** | **Sidebar IA replaces the tab bar.** | Eleven destinations across three groups; tabs stopped scaling at four. Supersedes parts of T-04/T-21/T-23. |
| **D16** | **Anomaly thresholds are data, not constants.** | Every threshold in A10 is a guess until real history is loaded. |
| **D17** | **The Receipt Queue is built as an exceptions queue from day one.** | A18 Q3 may automate the check; the layout must not assume every item needs a decision. |
| **D18** | **`unit_number` is `text`, stored exactly as the fleet writes it. Supersedes D6.** | D6 chose `integer` with a three-digit display pad on the evidence of `022`-style numbers. The real roster (A19) runs `031`…`073` **and** `101`, `1012`…`1023`. A three-digit pad cannot render a four-digit unit, and `integer` loses the leading zero that distinguishes `031` from `31` on the invoice. `formatUnitNumber()` survives as a validator and normaliser, not a padder. |
| **D19** | **`fuel_cards.driver_id` is a permanent, direct link — not effective-dated.** A separate `truck_assignments(driver_id, truck_id, effective_from, effective_to)` carries the history that actually changes. | Cards are issued one-to-one to a driver and never reassigned; a lost card becomes a new `card_number`, not a repointed `driver_id`. Trucks are what occasionally change (a repair swap), so that's the relationship that needs a date range. Bundling both into one `card_assignments` row (the original A11 design) would have forced a full new row — repeating the unchanged card/driver link — every time dispatch moved a driver to a different truck. |
| **D20** | **`express_charges.truck_id` and `unit_raw` are nullable. Supersedes the original A11 design, which had `truck_id NOT NULL`, and corrects the reason first given for it.** | The original reason was wrong: 999210 was said to have Express Codes rows with no tractor text, but it does not — that was an artifact of the hand-built fixture leaving blank the two rows A19's table happened to omit. Every real express row carries a tractor. The nullability stands for a better reason: **the CSV export has no tractor column at all**, so every express row imported from a CSV legitimately has a null `truck_id`/`unit_raw`. That is a property of the file, not a resolution failure. What is genuinely blank on a real invoice is the *driver* (one row of six), and `driver_id`/`driver_name_raw` were already nullable for it. A unit number that *is* present but unrecognised still quarantines (`UNKNOWN_TRUCK_UNIT`) — a real data problem, unlike an absent column. |
| **D21** | **Migrations are grouped by domain, and may be edited (squashed) until the first deploy; from the first deploy they are append-only. Supersedes A16's "never edit an applied migration" for the pre-deploy period.** | Ten migrations had accumulated in which later files undid or corrected earlier ones (0006 dropped a NOT NULL that 0009 then explained away; 0007–0009 added an index and columns; 0010 renamed and retyped nine distance columns). Nothing is deployed, so there is no database whose history must be preserved; T-02 made the same call for `0001`. The layout is one schema file and one seed file per domain, planning first (nothing in planning references actuals; actuals reference `users`, `truck_profiles`, `stations`, `plans`, `plan_stops`), and required config is kept apart from replaceable roster data: `0001_planning_schema` · `0002_planning_seed` · `0003_actuals_schema` · `0004_actuals_config_seed` · `0005_fleet_roster_seed`. **Freeze point: the first deploy (T-49 — T-24 folds into it and ships no deploy of its own, decided below).** From then on `schema_migrations` on a real database records these filenames, and any change is a new numbered file — ALTER, never an edit. |
| **D22** | **`plans.truck_id uuid REFERENCES trucks(id)`, nullable, captured at `POST /plans`. Amends A11's "plans — no new columns."** | A14's match key is truck + date window + station, and until T-38 there was no path from a dispatched plan to one of the 27 real fleet units: `plans.truck_profile_id` names an abstract mpg/tank class (3 seeded profiles), and `trucks.truck_profile_id` — the column that would bridge class back to a real unit — is nullable and never populated by the T-25 roster seed. With only 3 classes across 27 trucks, matching on class alone ties roughly 9 real trucks together per class. The column is captured at creation, not at dispatch (`PATCH /plans/{id}`, T-19's `.strict()` body), because a future model that prices off a real truck's own measured mpg needs the unit known before the lane is even solved, not only once it is dispatched. |
| **D23** | **`GET /trucks`'s `period` query param becomes optional, not a second endpoint.** Omitted, it returns the plain roster (`id`, `unitNumber`, sorted by `unitNumber`) with no invoice/spend data; supplied, T-37's existing spend-scoped analytics shape (A13) is unchanged. | D22 gave plans a real truck, but nothing serves a picker for it: `GET /trucks` (T-37) 400s with no `period`, and Plan screens carry no period at all (A7 — they show their own price-sheet date instead). T-21's New Plan truck field, and the Plans list's `Truck` column (both present in `CH Fuel App.dc.html`), need exactly the unscoped listing this makes `period`'s absence mean, rather than a same-named endpoint at a different path. |
| **D24** | **BVD bills Canadian fuel on its own invoice, in CAD per litre, with sales tax inside the billed price. Answers A18 Q2.** Each invoice is single-currency: `CUR` reads `US` or **`CN`** (not `CA`/`CAD`) on every row, and an invoice whose rows mix the two is rejected, never split. | Measured against the real CA invoice **999217** (PDF): 60 lines, 59 fuel stops, 34 cards, 9 Ontario sites, `CUR` = `CN` on every row. `QTY` is litres, `Retail`/`Billed` are CAD per litre, and the billed price **includes 13% HST**: QTY × Billed ≈ Final AMT (318.62 × 2.2427 = 714.57 on this line; across both real invoices it holds only within the rounding bound of the 2dp QTY and 4dp price — T-61) and Pre Tax AMT + HST = Final AMT exactly (632.36 + 82.21). Grand total CAD 46,837.33. A US invoice's tax columns are all zero, so the same parser shape serves both. |
| **D25** | **Invoice quantities and money are stored as BVD printed them — litres and CAD on a CA invoice — beside a `qty_unit` and `currency`, and converted only at the API. A deliberate exception to "storage is miles and gallons", scoped to invoice volumes and money; distances are untouched.** | The same reasoning as "`YOUR PRICE` is read, never recomputed": converting at import turns 2.1522 CAD/L into a recomputed 8.1470…/gal and breaks the exact QTY × Billed = Final AMT invariant reconciliation (T-28) depends on. The API — already one of CLAUDE.md's four conversion edges — converts for the units toggle and for any cross-invoice total. Every gallon-denominated threshold (the sub-gallon rule) compares in gallons after converting at the rule's input, not by storing gallons. |
| **D26** | **A "period" is a billing week keyed on the invoice's printed period end (`billing_week_end`), defaulted at import and overridable per invoice on the Import screen. Supersedes keying periods on `period_start`.** The printed start/end are stored as printed; the actual range is the first and last transaction date. A disagreement is an amber note, never a block. **One imported invoice per currency per week** — a quarantined invoice does not claim a week. | 999210 (US) and 999217 (CA) share period end 2026-09-09, invoice date 09-10 and due date 09-11, but 999217 prints a start of **2026-08-01** while its transactions run 09-03 → 09-10 00:45:19 — a start-keyed period would never pair them. The UI labels a week "Week ending Sep 9, 2026" and lists the invoices in it, so it never has to choose whose start date to print. Grouping by transaction date was rejected: combined KPIs would stop reconciling to what BVD billed. |
| **D27** | **US and CA figures are combined in USD at an exchange rate the dispatcher enters for each CA invoice** — CAD per 1 USD, entered on the Overview for the selected week (or with the import CLI's `--fx-rate`), stored on the invoice with when it was entered, and correctable. A missing rate shows "rate pending" with a way to enter it; it is never assumed to be 1.0. *(Amended 2026-10-06: was the Bank of Canada's `FXUSDCAD` rate for the invoice date, fetched at import.)* | The invoice prints no exchange rate, and the rate that matters is the one the company actually settled at, which the dispatcher knows and a published daily rate does not. Entering it also removes the only external call at import. Nothing converted is stored, so a corrected rate re-converts every figure on its next read. CAD is available as an alternate display currency for the combined panel. |
| **D28** | **Canadian sales tax is shown three ways — before tax, tax, with tax — on spend and on per-litre rates.** The tax figure is HST + GST + PST + QST (labelled "HST" when only HST is non-zero, "Sales tax" otherwise); the four stay separate in transaction detail. US figures show one value, because US fuel tax is inside the pump price; a combined figure is labelled "before HST", never "pre-tax". | The HST is printed and registered (HST# on the invoice), so it is recoverable for the business and must be separable; both views are wanted. |
| **D29** | **Canadian stations come from BVD's travel-centre directory (`data/US-CA-GasStations/bvd-travel-centres-*.csv`, committed like the Love's export), loaded by the same operator-export code, and are actuals-only: the v1 planner filters to `country = 'US'`.** `data/loves/` is renamed `data/US-CA-GasStations/`. | The directory's `Site #` is the invoice's `Site #` (58156 = BVD Comber on both): all 9 sites on 999217 are in it, and none of its 91 site numbers collides with a US price-sheet `SITE`. CA stations have no price-sheet row, so the corridor query's `LEFT JOIN LATERAL` would otherwise name border stations (Sarnia, Windsor, Niagara) as "no price" exclusions on US routes. The directory carries no prices. |
| **D30** | **A CA invoice imports from the PDF only, until a real CA portal CSV has been seen.** The CSV parser rejects a `CN` row with a named reason rather than parsing an unverified shape. | D13 already prefers the PDF; the CSV's derived period (from transaction dates) would disagree with 999217's printed Aug 1 start, so the CSV-equals-PDF check cannot be assumed to hold for CA. |

---

## A16. Amendments to v1 tickets

These are edits to already-specified v1 tickets, not new tickets. Apply them when the ticket is picked up.

- **T-02 (done)** — schema additions in A11 landed as new migrations (`0003_actuals.sql` …) rather than edits to `0001_init.sql`, which had applied. **Superseded by D21 (T-53):** the ten migrations were squashed into five by domain before any deploy; the never-edit rule now starts at the first deploy. The descriptor and drift test extend to every new table.
- **T-03 (done)** — `truck_profiles.truck_number` placeholders (022/056/091) are superseded by the real roster in `trucks` (A11). Keep the profiles; stop treating their unit numbers as the roster.
- **T-01 (done) — `formatUnitNumber()` changes contract under D18.** It was a three-digit zero-pad over an `integer`; it becomes a normaliser over `text` that preserves the stored string and rejects anything that is not 3–4 digits. Every call site is display-only, so this is a function body plus a test table, not a migration. **Do this inside T-25**, before any truck row exists — the 27-unit seed in step 25.4 is the first thing that would enshrine the wrong format.
- **T-18** — `GET /health` gains latest-invoice-period alongside latest-sheet-date.
- **T-21 / T-22 / T-23 — build against the existing v1 tab bar, not a sidebar.**
  **Corrects an earlier version of this note, which told T-21/T-23 to build the
  sidebar shell directly — that duplicates T-39, a dedicated later ticket that
  depends on T-21 finishing first.** These three tickets bring the Plan tab,
  map and Recent tab fully to real data inside whatever shell already exists
  (T-04's tab bar); T-39 alone builds A7's sidebar (D15) and re-hosts the
  finished screens into it afterward, unchanged — its own DoD says so
  explicitly ("the v1 Plan and Plans screens mount inside the shell with
  their v1 behaviour intact"). Building the sidebar twice would be wasted,
  conflicting work. The `CH Fuel App.dc.html` design file's Plan and Plans
  screens are the reference for T-21/T-22/T-23's *content*; its shell chrome
  (`Sidebar.tsx`/`TopBar.tsx`) is T-39's alone to build.
  **T-21 also picks up a second correction:** its truck selector was scoped
  against `truck_profiles` ("zero-padded per D6") before either D18 or the
  real fleet roster (`trucks`, T-25) existed. It must instead select from
  `trucks` and set the new `plans.truck_id` (T-38/D22) — see A14's
  truck-identity note and `UI-DATA-CONTRACT.md` §2 for the corrected contract,
  and D23 below for the endpoint it needs.
- **T-19** — unchanged in code, but now load-bearing: it is the input to A14.
- **T-24 — decided (2026-09-24): folds into T-49, ships no deploy of its own.**
  As scoped, T-24 had no dependency on T-39, so it could have deployed the
  pre-redesign tab-bar UI to production only for T-49 to replace it with the
  sidebar almost immediately after — this note used to pose that as an open
  question, but the answer is no standalone v1 deploy milestone. T-24's
  actual content (Vercel + Neon setup, the invoice-import path in the
  runbook, still no cron since T-20 is deferred) ships as part of T-49
  instead; T-49's own `vercel.json` file entry already covers it. Its DoD
  checklist in `TICKETS.md` still asserted a daily retention cron; corrected
  there to match this note, which already had it right.

---

## A17. Non-goals

- No customer, contact or deal management. This is not a CRM despite early framing.
- No invoice payment or accounting integration.
- No driver login.
- No claims of truck-legal routing. The `GOOGLE_LINK_NOT_TRUCK_LEGAL` disclaimer (T-17) stays.
- The public marketing website is a separate product.
- No multi-tenancy, no roles matrix, no virtualised million-row grids.

---

## A18. Open questions

Flagged, not solved. Each names what it blocks.

| # | Question | Blocks |
|---|---|---|
| **Q1** | Does truck odometer data become available (Samsara or TransPlus)? If yes, **cost per mile becomes a headline metric** and the Trucks screen changes shape. | A8.8's final layout |
| **Q2** | ~~Is the company billed USD and converted by the bank, or billed CAD by BVD?~~ **Answered — D24:** both. US fuel on a USD invoice, Canadian fuel on a separate CAD invoice (`CN`) for the same week; combined in USD per D27. No top-bar currency toggle: the week selector lists both invoices (D26). | — |
| **Q3** | Does Samsara's API expose driver receipt uploads? If yes the Receipt Queue becomes an exceptions queue. | A8.5 scope (D17 hedges it) |
| **Q4** | Does a future unified operations dashboard (TransPlus, Samsara, BorderConnect, Motive) absorb this app as a section? | Shell's tolerance for a larger nav (A7) |
| **Q5** | Is BVD's published price file obtainable as a file, or only as the invoice? Decides whether the A6.5 price audit is real or aspirational. | A10's "billed above published" rule |
| **Q6** | Ten years of Gmail invoices — do older years differ in shape? **Partly answered:** 21 invoices across 2026 (`961112`…`999217`) are all the same shape in both exports, and both are now parsed. (Same column shape; `999217` is a CA invoice — `CN`, litres, CAD — which the PDF parser accepts since T-61, D24. The CSV parser refuses a CA invoice until a real CA portal CSV is seen, D30.) Whether invoices from earlier years hold that shape is still open, and T-48's backfill is what will find out — it reports a parse rejection per file rather than stopping the run. | T-48 sizing |

---

## A19. Reference data for fixtures

Use these values instead of placeholders. Names and card numbers are synthetic
placeholders for the real fleet roster (T-58's history scrub, before the repo
went public) — the pairing, the shared-truck scenarios and the deliberate
bad-unit rows are real and preserved exactly; only the labels changed. The
real values, for local use, live in the gitignored `data/bvd-invoices/real-roster.sql`
(`npm run seed:real-roster`).

**Drivers** JORDAN · TAYLOR · HARPER LANE · MORGAN · CASEY · ROBIN CROSS · DANA FOX · ELLIS PARK · SAGE MOORE · TATUM REED · KIT BARNES · LOU FIELD · BLAKE HALE · WREN OTIS · IVY CRANE · RILEY · ARDEN LEE SHAW · QUINN · NILE BOND · RORY VANCE · TESS KANE · FINN GRAY · IRIS MAE BENTLEY · NOVA REESE · AVERY · DREW · SAWYER

**Cards** 9000001 · 9000002 · 9000003 · 9000004 · 9000005 · 9000006 · 9000007 · 9000008 · 9000009 · 9000010 · 9000011 · 9000012 · 9000013 · 9000014 · 9000015 · 9000016 · 9000017 · 9000018 · 9000019 · 9000020 · 9000021 · 9000022 · 9000023 · 9000024 · 9000025 · 9000026 · 9000027

**Units** 031 · 039 · 041 · 044 · 047 · 050 · 051 · 052 · 057 · 061 · 063 · 064 · 065 · 066 · 069 · 070 · 071 · 072 · 073 · 101 · 1012 · 1013 · 1016 · 1017 · 1019 · 1022 · 1023

**Stations** LOVES #294 Dallas TX (43673) · #313 Matthews MO (25334) · #833 Ripley NY (21186) · #341 Rolla MO (25919) · #688 Greenup IL (38070) · #883 Rural Hall NC (8279) · #275 Palestine AR (4150) · #884 Prescott AR (21236) · #456 Perrysburg OH (35193) · #731 Slippery Rock PA (36085) · #820 Waterloo NY (12198) · #518 Springville UT (45046) · #769 Topeka KS (19096)

**Sample stops**

| Date/time | Driver | Card | Station | Gal | Retail | Billed | Total |
|---|---|---|---|---|---|---|---|
| 2026-09-09 00:41 | JORDAN | 9000005 | LOVES #294, Dallas TX | 40.00 | 5.799 | 5.499 | $219.96 |
| 2026-09-03 11:39 | TAYLOR | 9000019 | LOVES #307, Jackson GA | 200.00 | 5.899 | 5.699 | $1,139.80 |
| 2026-09-07 19:45 | ROBIN CROSS | 9000012 | LOVES #738, Sulphur Springs TX | 150.00 | 6.099 | 5.199 | $779.85 |
| 2026-09-09 04:22 | LOU FIELD | 9000006 | LOVES #766, Atkinson IL | 170.00 | 6.299 | 5.899 | $1,002.83 |
| 2026-09-03 05:35 | JORDAN | 9000005 | LOVES #277, Prescott AR | 0.04 | 5.999 | 5.599 | $0.22 |

**Worked stop expansion** — auth `A900000001`, JORDAN, card 9000005, unit 072, 2026-09-09 00:41:38, LOVES #294 (site 43673) Dallas TX:

```
  TA  Diesel   40.00 gal   retail 5.799   billed 5.499   $219.96
  DF  DEF       3.00 gal   retail 6.200   billed 6.100    $18.30
                                           Stop total    $238.26
```

**Sample express codes** — all six rows of 999210, read off the emailed PDF (driver names synthetic; codes, tractors, dates and amounts real).

| Date | Code | Auth code | Tractor | Driver | Amount | Fee | Total | Payee |
|---|---|---|---|---|---|---|---|---|
| 2026-09-03 06:57 | 6551741 | E246250570 | 066 | Denver | $110.00 | $3.00 | $113.00 | lumper fees |
| 2026-09-03 08:29 | 6552061 | E246305630 | 1019 | Finn | $240.35 | $3.00 | $243.35 | Lumper |
| 2026-09-08 07:43 | 6570949 | E251277960 | 064 | Iris | $457.60 | $3.00 | $460.60 | Lumper |
| 2026-09-08 10:12 | 6571780 | E251367270 | 073 | *(blank)* | $200.00 | $3.00 | $203.00 | lumper |
| 2026-09-08 11:19 | 6572226 | E251407700 | 044 | Drew | $455.00 | $3.00 | $458.00 | lumper |
| 2026-09-08 18:48 | 6574941 | E251677300 | 1017 | sutton | $62.18 | $3.00 | $65.18 | repair |

**Every row carries a tractor; only the *driver* is ever blank** (one row of six). An earlier version of this table listed four of the six, and the fixture built from it left tractor and driver blank on the two it omitted — which is where D20's original "two blank-tractor rows" claim came from. There are none.

`Denver` and `sutton` are not on the driver roster above: express driver text is free-form and does not always name someone on the fleet, which is why unmatched stays unmatched (A8.6).

The auth code is BVD's own reference for the express authorisation. It is `E`-prefixed and shares no namespace with a fuel stop's `A`-prefixed auth code, so it cannot be joined back to `fuel_stops` to inherit a truck or driver.
