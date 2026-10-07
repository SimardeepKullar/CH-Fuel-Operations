# CH Fuel Planner

A dispatcher enters a load — origin, destination, truck — and gets back a truck-legal route, the cheapest diesel stops along it under a hard 500-mile leg cap, and a Google Maps link to send the driver. One supplier (BVD), one product (ULSD), US only, single user.

**Org:** 2043733 ONTARIO INC., DBA CH LOGISTICS.

---

## Documents, in authority order

When two disagree, the higher one wins and the lower one gets edited.

1. **`migrations/*.sql`** — authoritative for schema. If it disagrees with the scope's §12, the migration is right and §12 gets edited.
2. **`docs/PROJECT-SCOPE.md`** — the specification (v1, fuel planner, §-numbered). **`docs/PROJECT-SCOPE-v2.md`** extends it (v2, actuals/reconciliation, A-numbered) — where the two disagree, v2 wins and v1 gets edited.
3. **`docs/TICKETS.md`** — ticket register for T-01–T-24. **`docs/TICKETS-v2.md`** continues it from T-25 onward and is the current source of truth for what's built — see its ticket index rather than hand-tracking status elsewhere.
4. **`docs/BUILD-PLAN.md`** / **`docs/BUILD-PLAN-v2.md`** — per-ticket steps with test plans, split the same way (T-01–T-24 / T-25+). Work from these.
5. **`docs/UI-DATA-CONTRACT.md`** — what the frontend needs that §14 does not yet return.
6. **`docs/HANDOFF-PROMPT.md`** — the bootstrap prompt for a fresh session; read it first when picking this project back up cold.
7. **This file** — workflow and conventions only. Never duplicate spec content here.

The scope marks claims as **Verified** (measured against `data/`), **Decided** (a choice with a reason), or **Open** (§21 in v1, §A18 in v2). Do not treat an Open item as settled, and do not re-litigate a Decided one without saying why.

---

## Stack

Node 22 · TypeScript · Next.js (frontend + API mount) · Postgres 16 + PostGIS · raw `pg`, **no ORM or query builder** · Zod · vitest · MapLibre GL JS · OpenRouteService.

Two workspaces: `backend/` (`@ch/core`, framework-free) and `frontend/` (Next.js, the Vercel root directory).

---

## Commands

```bash
npm run db:up          # docker compose up -d      (Postgres+PostGIS on :5433)
npm run db:migrate     # apply migrations/*.sql via the runner, idempotent
npm run db:reset       # down -v && up -d && migrate  — destroys local data
npm run seed           # truck profiles, product code, dispatcher account
npm run db:migrate:real  # optional: apply migrations/real instead of migrations/synthetic
                          # (local only — migrations/real is gitignored)

npm run typecheck
npm run lint
npm run test:unit      # no database required
npm test               # full suite, needs a live database
npm run verify         # typecheck && lint && test — the gate

npm run dev            # Next dev server
npm run ingest -- ./data/bvd-prices/pcn-usd-9206810-981.csv
npm run backfill -- ./data/bvd-prices/2026-01/
```

Migrations apply **only** through the runner. `docker-compose.yml` deliberately does not mount `migrations/` as init scripts — that path fires only on an empty volume and has no Neon equivalent.

Migrations are grouped by domain (planning, actuals), schema apart from seed, and may be squashed **until the first deploy** (D21). From the first deploy they are append-only: a change is a new numbered file, never an edit.

`migrations/` itself has two mirrored subdirectories, not a flat file list: `migrations/synthetic/` (committed — what the runner applies by default, and all of CI) and `migrations/real/` (gitignored — file-for-file identical except `0005`, which carries the real fleet roster instead of a synthetic stand-in). See Data on disk, below.

---

## Workflow: one branch per ticket

One ticket = one branch = one squashed commit on `main`. `main` history then reads as the ticket register, and every commit on it is a state CI verified.

```bash
git checkout main && git pull
git checkout -b ticket/T-01-toolchain

# implement BUILD-PLAN steps one at a time, committing per step
npm run verify

git push -u origin ticket/T-01-toolchain
gh pr create --fill
# CI green, then:
gh pr merge --squash --delete-branch
git checkout main && git pull
```

**Branch names:** `ticket/T-<NN>-<short-slug>` — `ticket/T-06-ingest-service`.

**Commits on the branch:** conventional, scoped to the ticket. Small and per-step is fine; they get squashed.

```
feat(T-06): parse BVD metadata row and header
test(T-06): assert 605 rows and 2026-08-22 effective date
fix(T-06): reject unmapped PROD instead of defaulting
```

**The squash commit** is what lands on `main`. Title it with the ticket: `T-06 · Ingest service and npm run ingest (#12)`.

**Do not start the next ticket until the current one is merged.** The dependency graph in `TICKETS.md` assumes each ticket builds on merged work, not on a sibling branch.

### A ticket is done when

- Every step's tests in `BUILD-PLAN.md` pass.
- The ticket's definition of done in `TICKETS.md` is fully met — not partly.
- `npm run verify` is green from a clean checkout.
- CI is green on the PR.

If a step cannot be finished, say so and leave it out explicitly. Do not narrow a ticket silently.

---

## Testing rules

- Tests are co-located as `*.test.ts` beside the unit. Anything needing a database goes in `backend/test/integration/` and skips when `DATABASE_URL` is unset.
- **Optimiser strategies are pure** — no database, no HTTP, no clock. Their whole suite must run with no container and no network.
- Provider tests run offline from recorded fixtures in `backend/test/fixtures/ors/`, committed with ODbL attribution.
- Invoice fixtures in `backend/test/fixtures/invoices/` are synthetic only, committed regardless of repo visibility. A real BVD invoice belongs in gitignored `data/bvd-invoices/` instead; tests asserting its exact figures check for the file there and skip automatically when it's absent, the same way `DATABASE_URL`-gated integration tests do. Every PDF there is rendered by `generateSamplePdf.ts` from invented data, never copied from a real invoice: `sample-redacted.pdf` (the same invoice as `sample-redacted.csv`), `sample-ca.pdf`, and one `edge-*.pdf` per failure mode. All subtotals and totals are derived from the printed rows. The samples reproduce the real layout (T-50) — a local-only test compares their masked line shapes against `data/bvd-invoices/`, printing kinds and shapes only, never a value. Regenerate after any generator change (`npx tsx test/fixtures/invoices/generateSamplePdf.ts`); a byte-for-byte test fails otherwise.
- **BVD price sheets follow the same two-block pattern.** The real sheets in `data/bvd-prices/` are gitignored. `backend/test/fixtures/bvd-prices/` holds small hand-written synthetic CSVs that CI runs: `sample.csv` (a clean baseline — capped-at-retail rows, `SITE` ≠ store number, ambiguous city/state pairs, the one store the operator export cannot place) and one file per failure mode (`edge-rejections`, `edge-format`, `edge-bad-header`, `edge-missing-effective-date`, `edge-short-row`). Each test file that used the real sheets has a synthetic block that always runs and a separate `describe.skipIf(!hasRealData)` block that asserts the real figures and runs only where `data/bvd-prices/` exists — so on the dev machine both run, and in CI only the synthetic one does. Multi-day scenarios (gaps, byte-identical `(1)` duplicates) are composed in a temp directory from `sample.csv`, re-dated, as `backfillInvoices.test.ts` does; nothing multi-file is committed. Read files inside `it`, never at `describe` level — a skipped suite's factory still runs, so a describe-level read of a missing file breaks collection. Build CRLF cases in the test rather than committing them: `core.autocrlf` rewrites committed CSVs, and a fixture edited by splitting on `\n` breaks on a CRLF checkout.
- "Pass" means an assertion, not an eyeball — except the one visual check in T-04 step 4.2.
- Write the test before the fix for any bug found mid-ticket.

---

## Rules that are easy to get wrong

Each of these is a silent-corruption bug, not a crash. They are scattered across 1,700 lines of scope; they are collected here because they will not announce themselves.

**Prices and ingest**
- `YOUR PRICE` is **read, never recomputed.** `min(TOTAL COST, RETAIL PRICE)` is a BVD business rule only they can apply. Validate the invariant; store their number.
- **Trust the CSV header's effective date directly. No `+1` offset logic.** The file arrives on day *N* stating day *N+1* and the header is already correct.
- An **unmapped `PROD` fails the row.** Never default-mapped, never guessed. That guard is the entire reason `product_codes` exists.
- Rejected rows are quarantined with a reason code — never dropped.
- `city_raw` is never overwritten; `city_normalized` is a separate column for matching.
- Do not "correct" `CH LOGISTIX` to `CH LOGISTICS`. It is what the supplier sends; the ingest records what arrived.
- The store number comes from `NAME` (`LOVES #368` → 368), **never from `SITE`** — `SITE` matches the store number in 0 of 605 rows.

**Invoices: two exports, two shapes**
- BVD issues the same invoice twice — an **emailed PDF** and a **portal CSV** — and they are *not* the same shape. **Never reshape one to look like the other.** A fixture built that way is what made this a rule.
- The **PDF is the fuller** export (D13). It prints the invoice's header table, and it alone carries `TRACTOR`, `TRAILER`, `DRIVER NAME/ID`, `CDL` and `TRIP #` on express rows. Prefer it.
- The **CSV names the invoice nowhere in its contents** — the number comes from the filename (`invoice_999210.csv`), the period from its own transaction dates, and invoice/due date from period end +1/+2. Verified against the PDF's printed values, not assumed.
- A CSV import leaves every express row's `unit_raw`/`driver_name_raw` null. That is the file lacking a column, **not** a resolution miss. On a real PDF invoice every express row has a tractor; only the *driver* is ever blank.
- The PDF's tables are drawn with fills, not ruled lines, so `pdf-parse`'s table extraction finds nothing. Rows are read off the text layer by anchoring on shapes that cannot collide and walking inward — see `parseInvoicePdf.ts`. It prints money with thousands separators; strip them at that boundary, never by loosening `toDecimalString`.
- Because rows are read by position, **each table's printed column header is checked** (T-50): a line opening like a header must match it exactly, and a row before its table's header fails the file. Do not relax this into skipping the line; a swapped Retail/Billed header was read without complaint until it was added. Extraction order around a page break is not print order (999217 merges a header with the next card heading), so the header is required before the first row, not on the line after the heading.
- A station resolves on the invoice's `Site #` against `stations.site_ref` — the same identifier on both sides — falling back to the store number parsed from the name. This is not an exception to "store number comes from `NAME`, never `SITE`": `site_ref` is never treated as a store number.

**Invoices: CA (T-61)**
- BVD bills Canadian fuel on its **own invoice**, and `CUR` reads **`CN`** — not `CA`, not `CAD`. `US` → `USD`, `CN` → `CAD`; any other code is an `UNKNOWN_CURRENCY` row rejection, and two currencies in one file reject it whole (`MIXED_CURRENCY`). Never default a currency.
- A CA invoice is **litres and CAD per litre**, and the billed price **includes 13% HST**: Pre Tax AMT + HST + GST + PST + QST = Final AMT exactly. The grand-total row's pre-tax and tax columns cover TA/TF/DF only — Scale, Manual and Express print a final amount alone, so on 999217 it is 41,356.89 + 5,376.44 + **Scale 104.00** = 46,837.33.
- **QTY × Billed ≠ Final AMT to the cent** on most real lines, US or CA — BVD prints QTY at 2dp and prices at 4dp from unrounded figures. Reconcile it within the rounding bound (`withinRoundingBound` in `reconcile.ts`), never to the cent and never with a loose tolerance. Retail − Billed = Disc Rate *is* exact.
- A CA invoice imports from the **PDF only** (`CA_CSV_UNVERIFIED`, D30). A CA site name carries no `#` ("BVD MISSISSAUGA - SHAWSON"); the PDF reader splits it from the city at the layout's tab.
- Invoice quantities and money are stored **as printed** — `currency` and `qty_unit` on `invoices`, no `_usd` or gallon suffix on any invoice column (D25). A threshold in gallons (the sub-gallon rule) converts at the rule's input with `litersToGallons`; nothing converted is stored.

**Invoices: billing weeks (T-63)**
- A "period" is a **billing week**, keyed on `invoices.billing_week_end` (the printed `period_end` unless moved) — never on `period_start`, which for 999217 is Aug 1 and would never pair with 999210. The printed range is stored as printed; the *actual* range (`actual_start`/`actual_end`) is the first and last transaction's UTC date, and the two disagreeing is an amber note (`datesDiffer`), never a block. The gap report runs over actual ranges, per currency.
- **One imported invoice per `(billing_week_end, currency)`** — a partial unique index on `status = 'imported'`. Every week lookup filters `status = 'imported'` too: a quarantined invoice has no rows and must not shadow the one that replaces it.
- **Never sum across currencies or units.** A period-scoped read is one side of a week and says which: `currency` and `qtyUnit` on the response root, or per row where both sides can appear (Transactions, the receipt queue). `?units=` converts a *quantity* and a *per-unit price* at the API (`actuals/units.ts`, `qtyConverter`) and never money; nothing converted is stored (D25).
- **No response key contains `Usd`.** `responseKeys.test.ts` walks every period-scoped response, free-form JSON included: anomaly `detail` was stored with legacy `amountUsd`/`gallons` keys, and `normalizeAnomalyDetail` renames them on the way out rather than rewriting the table. A new rule's detail cannot reintroduce one unnoticed.
- The planner and Plan vs Actual stay US-only through a fixed literal (`i.currency = 'USD'`), never a parameter.

**Licensing and retention**
- **Never store a provider geocode permanently.** 30-day cap. Station coordinates come only from an operator export (Love's, or BVD's own travel-centre directory for CA sites), OSM, or the Census gazetteer.
- **Never store price data from the Love's export.** Location and amenity fields only (`StoreType`, `ParkingSpaces`, `DEFLanes`). Those are street prices, not contract prices. BVD's directory carries no prices at all, and its `operator_attrs` are the same kind of closed location/amenity set (§17.1).
- **CA stations never reach the planner.** Directory rows are `country = 'CA'`, actuals-only (D29). The corridor scan and `GET /stations` filter on the fixed literal `s.country = 'US'` — never a parameter. An unpriced CA station near the border would otherwise appear as a "no price" exclusion.
- **Route geometry does not expire in v1.** ORS is ODbL and carries no storage cap, so there is no `routes.expires_at`, no expiry trigger, no retention job and no `geometryExpired` field. Adopting HERE or Google brings all four back — §17 keeps the design. Do not add them before then.
- `routes` is still a **cache** and `plans`/`plan_stops` are still the **record**. Refreshing a route writes to `routes` **only** — never to `plans` or `plan_stops`. Stored totals stay authoritative, because a refreshed line reflects today's road network, not the one that was planned.
- `routes.line`/`polyline`/`legs` stay **nullable** despite never expiring — a provider may return no geometry, and a capped provider later needs a job rather than a migration.
- Attribution ships **in the API response**, so the frontend cannot omit it. Indefinite retention of ODbL data is permitted *because* it is attributed.

**Algorithm**
- The two-pass relaxation lives in the planning service, **never inside `solve()`**.
- **No minimum-leg floor on the final leg.** You do not buy fuel at the destination. Frequent off-by-one source; it has its own test.
- Round **down** on arrival fuel so bucketing never manufactures range that does not exist.
- Top-K candidates are stratified **by position, not price** — a price sort leaves 500-mile holes where stations existed.
- `LEFT JOIN LATERAL` for prices, never an inner join: a station with no price that day must be *named in `exclusions`*, not silently vanish.
- Detour uses the **bracket model**, not route-to-station-and-double. A truck cannot turn around on a controlled-access highway.
- Keep `estimatedDetourMiles` beside the measured value; never overwrite it.

**Engineering**
- **Parameterised SQL only.** No string interpolation of values, anywhere. There is no query builder to hide behind.
- Storage is **miles and gallons**, all the way through: distance columns and fields end in `_miles` / `Miles`, never `_m` / `Meters`. A unit is converted at exactly **four edges**, and nowhere else:
  1. **The ORS adapter** converts the provider's metres on the way in. Never ask ORS for miles with a `units` parameter — it changes the request body and so `routes.request_hash`, the cache key.
  2. **SQL that calls a PostGIS geography function** converts at that call: scale the *parameter* (`ST_DWithin(s.geom, r.line, $2 * 1609.344)`), never the column, so the GIST index still serves it; divide a returned distance by `1609.344`.
  3. **The API**, for a metric toggle.
  4. **The map renderer**, for geometry MapLibre draws on the ground in metres — today only a city-tier stop's uncertainty circle. One function, `uncertaintyRadiusMeters()` in `frontend/src/map/layers.ts`, via `milesToMeters`; the metres are drawn and never stored, returned or passed on (T-22).

  A stray `metersToMiles` anywhere else is a bug. Recorded ORS fixtures and `providerRaw` stay metric — they are the provider's, as recorded.

  **The one exception is invoice quantities and money (D25):** stored as BVD printed them — litres and CAD on a CA invoice — beside `invoices.qty_unit` and `currency`, and converted only at the API or at a gallon-denominated rule's input. Distances are untouched.
- `backend/src/api/` stays **framework-free** — it mounts in one Next route file and is testable without a server.
- Services take no argv and print nothing. CLIs do argv and stdout, and nothing else.
- **Nulls are meaningful.** "No cap" on `maxStops` and `maxDetourMiles` must survive the round trip and must never become `0`.
- Return numbers, not display strings. The frontend composes labels.

---

## Data on disk

`data/bvd-prices/` and `data/bvd-invoices/` are **gitignored** — they exist on the dev machine only, so a fresh clone (and CI) has neither. The `npm run ingest` / `backfill` commands above work when the files are there; tests that assert their exact figures skip when they are not (see Testing rules). The rows below describe a machine that has them.

| Path | What | Verified |
|---|---|---|
| `data/bvd-prices/pcn-usd-9206810-981.csv` | August sheet | 605 data rows, effective 2026-08-22 |
| `data/bvd-prices/2026-01/` | January corpus | 31 files, **30 distinct dates — 2026-01-11 missing**, 594 rows each |
| `data/bvd-prices/2026-01/…-8097639-981 (1).csv` | Duplicate of its sibling | **Byte-identical**, SHA-256 `84fc7c50…` — the real idempotency test case |
| `data/US-CA-GasStations/LovesSearchResults.xlsx` | Operator export | 732 stores, header on row 3, footer row to drop, matches 604/605 — #306 is temporarily closed and absent, so it stays `unresolved` |
| `data/US-CA-GasStations/bvd-travel-centres-2026-10-01.csv` | BVD's Canadian travel-centre directory (committed, D29) | 92 rows, 6 provinces, UTF-8 with BOM; 91 distinct `Site #` — one row (BVD Nisku) has none and is skipped. `Site #` is the invoice's `Site #` (58156 = BVD Comber) |
| `migrations/real/` | Real fleet roster migration set (real driver names, real BVD fuel-card numbers) | Applied via `npm run db:migrate:real`; see T-58 |

The missing January day and the duplicate file are **correct behaviour to report**, not bugs to suppress.

**The fleet roster has the same real/synthetic split (T-58), done as a mirrored migration set.** `migrations/` has two subdirectories, file-for-file identical except 0005: `migrations/synthetic/` (committed — invented names, invented card numbers in a `90000xx` range obviously outside BVD's real numbering) and `migrations/real/` (gitignored — real names, real `295xxxx`/`296xxxx` card numbers). `runMigrations()`'s default points at `migrations/synthetic`, so CI, a fresh clone, and `db:migrate`/`db:reset` always seed a working, resolvable roster with no real data. `npm run db:migrate:real` (or passing `migrations/real` directly to `db/migrate.ts`) applies the real set instead, into whichever schema you point it at — the real invoice's card numbers only resolve once that schema was migrated against `migrations/real`, not `migrations/synthetic`. Unit numbers and the shared-truck/bad-unit scenarios are identical between the two sets; only the names and card numbers differ. Tests that assert against the real invoice (`describe.skipIf(!hasRealFixture)`) point their own schema's migration call at `migrations/real` directly — see `invoice999210.test.ts` and siblings.

---

## Environment

`.env` is gitignored and starts empty. Copy from `backend/.env.example`: `DATABASE_URL`, `ORS_API_KEY`, `ROUTING_PROVIDER=ors`, `AUTH_SECRET`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`, `SEED_USER_DISPLAY_NAME` (optional — defaults to `"Dispatcher"`).

Local Postgres runs on **port 5433**, not 5432.

**Node must be the major `.nvmrc` names (22).** Node 24 on Windows aborted vitest workers natively (exit `0xC0000409`, reported as "Worker exited unexpectedly") on 9 of 13 full backend runs, against 0 of 10 on 22 (T-50). Both git hooks run `scripts/check-node.mjs` first and fail on a mismatch. The dev machine switches with nvm-windows (`nvm use 22.23.3`).

Windows is the dev machine; Vercel runs Linux. Watch path separators, filename case, and CRLF in CSV parsing — CI on Linux is what catches these.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
