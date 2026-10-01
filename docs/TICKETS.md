# Ticket register — CH Fuel Planner v1

**Document version:** 1.0 — 6 September 2026
**Companion:** `BUILD-PLAN.md` breaks every ticket below into implementable steps with test plans.
**Authority:** `PROJECT-SCOPE.md` is the specification. Where this register and the scope disagree, the scope wins and this register gets edited. Where the scope and a migration disagree, the migration wins (§12.2).

---

## Kickoff prompt — template for every ticket

Copy the block below, replace `T-NN`, `<title>` and `<slug>`, and paste it as the first message of a fresh session. One ticket per session keeps the context clean and matches D9's one-branch-per-ticket rule.

```text
Implement T-NN · <title>.

Read first, in this order:
  1. CLAUDE.md — workflow, commands, and the rules that are easy to get wrong
  2. docs/TICKETS.md, the T-NN section — goal, files, dependencies, definition of done
  3. docs/BUILD-PLAN.md, the T-NN section — the numbered steps and their test plans

Then:

1. Confirm every dependency ticket listed for T-NN is merged to main.
   If one is not, stop and tell me.
2. Create the branch:
   git checkout main && git pull && git checkout -b ticket/T-NN-<slug>
3. Work ONE STEP AT A TIME, in the order BUILD-PLAN gives them. For each step:
   - implement it
   - write and run its tests exactly as that step's test plan specifies
   - commit with a conventional message scoped to the ticket, e.g. feat(T-NN): <what>
   - report what you did and what the tests actually said, then STOP and wait
     for me before starting the next step
4. When every step is done, run `npm run verify` and check the ticket's full
   definition of done in docs/TICKETS.md — every box, not most of them.
5. Push, open a PR with `gh pr create --fill`, report the CI result. Do not merge.

Rules for this session:
- Do not start any other ticket, and do not implement work belonging to a later one.
- If something in the plan is wrong or impossible, say so and stop. Do not silently
  narrow the scope, and do not invent a workaround without telling me.
- If a step depends on an open question from the register, ask me rather than guessing.
- Tests are the definition of done for a step. A step whose tests do not pass is not
  finished, and neither is the ticket.
- Report failures with the actual output. Do not describe a step as done if it is not.
```

**Why one step at a time.** The plan decomposes each ticket precisely so a step can be reviewed before the next one builds on it. Running a whole ticket unattended puts the review at the point where unwinding a wrong decision is most expensive — usually the schema or the optimiser, which are the two places this project can go quietly wrong.

---

## How to read this

Each ticket states a **goal**, the **files** it touches (new vs. existing, and for existing files what specifically changes), its **dependencies**, and a **definition of done**. Tickets are numbered in build order; the dependency column is what actually constrains sequencing.

`PROJECT-SCOPE.md` §19 supplies most of this order. Three areas have no §19 step and are called out where they appear: **T-01** (toolchain), **T-20** (retention job — since deferred out of v1 entirely), and the §6 additions of `UI-DATA-CONTRACT.md` folded into **T-18**.

---

## Decisions locked for this register

Answered 6 September 2026. These close §21 Q1–Q3 and the open questions raised during exploration.

| # | Decision | Consequence |
|---|---|---|
| **D1** | **No ORM and no query builder.** Raw parameterised SQL over `pg`. | §21 Q1 closed — neither Drizzle nor Kysely. Requires a hand-written migration runner (T-01) and reframes §12.2's drift test (T-02). |
| **D2** | **`reserve_fraction` = 0.15.** | Affects exactly one column: `truck_profiles.reserve_fraction` — today `trucks.reserve_fraction NOT NULL DEFAULT 0.100` at `migrations/0001_init.sql:78`. The three seeded profiles in §16 already carry 0.15. Nothing else stores it; `plans` records the derived `min_arrival_gallons`, not the fraction. |
| **D3** | **Mixed primary keys by rule.** `uuid` for anything exposed in a URL, `bigserial` for high-volume append-only rows. | uuid: `users`, `stations`, `truck_profiles`, `price_imports`, `import_batches`, `routes`, `plans`, `saved_locations`. bigserial: `station_prices`, `plan_stops`, `import_rejections`, `station_geocode_candidates`. Composite natural keys: `place_centroids`, `product_codes`, `provider_usage`, `provider_quota`. |
| **D4** | **Migrate the frontend to TypeScript as early as possible.** | Merged into T-04 with the Next.js move, because both rewrite every component file and doing them separately means touching each file twice. |
| **D5** | **Next.js from the start.** | T-04 replaces the Vite SPA. `backend/src/api/` still stays framework-free per §13 — the Next route handler is a thin mount, so the API remains testable without a server. |
| **D6** | ~~**`truck_number` stays `integer`.**~~ **Superseded by D18 (`PROJECT-SCOPE-v2.md` A15).** Real fleet values turned out to include `1012`…`1023` alongside `031`…`073` — a leading zero that `integer` can't preserve, not just a `14-B` shape. `unit_number` is `text`, unpadded. | No schema change from §12. Display is zero-padded to three digits by one shared formatter. The mock's `Truck 14-B` labels are wrong and die with `trips.ts` in T-21. If a `14-B` unit ever exists, the column becomes `text` — a one-line migration, not a redesign. |
| **D7** | **Login page in v1**, with Auth.js credentials + JWT sessions. | New, requested 6 September. §12's `users` table lacks `password_hash` and `display_name`; T-02 adds both. JWT sessions avoid the `accounts`/`sessions`/`verification_tokens` tables that database sessions would need for a single account. Auth moves from §19 step 14 to T-05. |
| **D8** | **Migrations apply through a runner, not the Docker init mount.** | `docker-compose.yml` loses its `./migrations:/docker-entrypoint-initdb.d:ro` volume. The init mount only fires on an empty volume and has no equivalent on Neon; a runner is one code path for local and production both. |
| **D9** | **One ticket = one branch = one squashed commit on `main`.** | Branch `ticket/T-NN-slug`, PR, CI green, squash merge, delete branch, branch fresh for the next ticket. `main` history then reads as the ticket register and every commit on it is a CI-verified state. Workflow detail lives in `CLAUDE.md`. |
| **D10** | **CI moves from T-24 to T-01.** | Under D9 a gate introduced at the end would leave the preceding 23 merges unverified. `.github/workflows/ci.yml` and the git hooks are built in **T-01 step 1.4**; T-24 only hardens them for release. CI runs the *same* `npm run verify` a developer runs — it maintains no separate suite, it supplies a clean Linux environment with a fresh database. |

### Still open — not blocking, flagged where they bite

| # | Question | Blocks | Scope ref |
|---|---|---|---|
| Q4 | Real fleet MPG | Nothing structurally; every dollar figure is directionally right and absolutely wrong until answered | §16, §21 Q4 |
| ~~Q5~~ | ~~Exact Google Maps disclaimer wording~~ — **closed 22 September 2026**, wording pinned by `backend/src/planning/disclaimers.test.ts` (T-17) | — | §9.4, §21 Q5 |
| Q6 | Does this count as Vercel business use | **T-24** — $20/mo Pro | §10, §21 Q6 |
| Q8 | Is `min_leg_miles` 300 or 350 | Nothing — it is a profile column, tunable per truck. Note `DevToolsTab.jsx` currently shows 350 against the scope's 300; T-04 aligns it to 300 | §5.1, §21 Q8 |
| — | Trip reference format (`T-1042` vs. raw UUID) | **T-18** list projection and **T-21** header chip | UI contract §7 |
| — | Status vocabulary — solve status vs. trip lifecycle | **T-18**, **T-23**. The design has one badge for two axes | UI contract §4, §7 |
| — | "Cheapest along route" set and size | **T-21** §3.7 chart | UI contract §7 |
| — | DP rejection reasons for the in-corridor layer | **T-23** — optional, label stays generic without it | UI contract §3.8 |

---

## Current state, as measured

Verified against the working tree on 5–6 September 2026, not taken from the docs.

| Area | State |
|---|---|
| `migrations/0001_init.sql` | **Does not run.** Trailing comma at line 79 before `);`. Also `price_imports.effective_date UNIQUE` (line 22) and `station_prices.effective_on` naming drift. |
| `backend/`, `scripts/` | **Empty directories.** Untracked — git cannot store them. Intent scaffolded, nothing inside. |
| TypeScript | **None anywhere.** No `tsconfig`, no `.ts` file. |
| Tests | **None, and no runner.** Root `npm test` is the npm default stub that exits 1. |
| `.env` | **0 bytes.** No ORS key. |
| Root `package.json` | No dependencies; `main` points at a nonexistent `index.js`. |
| `frontend/` | Vite 8 + React 19, plain JSX. Static mock reading `src/data/trips.js`. No API, no map. |
| `data/bvd-prices/pcn-usd-9206810-981.csv` | 607 lines = metadata + header + **605 data rows**, effective `2026-08-22`. |
| `data/bvd-prices/2026-01/` | 31 files, **30 distinct dates, 2026-01-11 missing**, `2026-01-26` twice with identical SHA-256 `84fc7c50…`, 594 data rows each. |
| `data/US-CA-GasStations/LovesSearchResults.xlsx` | Present. Header on row 3, footer row to drop. |

### Doc-vs-code drift found during exploration

Neither document flags these. Each is fixed in the ticket named.

| # | Drift | Fixed in |
|---|---|---|
| 1 | `UI-DATA-CONTRACT.md` §3.8 describes **two** map-layer toggle buttons; `PlanTab.jsx` has **one**. The contract documents a newer design revision than the mock implements. | T-23 |
| 2 | UI contract §3.10 describes a "Sent to driver" checkbox that **does not exist** in `PlanTab.jsx`. | T-19, T-23 |
| 3 | `DevToolsTab.jsx` defaults min-leg to **350**; scope §5.5 says **300**. | T-04 |
| 4 | `DevToolsTab.jsx` shows a 120 gal / 7.1 mpg truck; no §16 profile matches (150 / 200 / 250). | T-04 |
| 5 | `DevToolsTab.jsx` labels the price feed `opis-live · v3` and the router `osrm-truck · hgv`. Both wrong — the feed is a BVD CSV import and the router is ORS. | T-04 |
| 6 | Mock candidates are Pilot / Chevron / Shell / Maverik; real data is 605/605 Love's. | T-21 |

---

## Ticket index

| ID | Title | Depends on | Phase |
|---|---|---|---|
| **T-01** | Toolchain and workspace skeleton | — | 0 · Foundation |
| **T-02** | Rewrite the database schema | T-01 | 0 |
| **T-03** | Seed reference data | T-02 | 0 |
| **T-04** | Next.js + TypeScript migration | T-01 | 1 · Shell and access |
| **T-04B** | Backend build step and package boundary | T-04 | 1 |
| **T-05** | Auth and login page | T-03, T-04 | 1 |
| **T-06** | Ingest service and `npm run ingest` | T-03 | 2 · Data in |
| **T-07** | Backfill CLI and the January import | T-06 | 2 |
| **T-08** | Station resolution from the operator export | T-06 | 2 |
| **T-09** | Gazetteer fallback and manual entry | T-08 | 2 |
| **T-10** | ORS adapter, budget guard, both meters | T-01, T-02 | 3 · Routing and solving |
| **T-11** | Corridor query | T-09, T-10 | 3 |
| **T-12** | Optimiser registry, `dp_v1`, `greedy_v1` | T-01 | 3 |
| **T-13** | Validation loop and two-pass relaxation | T-11, T-12 | 3 |
| **T-14** | Detour costing | T-10, T-11, T-12 | 3 |
| **T-15** | Address geocoding and `saved_locations` | T-02, T-10 | 4 · API |
| **T-16** | Plan orchestration, `POST /plans`, `GET /plans/{id}` | T-13, T-14, T-15, T-04B | 4 |
| **T-17** | Google Maps URL and disclaimers | T-16 | 4 |
| **T-18** | Supporting read endpoints | T-16 | 4 |
| **T-19** | `sentToDriver` write path | T-18 | 4 |
| ~~**T-20**~~ | ~~Route geometry retention job~~ — **deferred, not in v1** (§17, 10 Sep 2026) | — | — |
| **T-21** | Frontend API client, retire the mock | T-18 | 5 · Frontend |
| **T-22** | MapLibre map | T-21 | 5 |
| **T-23** | Missing UI states | T-21, T-22 | 5 |
| **T-24** | Deployment — Vercel + Neon | T-05, T-23 | 6 · Ship |

**Not ticketed:** §19 step 17, stop-penalty tuning. The scope defers it deliberately and v3.4 measured every chosen stop at 0.0 miles of detour, so the penalty term did no work. Tuning against zero evidence is worse than not tuning.

---

## Target layout

```
backend/                       workspace package @ch/core — framework-free
  src/
    domain/       shared types (PlanResponse, units, formatters)
    db/           pool, migration runner, schema descriptor, drift test
    ingest/       parse, validate, ingestFile, backfill, report
    resolution/   operator export, gazetteer, city normalisation
    catalog/      profiles, stations, price sheets, saved locations
    routing/      provider interface, ORS adapter, budget guard, quota observer
    planning/     corridor, detour, validation loop, plan service, disclaimers
    optimizer/    registry, dp_v1, greedy_v1        <- pure, no I/O
    api/          framework-free route table + RFC 9457 errors
    cli/          ingest, backfill, seed, resolve, migrate, expire-geometry
frontend/                      Next.js app (Vercel root directory)
  src/app/                     routes, layout, api/v1 mount, signin page
  src/components/              *.tsx
migrations/                    *.sql, applied in order by the runner
scripts/                       Python one-offs, run by hand, never imported
docs/
```

Tests are co-located as `*.test.ts` beside the unit under test. Integration tests needing a database live in `backend/test/integration/`.

---

# Phase 0 · Foundation

## T-01 · Toolchain and workspace skeleton

**Priority 1. Blocks everything.**

**Goal.** A `backend` workspace that compiles TypeScript, runs `vitest`, connects to Postgres over raw `pg`, and applies migrations through a runner.

**Why.** §19 has no step for this, yet steps 2–16 all assume a TypeScript project with a test suite. Nothing in the repository can currently run a test or compile a `.ts` file. This gap is the single largest omission in the build order.

**Files — new**
- `backend/package.json` — name `@ch/core`, `type: module`. Deps: `pg`, `zod`, `csv-parse`, `pino`. Dev: `typescript`, `vitest`, `@types/node`, `@types/pg`, `tsx`.
- `backend/tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`, NodeNext resolution, ES2023 target.
- `backend/vitest.config.ts` — node environment, co-located `*.test.ts`.
- `backend/src/db/pool.ts` — `pg.Pool` singleton reading `DATABASE_URL`, with a `query<T>()` helper that is parameterised only.
- `backend/src/db/migrate.ts` — applies `migrations/*.sql` in filename order inside a transaction, recording each in a `schema_migrations` table. Idempotent: already-applied files are skipped.
- `backend/src/domain/units.ts` — metres↔miles, litres↔gallons, and the D6 `formatUnitNumber()` three-digit pad. Storage is miles + gallons; conversion happens only at the edges named in CLAUDE.md — the ORS adapter, PostGIS calls, the API, and (since T-22) the map renderer (§6 decision 16; made true of the schema by T-52).
- `backend/.env.example` — `DATABASE_URL`, `ORS_API_KEY`, `ROUTING_PROVIDER`, `AUTH_SECRET`.
- `.nvmrc` — Node 22.
- `.github/workflows/ci.yml` — the merge gate (D10). Runs `npm run verify` on a clean Linux checkout against a fresh PostGIS service container.
- `.githooks/pre-commit` (typecheck + lint + unit tests), `.githooks/pre-push` (full verify), `.github/pull_request_template.md`.
- `CLAUDE.md` (repo root) — workflow, commands, and the collected rules that are easy to get wrong.

**Files — modified**
- `package.json` (root) — add `backend` to `workspaces`; replace the `test` stub (`echo "Error: no test specified" && exit 1`) with a real vitest invocation; add `typecheck`, `lint`, `test:unit`, `verify`, `db:migrate`, and a `prepare` that sets `core.hooksPath`; **remove** the dead `"main": "index.js"`; change `db:reset` to `down -v && up -d` followed by the migration runner, since D8 removes the init mount.
- `docker-compose.yml` — **remove** the `./migrations:/docker-entrypoint-initdb.d:ro` volume (D8). The `db-data` volume, port mapping and healthcheck are unchanged.
- `.env` — currently 0 bytes; populate from `.env.example`. Stays gitignored.

**Files deliberately left alone.** All of `frontend/` — T-04 owns it. `data/` is read-only input.

**Dependencies.** None.

**Definition of done**
- `npm run typecheck` passes on an empty `src`.
- `npm test` runs vitest and reports zero tests without erroring.
- `npm run db:up && npm run db:migrate` applies cleanly against a fresh volume, and a second `db:migrate` is a no-op.
- `docker compose config` validates after the volume removal.
- **CI is green on the T-01 PR, and a deliberately failing test is confirmed to turn it red** — a gate nobody has watched fail is not yet known to be a gate.
- CI passes with no `.env` present, proving nothing depends on an untracked local file.
- Branch protection is configured on `main` per `CLAUDE.md` before T-02 opens.

---

## T-02 · Rewrite the database schema

**Priority 2.**

**Goal.** `npm run db:reset` produces a correct, empty database matching §12.

**Why.** §12.1 lists eleven divergences, the first of which stops the migration running at all. The scope recommends a rewrite over an `ALTER` chain because the file has never successfully applied and holds no data.

**Files — new**
- `migrations/0001_init.sql` — **full rewrite** (see below).
- `backend/src/db/schema.ts` — hand-maintained descriptor of every table, column, type, nullability and constraint.
- `backend/test/integration/drift.test.ts` — compares that descriptor against `information_schema` on every run. **Not `src/db/drift.test.ts` as originally specified:** it needs a live database, and `test:unit` — the pre-commit gate, which declares itself "Fast gate: no database" — excludes `test/integration/` by path. Under `src/` it would run in that gate and fail whenever Docker was not up. The comparison function itself is pure and lives in `schema.ts`, so the fault-injection cases need no database.
- `backend/src/db/types.ts` — row interfaces per table.

**What specifically changes in `migrations/0001_init.sql`.** All eleven §12.1 items:

1. Delete the trailing comma at line 79 that stops the file parsing.
2. Drop `UNIQUE` from `price_imports.effective_date`; keep a plain index on `(supplier, effective_date)`. The SHA-256 already provides idempotency, and the constraint forbids a legitimate corrected re-send.
3. Add `plans` and `plan_stops` — the business record, absent entirely.
4. Add `users`, `saved_locations`, `product_codes`, `place_centroids`, `import_batches`, `import_rejections`, `provider_usage`, `provider_quota`.
5. Rename `trucks` → `truck_profiles`; add `min_leg_miles`, `cost_per_mile_usd`, `fixed_stop_minutes`, `slug`, `display_name`, `owner_user_id`, `is_system`, `is_active`, `max_gallons_per_fill`, and the `CHECK (min_leg_miles <= max_leg_miles)`.
6. `reserve_fraction` default `0.100` → `0.150` (D2). This is the only column D2 touches.
7. `stations.site_ref UNIQUE` → composite `UNIQUE (supplier, site_ref)` with a new `supplier` column.
8. Add `stations.resolution`, `uncertainty_miles` (born `uncertainty_m`; T-52), `resolution_source`, `resolved_at`, `truck_accessible`, `osm_id`, `osm_tags`, `operator_attrs`, `city_raw`/`city_normalized`, `brand_normalized`, `first_seen_at`, `last_seen_at`.
9. `station_prices.effective_on` → `valid_on`; re-key `UNIQUE (station_id, raw_product, valid_on)`; add `raw_product`, the generated `price_pump` and `price_ifta_net` columns, and relax the taxes to nullable to match §12.
10. `routes.line`/`polyline` → nullable; add `provider`, `via_hash`, `legs`, `origin_geom`, `destination_geom`, `truck_profile_id`. **No `expires_at` and no `set_route_expiry()` trigger** — §17 was revised on 10 September 2026 to drop route-geometry expiry from v1, since ORS is ODbL and carries no storage cap. Geometry stays nullable so a capped provider later needs a job, not a migration.
11. Apply D3's key rule throughout.

**Beyond §12.1 — required by D7.** `users` gains `password_hash text NOT NULL` and `display_name text NOT NULL`. §12's `users` has neither, so a login page cannot be built against it as written. `display_name` also feeds the header chip (UI contract §2).

**On the drift test under D1.** §12.2 assumes a query builder whose schema definition doubles as the mirror. With no query builder, `schema.ts` is that mirror, hand-maintained. It costs a little discipline and buys the same guarantee: code and database cannot drift silently.

**Dependencies.** T-01.

**Definition of done**
- `npm run db:reset` applies with no error against a clean volume.
- Every §12.1 item is closed; the drift test passes.
- `\d+ truck_profiles` shows `reserve_fraction` defaulting to `0.150`.
- Inserting two `price_imports` rows with the same `effective_date` and different hashes succeeds; the same hash twice fails.
- `users` accepts a row with `password_hash` and `display_name`.

---

## T-03 · Seed reference data

**Priority 3.**

**Goal.** Three truck profiles, the `BVD`/`ULSD` product code, the Census gazetteer, and one dispatcher account.

**Why.** §19 folds this into step 1, but the gazetteer load is a bulk job with its own failure modes and belongs apart from a schema migration. The seeded user is new, required by D7.

**Files — new**
- `migrations/0002_seed.sql` — the three §16 profiles (`volvo-vnl-300` 150 gal / 6.5 mpg, `volvo-vnl-760` 200 / 7.5, `volvo-vnl-860` 250 / 7.2, all reserve 0.15, max leg 500, min leg 300), each carrying a placeholder `truck_number` (022 / 056 / 091 — dispatchers identify a truck by fleet number, not model name), the `('BVD','ULSD','highway_diesel','seed',…)` product code, and the `volvo-vnl-860` physical spec for the router (36,287 kg, 411 cm, 259 cm, 2,250 cm, 5 axles).
- `scripts/load_gazetteer.py` + `scripts/requirements.txt` — Census Places and County Subdivisions into `place_centroids`, uncertainty `r = sqrt(ALAND_SQMI / π)`, stored as miles (the source unit; T-52). Python is the right tool here per §7.1 and its output is rows, not code.
- `backend/src/domain/password.ts` — `hashPassword`/`verifyPassword` (scrypt, Node's built-in `crypto`, no new dependency). Pure, framework-free — T-05's `authorize()` imports `verifyPassword` from here rather than re-implementing it.
- `backend/src/cli/seed.ts` — creates the dispatcher account from env (`SEED_USER_EMAIL`, `SEED_USER_PASSWORD`, optional `SEED_USER_DISPLAY_NAME`), hashing the password via `domain/password.ts`. Refuses to overwrite an existing user.

**Dependencies.** T-02.

**Definition of done**
- Three profiles present, each with `reserve_fraction = 0.150` and `min_leg_miles = 300`.
- `place_centroids` populated for all 50 states; uncertainty is positive everywhere.
- `npm run seed` creates one user; re-running does not duplicate or overwrite it.
- The product-code table has exactly one row.

---

# Phase 1 · Shell and access

## T-04 · Next.js + TypeScript migration

**Priority 4.**

**Goal.** The frontend becomes a Next.js app written in TypeScript, still rendering the existing mock, with a mount point ready for the API.

**Why.** D4 and D5 together. Both rewrite every component file, so doing them as one pass touches each file once instead of twice. Doing it now rather than at §19 step 15 means no component is ever written twice.

**The one design rule that makes this cheap.** Type the mock against the **target** API types from `backend/src/domain/`, not against its own current shape. `trips.ts` becomes a `PlanResponse[]` fixture. T-21 then swaps the data source and deletes the file, instead of reshaping every component a second time.

**Files — new**
- `frontend/next.config.ts`, `frontend/tsconfig.json`.
- `frontend/src/app/layout.tsx` — absorbs `index.html`'s document shell and the `index.css` import.
- `frontend/src/app/page.tsx` — the tab shell from `App.jsx`.
- `frontend/src/app/api/v1/[[...path]]/route.ts` — a thin adapter over `backend/src/api`'s framework-free table. Roughly twenty lines, and no business logic (§13).
- `backend/src/domain/planResponse.ts` — the shared `PlanResponse`, `PlanStop`, `CandidateStation`, `Disclaimer` types, per §14 and UI contract §3.
- `frontend/src/lib/format.ts` — the formatters that turn numbers into the display strings the mock currently hard-codes.

**Files — modified (every one rewritten to `.tsx`)**
- `App.jsx` → dissolved into `app/layout.tsx` + `app/page.tsx`.
- `Header.jsx`, `PlanTab.jsx`, `RecentTab.jsx`, `DevToolsTab.jsx`, `RouteMap.jsx`, `Corners.jsx` → `.tsx` under `src/components/`, props typed from the shared domain types.
- `data/trips.js` → `data/trips.ts`, retyped as `PlanResponse[]`. **Values change**: display strings become numbers (`"$286.62"` → `286.62`, `"7h 40m"` → `27600`), per UI contract §1's "return numbers, not display strings".
- `DevToolsTab.tsx` — fix drift items 3, 4 and 5: min-leg `350` → `300`; the 120 gal / 7.1 mpg truck → a real §16 profile; `opis-live · v3` → the BVD import identity, `osrm-truck · hgv` → ORS.
- `frontend/package.json` — `next` replaces `vite` and `@vitejs/plugin-react`; add `typescript`, `@types/*`; scripts become `next dev` / `next build`.
- `frontend/.oxlintrc.json` — add the TypeScript plugin.
- `frontend/.gitignore` — `dist` → `.next`.
- `package.json` (root) — `dev`/`build` now drive Next.

**Files — deleted.** `frontend/index.html`, `frontend/src/main.jsx`, `frontend/vite.config.js`, `frontend/README.md` (a stock Vite template README describing a stack that no longer exists), `frontend/src/assets/vite.svg`.

**Files deliberately left alone.** `frontend/src/App.css` and `index.css` — plain CSS with custom properties, portable as-is. Its Google Fonts `@import` works under Next; moving to `next/font` is an optimisation, not a requirement, and is out of scope here. `frontend/public/` assets are untouched.

**Dependencies.** T-01.

**Definition of done**
- `npm run dev` serves the app at `/`, visually unchanged from the Vite build.
- `npm run build` produces a Next production build with zero type errors.
- No `.jsx` file remains under `frontend/src`.
- `trips.ts` type-checks as `PlanResponse[]`; no component reads a pre-formatted string.
- `GET /api/v1/health` returns a stub through the mount.
- Drift items 3–5 are gone.

---

## T-04B · Backend build step and package boundary

**Priority 4.5.**

**Goal.** `@ch/core` becomes a properly buildable package: `npm run build --workspace backend` emits `backend/dist/**/*.{js,d.ts}` from `backend/src`, exposed via a real `package.json` `exports` map. The Next mount point (T-04) stops reaching into `backend/src` directly and depends only on this compiled surface.

**Why.** T-04 step 4.4 found that Turbopack cannot resolve backend's NodeNext-required `.js`-suffixed relative imports when bundling backend source directly — it has no equivalent of webpack's `resolve.extensionAlias`, the standard fix for this exact interop case. The interim fix landed in T-04 — `backend/src/api/app.ts` hand-builds its 404 body instead of importing `problemResponse` from `problem.ts`, and `frontend/tsconfig.json` carries a `paths` alias reaching straight into `backend/src` — does not scale to T-16, whose real route table pulls in much deeper chains (`planning/`, `optimizer/`, `routing/`, `catalog/`, ...). This ticket closes that gap before T-16 needs it to work, and removes both stopgaps.

**The mechanism.** NodeNext requires `backend/src` to write `import "./foo.js"` *because that is the correct name of the compiled output* — once `tsc` actually emits, `foo.ts` becomes `dist/foo.js`, and the specifier is simply correct. No bundler cleverness or extension rewriting is needed; the mismatch only exists today because Turbopack is asked to resolve source-tree specifiers against a source tree that was never meant to be read literally.

**Files — new**
- `backend/tsconfig.build.json` — extends `tsconfig.json`; `noEmit: false`, `declaration: true`, `outDir: "dist"`, `rootDir: "./src"`, `include: ["src"]`, excludes `*.test.ts`.
- `backend/.gitignore` — ignores `dist/`.

**Files — modified**
- `backend/package.json` — add `"build": "tsc -p tsconfig.build.json"`; add an `"exports"` map: `"."` and `"./*"`, each `{ "types": "./dist/.../*.d.ts", "default": "./dist/.../*.js" }`.
- `backend/src/api/app.ts` — un-inline: restore `import { problemResponse } from "./problem.js"` for the 404 branch, remove the stopgap comment.
- `frontend/tsconfig.json` — remove the `@ch/core/*` → `../backend/src/*` `paths` override; `@ch/core/*` now resolves through the real package.
- `package.json` (root) — `"build"` becomes `npm run build --workspace backend && npm run build --workspace frontend`; `"predev"` also builds backend, so `npm run dev` always has fresh `dist/`; add `"pretypecheck": "npm run build --workspace backend"` so `npm run typecheck` — and therefore `verify`, and CI, unchanged — transparently keeps `dist` fresh with no separate CI step.

**Files deliberately left alone.** `.github/workflows/ci.yml` — CI already runs `npm run verify`, and the `pretypecheck` hook makes that self-sufficient; no CI-specific step is needed.

**The trade-off this introduces.** Frontend's typecheck and Turbopack bundling now depend on `backend/dist` being *rebuilt*, not just edited — a stale `dist/` after an unbuilt `backend/src` change is a real, if minor, footgun for local dev (CI never sees it, since `pretypecheck` always rebuilds first). This is the standard trade-off any monorepo with a "consume compiled output" convention carries, not a new risk unique to this repo.

**Dependencies.** T-04.

**Definition of done**
- `npm run build --workspace backend` emits `dist/api/app.js`, `dist/api/problem.js`, `dist/domain/planResponse.js` (+ matching `.d.ts` files), with no `.test.js` output.
- `backend/src/api/app.ts` imports `problemResponse` from `./problem.js` again — no inline duplication.
- `frontend/tsconfig.json` has no `paths` override for `@ch/core`.
- `npm run build` (root, clean checkout, no prior `backend/dist`) succeeds end to end.
- `npm run typecheck` (root, clean checkout) succeeds with no manual pre-step.
- T-04's own API tests (`GET /api/v1/health` → 200, unknown path → 404 `application/problem+json`) still pass unchanged, and the app still serves those correctly through `npm run dev`.
- `npm run verify` is green from a clean checkout.
- CI is green on the PR.

---

## T-05 · Auth and login page

**Priority 5.**

**Goal.** One seeded dispatcher can sign in; anonymous requests are refused at the boundary.

**Why.** Requested directly (D7). §19 places auth at step 14 with sound reasoning — that adding it early makes every intermediate test carry a session. That reasoning is preserved rather than discarded: auth sits **in front of** the API, and `createApp({ authRequired })` lets every later ticket test without one.

**Files — new**
- `frontend/src/app/signin/page.tsx` — email + password form, error state for bad credentials.
- `frontend/src/app/api/auth/[...nextauth]/route.ts` — Auth.js credentials provider, JWT sessions.
- `frontend/src/auth.ts` — Auth.js config; `authorize()` verifies the hash from `users.password_hash` via `verifyPassword()` from `backend/src/domain/password.ts` (already built in T-03 for `seed.ts` — not re-implemented here).
- `frontend/middleware.ts` — the §13 boundary: **307** to `/signin` for a page request, **401** `application/problem+json` for an `/api/` path. Nothing exempt, including `/health`. A redirect answering `fetch` with a sign-in page at status 200 is the confusing failure this split exists to prevent.
- `backend/src/api/app.ts` — `createApp({ authRequired })`. The API is *told* whether it is protected; it does not assert it.
- `backend/src/catalog/users.ts` — lookup and password verification.

**Files — modified**
- `Header.tsx` — the hard-coded `M. Hodson` / `Dispatch` chip and inert **Sign out** button become session-backed `displayName` / `role` and a real sign-out.
- `backend/src/cli/seed.ts` — hash compatible with `authorize()`.
- `.env.example` — `AUTH_SECRET`, `AUTH_URL`.

**Dependencies.** T-03 (the `users` row), T-04 (the Next app).

**Definition of done**
- Correct credentials reach the app; wrong ones show an error and do not.
- Anonymous `GET /` → 307 to `/signin`; anonymous `GET /api/v1/health` → 401 `application/problem+json`, **not** a redirect.
- The header chip shows the seeded user's real name and role.
- Sign-out clears the session and the next page request redirects.
- `createApp({ authRequired: false })` serves API tests with no session.

---

# Phase 2 · Data in

## T-06 · Ingest service and `npm run ingest`

**Priority 6.**

**Goal.** §11.1's seven steps as `ingestFile(buffer, meta)` — no HTTP, no `process.argv`, no printing — plus a thin CLI that does argv and stdout and nothing else.

**Why.** §19 step 2. The function/entry-point split is what makes §11.2's deferred upload route and §20's Gmail poller wrappers rather than rewrites, and it is the constraint §7.1 leans on to rule out a Python ingest.

**Files — new**
- `backend/src/ingest/parseBvdCsv.ts` — metadata row → `company_id` + `effective_date`, then skip it; header normalise (trim, uppercase, collapse whitespace).
- `backend/src/ingest/validate.ts` — Zod schemas. Columns present, numerics parse, `PROD` mapped, USPS state valid, and `YOUR PRICE = min(TOTAL COST, RETAIL PRICE)`.
- `backend/src/ingest/ingestFile.ts` — hash, dedupe, stage, validate, promote, upsert stations, insert prices, build report.
- `backend/src/ingest/report.ts` — rows read/accepted/rejected with reasons, new stations, unmapped products, vanished stations.
- `backend/src/cli/ingest.ts`.
- Tests beside each.

**Files — modified.** `package.json` (root) — add the `ingest` script.

**Key rules that are easy to get wrong**
- Trust the header's effective date directly. **No `+1` offset logic** (§4.1) — the file arrives on day *N* stating day *N+1*, and the header is already correct.
- Read `YOUR PRICE`; never recompute it. The `min()` cap is a BVD business rule only they can apply.
- An unmapped `PROD` **fails the row**. It is never guessed at or default-mapped — that guard is the entire reason `product_codes` exists (§22.4).
- Rejected rows are quarantined with a reason code, never dropped.
- Store `city_raw` as received and `city_normalized` for matching; never overwrite what the supplier sent.
- Do not "correct" `CH LOGISTIX` to `CH LOGISTICS`. It is what the supplier sends and the ingest records what arrived.

**Dependencies.** T-03.

**Definition of done**
- `npm run ingest -- ./data/bvd-prices/pcn-usd-9206810-981.csv` yields **605 stations and 605 price rows**, effective `2026-08-22`.
- Re-running is a no-op returning the existing import unchanged.
- The report prints to stdout and the service itself prints nothing.
- A row with an unknown `PROD` is rejected with a code, and the other 604 still promote.

---

## T-07 · Backfill CLI and the January import

**Priority 7.**

**Goal.** Thirty days of real price history, with the gap and the duplicate both handled correctly.

**Why.** §19 step 3. This is not a hypothetical exercise: the January corpus supplies two real test cases before a line of ingest is written.

**Files — new**
- `backend/src/ingest/backfill.ts` — walks a directory, writes an `import_batches` row with per-file status so one malformed sheet does not sink the run.
- `backend/src/ingest/gapReport.ts` — any date in range with no `price_imports` row.
- `backend/src/cli/backfill.ts`.

**Files — modified.** `package.json` (root) — add the `backfill` script.

**Dependencies.** T-06.

**Definition of done**
- `npm run backfill -- ./data/bvd-prices/2026-01/` imports **30 distinct dates from 31 files**.
- The report **names `2026-01-11` as a gap**. This is correct behaviour, not a bug to suppress — it means an email was deleted or BVD skipped a send.
- `pcn-usd-8097639-981 (1).csv` is skipped as a duplicate on `file_sha256`, verified byte-identical (`84fc7c50…`).
- Import order does not affect the result; the run is idempotent.
- Each file contributes 594 price rows.

---

## T-08 · Station resolution from the operator export

**Priority 8.**

**Goal.** 604 of 605 stations at `exact` resolution with `truck_accessible = 'operator_verified'`.

**Why.** §19 step 4. §11.4 step 1 verified this join at 604/605 with independent state agreement on all 604.

**Files — new**
- `scripts/resolve_from_operator.py` — reads the xlsx with `header=2` (rows 1–2 are branding and a price disclaimer), drops the footer row, joins on store number.
- `backend/src/resolution/operatorExport.ts` — store number parsed from `NAME` (`LOVES #368` → 368), **never from `SITE`**; `SITE` matches the store number in 0 of 605 cases.
- `backend/src/resolution/storeNumber.test.ts`.

**The licensing rule this ticket must not break.** `operator_attrs` stores `StoreType`, `ParkingSpaces`, `DEFLanes`, `Address`, `Zip`, `HighwayOrExit` — location and amenity fields only. **Never the price column** (§17.1). Those are street prices, not contract prices, and are not what the app plans against.

**Dependencies.** T-06 (needs station rows to resolve against).

**Definition of done**
- 604 stations `resolution = 'exact'`, `uncertainty_miles = 0`, `truck_accessible = 'operator_verified'`.
- Store **#306** is the only unresolved one: it is temporarily closed and absent from the export, so it stays `unresolved` (decision, 2026-09-20; it was originally queued for manual entry).
- State agreement holds on all 604 as an independent check.
- All coordinates fall inside CONUS (lat 25.95–48.57, lng −123.37 to −72.26).
- No price field from the xlsx reaches the database.

---

## T-09 · Gazetteer fallback and manual entry

**Priority 9.**

**Goal.** Every station that can be placed is resolved. *(Amended 2026-09-20: the original goal was 605 of 605. #306 is temporarily closed and has no coordinates, so it stays `unresolved` and is never planned against.)*

**Why.** §19 step 5. The fallback chain exists for a future brand that publishes nothing, not for Love's; store #306 was the one case that would have needed it, until it turned out to be closed.

**Files — new**
- `backend/src/resolution/cityNormalize.ts` — 25 ALL-CAPS rows to title case; 5 abbreviated prefixes expanded (`Mc Calla`, `Mt Juliet`, `Mt Vernon`, `N Little Rock`, `St Augustine`).
- `backend/src/resolution/gazetteer.ts` — `place_centroids` lookup on `(state, normalized city)`, tier 3, `resolution = 'city'`.
- `backend/src/cli/resolve.ts` — includes a manual-coordinate subcommand.
- Tests beside each.

**Eligibility rule.** A `city`-tier station is a valid stop **only if** `uncertainty_miles < 5` (miles; it was 8 km until 2026-09-20) and the leg has at least `2u` slack. `unresolved` stations are never planned against.

**Dependencies.** T-08.

**Definition of done**
- All 604 stations the operator export carries have a non-null `geom`; #306 (temporarily closed) stays `unresolved`.
- The manual-entry subcommand exists and takes coordinates from an approved source — not copied from a provider's map, which would still be provider data under §17.
- The 9 ambiguous `(city, state)` pairs covering 21 rows are resolved by store number at tier 1 and never consult the city.
- City normalisation is unit-tested against all 30 known-dirty strings.

---

# Phase 3 · Routing and solving

## T-10 · ORS adapter, budget guard, both meters

**Priority 10.**

**Goal.** §8.4's `RoutingProvider` behind a factory, with a spend guard that throws and a rate-limit observer that records.

**Why.** §19 step 6.

**Files — new**
- `backend/src/routing/provider.ts` — the interface. **`legs` is mandatory**; T-13's validation loop needs per-leg distances from the waypointed route, and an adapter that cannot supply them is unusable regardless of its other qualities.
- `backend/src/routing/ors.ts` — `driving-hgv`, truck spec from the profile.
- `backend/src/routing/factory.ts` — selected by `ROUTING_PROVIDER`. Adopting HERE later is one new file plus one case here, with no caller changed.
- `backend/src/routing/budgetGuard.ts` — **ours**: a persisted ceiling per endpoint, counted per UTC day, that throws on call N+1. An error that stops the call, not a log line. (Built as a pooled monthly ceiling and re-based to this by T-54.)
- `backend/src/routing/quotaObserver.ts` — **theirs**: `x-ratelimit-*` into `provider_quota` with `observed_at`, keeping the previous reading so drift is computable.
- `backend/test/fixtures/ors/*.json` — recorded responses, committed with ODbL attribution so the suite runs offline.

**The two meters must not be conflated.** Ours is a daily call ceiling, one counter per endpoint, enforced by us and reset at UTC midnight. Theirs is a per-endpoint rate limit with **no window the provider states**, which we only observe. Ours can read nearly untouched just after midnight while the endpoint pool the next plan needs is three calls from empty. Store the number and the moment it was observed; label no period. Drift is a *rate*, not a level — compare the two most recent observations, and treat either counter going backwards as a fresh baseline rather than as drift.

**Files — modified**
- `.env` / `.env.example` — `ORS_API_KEY`, `ROUTING_PROVIDER=ors`.
- `docs/PROJECT-SCOPE.md` §8.3 — **record the measured rate limits.** That section currently carries a v3.4 claim of 200/50/100 against documented figures of 2,000/500 per day, explicitly marked unverified with no code in the repository producing it. If the low numbers hold, the documented quota is not the operative one and the guard's ceiling must be set against the header.

**Dependencies.** T-01, T-02.

**Definition of done**
- A truck route differs from a car route at a known low bridge.
- The guard throws on the call after the ceiling; the call is not made.
- Real rate-limit figures are measured and written into §8.3, replacing the unverified note.
- Every provider call emits a structured log keyed by request hash (§6 decision 18).
- Tests pass offline from fixtures.

---

## T-11 · Corridor query

**Priority 11.**

**Goal.** Candidate stations along a route, priced for a chosen date.

**Why.** §19 step 7.

**Files — new**
- `backend/src/planning/corridor.ts` — the §15.4 SQL: `ST_LineLocatePoint` for position, `ST_DWithin` for the screen, `resolution <> 'unresolved'`.
- `backend/src/planning/stratifiedTopK.ts`.
- Tests, including an integration test against a seeded database.

**The three requirements that are easy to get wrong**
- **(a)** No `product_codes` join in the hot path. `product_type` is denormalised onto `station_prices` at import and indexed as `(valid_on, product_type, station_id)`; §11.1's hard rule already keeps unmapped codes out of the table.
- **(b)** `LEFT JOIN LATERAL` for the price, never an inner join. An inner join makes a station with no price that day **vanish**, indistinguishable from one that was never near the route. Those must be counted and named in `exclusions` — "no price that day" and "not on this route" are different facts and only one is a data problem.
- **(c)** Top-K stratified **by position, not by price**. Prices cluster regionally — TX has 84 stations, CT has 1. The 40 cheapest on a Texas→Illinois run can all sit at one end, leaving 500 miles with no candidate, and the optimiser then reports a range gap across ground that had usable stations on it. Cut the route into 50-mile buckets and draw round-robin, cheapest within each bucket. Coverage first, price within it.

`valid_on` is an explicit date parameter, never an implied "current" flag. It is recorded on the plan as `price_as_of`, which is what makes a plan reproducible after the fact.

**Dependencies.** T-09, T-10.

**Definition of done**
- Candidates for a real lane return with position, perpendicular offset and unit price.
- A station with no price on `valid_on` appears in `exclusions`, not silently missing.
- Stratified top-K leaves no 500-mile stretch empty where stations existed — asserted against a synthetic price-clustered fixture.
- `unresolved` stations never appear.

---

## T-12 · Optimiser registry, `dp_v1`, `greedy_v1`

**Priority 12. Highest-risk ticket. Tests first.**

**Goal.** §13.1's pure strategy interface and §15.3's exact DP over `(station, fuel bucket)`.

**Why.** §19 step 8. The scope calls this the highest-leverage structural decision in the backend: every interesting bug will live inside a strategy, and they must run as a hundred table-driven cases in milliseconds without a container.

**Files — new**
- `backend/src/optimizer/types.ts` — `OptimizerInput`, `OptimizerResult`, `OptimizerStrategy`.
- `backend/src/optimizer/registry.ts` — `OPTIMIZERS`, keyed by the id persisted to `plans.optimizer_strategy`.
- `backend/src/optimizer/dp_v1.ts` — Phase A purchase relaxation in place, Phase B drive transitions. 2-gallon buckets, **rounding down on arrival fuel** so discretisation never manufactures range that does not exist.
- `backend/src/optimizer/greedy_v1.ts` — reference baseline only. Note the classic rule is **nearest cheaper**, not cheapest within range (§22.3).
- `backend/src/optimizer/dp_v1.test.ts` — table-driven, all §15.6 cases.
- `backend/src/optimizer/model.ts` — the fuel model both strategies share (2-gallon buckets, leg bounds, infeasibility diagnosis), so a diff between them means something.
- `backend/src/planning/optimizerInput.ts` — `toOptimizerLane`, the plain mapping from a corridor result to the optimiser's lane. It converts nothing: T-52 moved the corridor to miles, so no unit crosses here.

**Rules that keep this modular.** No I/O in a strategy — no database, no HTTP, no clock. Strategies are interchangeable on identical input; running two and diffing is a supported workflow. Adding one is a new file plus a registry entry, nothing else.

**The retry does not live here.** §5.1's two-pass relaxation belongs to the planning service (T-13). `solve()` stays pure.

**Dependencies.** T-01 only. **Deliberately off the critical path** — it is a pure function over fixtures, so it can be built in parallel with T-10 and T-11.

**Definition of done — every §15.6 case passes, with no database and no network**
- single candidate; zero candidates; candidate at mile 0
- monotonically rising prices; monotonically falling prices
- gap exactly 500 miles accepted; **501 rejected**
- gap exactly 300 miles accepted; **299 rejected**
- a station 200 miles out that is cheapest but violates the floor
- **final leg under 300 miles — ACCEPTED.** No floor applies on arrival; this is a frequent off-by-one source and gets its own test.
- destination exactly 500 miles from the last stop
- arrival reserve forcing a larger purchase
- **a cheap station early where carrying fuel forward beats a later expensive mandatory stop.** This is the case that distinguishes the DP from a shortest path; without it the suite does not prove the algorithm does anything a greedy could not.
- `maxStops` binding
- `dp_v1` never costs more than `greedy_v1` on the same input.

---

## T-13 · Validation loop and two-pass relaxation

**Priority 13.**

**Goal.** The 500-mile guarantee verified against measured distances rather than predicted ones.

**Why.** §19 step 9, and §19's own note on ordering: everything upstream measures distance along the *baseline* polyline, and inserting a stop can change which highway the router picks. Until waypoints are inserted and legs re-measured, the guarantee is an assertion — and an assertion like that should not be given an endpoint to serve it from.

**Files — new**
- `backend/src/planning/validationLoop.ts` — DP → route with vias → re-check caps against **real** legs → recompute → **cap at 3 iterations** → `Infeasible(NO_STABLE_PLAN)`.
- `backend/src/planning/relaxation.ts` — solve at `min_leg = 300`; if infeasible, re-solve at `0` and attach `MIN_LEG_RELAXED` naming the short legs. A plan with a 280-mile leg and a clear warning beats a dead end.
- Tests beside each.

**Dependencies.** T-11, T-12.

**Definition of done**
- Legs are re-checked against measured distances, not baseline ones.
- Convergence on the first or second pass on real lanes; the 3-iteration cap returns `NO_STABLE_PLAN` rather than looping.
- A lane feasible only after relaxation sets `plans.min_leg_relaxed` and emits `MIN_LEG_RELAXED` with the short legs named.
- `solve()` remains pure — the retry is in the service, asserted by the optimiser tests still needing no I/O.

---

## T-14 · Detour costing

**Priority 14.**

**Goal.** §15.4.1's bracket model, replacing the naive round-trip measurement.

**Why.** §19 step 10. "Route to the station and double it" does not work: a truck cannot turn around on a controlled-access highway, so a router asked for that trip correctly returns a long one. The provider is right; the question is wrong. The truck is already driving past and will use the interchange that serves the station.

**Files — new**
- `backend/src/planning/detour.ts` — `detour = d(before → station) + d(station → after) − d(before → after)`, with `before`/`after` ten miles either side via `ST_LineInterpolatePoint`. `d(before → after)` is the route's own arc length — already known, **never requested from the provider**.
- `backend/src/planning/detourEstimate.ts` — the filter stage: `d ≈ 2 × perp_offset_miles × 1.35`, and `d = 0` when `perp_offset_miles < 0.124` (200 m).
- Tests.

**Two matrix calls, not one.** The legs point in opposite directions and a single call covering both needs a 2N × 2N grid — 5,184 pairs at N=36, past what ORS accepts. Two N × N calls stay well inside the limit.

**Keep the estimate beside the measurement.** `estimatedDetourMiles` is never overwritten by the measured value. That comparison is the only evidence that would ever show the 1.35 multiplier badly chosen, and per v3.4 it is what caught the naive model's error in the first place.

**Files — modified.** `docs/PROJECT-SCOPE.md` §15.4.1 — replace the unverified v3.4 figures (LOVES #759 at 38 mi naive vs 1.98 mi bracket; MAE 9.8 → 2.4 mi) with measurements from this build, and record the real ORS matrix ceiling against the claimed 50 × 50.

**Dependencies.** T-10 (`matrix()`), T-11 (`perpOffsetMiles`, `offsetAlongRouteMiles`, `stratifiedTopK`), T-12 (`OptimizerCandidate`, which `toOptimizerLane` fills). It calls nothing from T-13's validation loop; it was sequenced after T-13 by priority, not by code.

**Decided, 21 September 2026.**
- **Chunking.** Two N × N calls hold while N fits the provider's per-call ceiling (`MAX_MATRIX_SIDE`, set from step 14.3's measurement). `stratifiedTopK` widens past K = 40 on lanes over 2,000 miles, so a longer lane chunks into diagonal blocks — 2 × ⌈N / side⌉ calls. Never a 2N × 2N grid.
- **Route ends.** `before` and `after` clamp to the route (`max(0, s − 10)`, `min(L, s + 10)`), and the term subtracted is the clamped arc, not a fixed 20 miles. A measured detour below 0 is floored at 0 for the optimiser, with the raw figure kept beside it.
- **Cache.** A matrix-result cache is **not** in this ticket; see T-16.

**Definition of done**
- `detourEstimateError()` reports the estimate-vs-measurement gap.
- A station a tenth of a mile off the route measures a small detour, not a tens-of-miles one.
- Matrix calls are two N × N, never one 2N × 2N.
- §15.4.1's unverified figures are replaced with measured ones.

---

# Phase 4 · API

## T-15 · Address geocoding and `saved_locations`

**Priority 15.**

**Goal.** `POST /plans` accepts `{address}` or `{lat,lng}`.

**Why.** §19 step 11.

**Files — new**
- `backend/src/catalog/geocode.ts`.
- `backend/src/catalog/savedLocations.ts` — keyed on normalised address, **30-day expiry** per §17's provider cap.
- Tests.

**Cache the geocode, never the plan.** §4.3 measured a median 41¢/gal daily swing per station; yesterday's cheapest route for the same lane is not today's. Always re-plan.

**Dependencies.** T-02, T-10 — T-02 owns `saved_locations`; T-10 owns the budget guard and quota observer this ticket's provider calls go through.

**Definition of done**
- Both input shapes resolve.
- A repeat address hits the cache and increments `use_count`.
- An expired row is re-geocoded, not served stale.
- No provider geocode is ever written to `stations.geom` — that would mean re-geocoding 605 stations every 30 days forever, or being out of compliance.

---

## T-16 · Plan orchestration, `POST /plans`, `GET /plans/{id}`

**Priority 16.**

**Goal.** An end-to-end plan on a real lane, persisted and re-fetchable.

**Why.** §19 step 12.

**Files — new**
- `backend/src/planning/planService.ts` — geocode → baseline route → corridor → optimise → validate → detour → persist.
- `backend/src/api/routes/plans.ts` — `POST /plans`, `GET /plans/{id}`.
- `backend/src/api/problem.ts` — RFC 9457 errors.
- `backend/src/cli/serve.ts` — local mount, binds `127.0.0.1`, no session check.
- Tests including an end-to-end integration test.

**Synchronous, by decision.** The request computes in-process and returns the finished result — the same body `GET /plans/{id}` returns, not a job reference. This follows §6 decision 19 (no queue) and §10's measured 3–10s solve, and it is why `plans.status` has no in-progress states. `GET /plans/{id}` exists to re-fetch later, not to poll one still computing.

**`plans.status` has exactly two values.** `completed` and `infeasible`. An infeasible plan is a legitimate answer and is persisted with its structured `reason`, gap miles and suggestions, **and still returns `candidateStations`** so the dispatcher can fall back to judgement rather than hitting a dead end. Given §4.4's thin coverage in CT/NJ/WV/MD/SD/ID/MN/MT, this will fire on real lanes. A technical failure — provider timeout, budget guard, unhandled exception — is **not** persisted; it returns an RFC 9457 error.

**The parameter split this ticket must introduce.** UI contract §5.3 is right that §14's single `maxDetourMiles` is doing two different jobs. Two parameters are needed and §15.1's constraint list gains the second:
- `corridorMiles` — a straight-line **screening** radius, inflated by each station's uncertainty, deciding what is considered at all.
- `maxDetourMiles` — a **post-routing** cap on one station's actual round-trip drive. Nullable; blank means no cap.

**Files — modified.** `docs/PROJECT-SCOPE.md` §14 and §15.1 — record the split.

**Matrix-result cache — decided here, not in T-14 (21 September 2026).** Matrix is the binding provider limit (50 a day = 25 plans), so a re-run of the same lane should spend no matrix calls. Key it on the exact matrix request (the hash `OrsRoutingProvider.call` already computes), as a decorator at the provider seam. Prices pick the shortlist, not the route, so a different day's prices give a different request and a different key; reuse is therefore same-day in practice and needs no separate age rule — but say so in the test. It is a persistence design (a table, and a retention rule), so it is scoped and migrated here, not folded into T-14.

**Schema mismatch to resolve here.** `plans.max_detour_miles` is `NOT NULL` (`migrations/0001_planning_schema.sql`) while the request's `maxDetourMiles` is nullable ("no cap"). Persisting a plan with no cap would fail or coerce `null` to `0`, which CLAUDE.md forbids. Make the column nullable (editable until the first deploy, D21).

**Dependencies.** T-13, T-14, T-15, T-04B — the plan orchestration service and the routes that call it are the first code to pull `backend/src/planning`, `optimizer`, `routing` and `catalog` through the Next mount, exactly the deep import chain T-04B's package boundary exists for.

**Definition of done**
- A real lane returns a complete plan with stops, totals and `priceAsOf`.
- An infeasible lane persists with `status = 'infeasible'`, a structured reason and candidates.
- `solveMs` and `stationsScanned` are on the response (UI contract §6.7).
- Resolved origin/destination coordinates are echoed back (UI contract §6.10).
- `?units=metric` converts at the boundary; storage stays miles + gallons.
- Nulls survive the round trip and are not coerced to `0`.

---

## T-17 · Google Maps URL and disclaimers

**Priority 17.**

**Goal.** The dispatcher's deliverable to the driver, with its caveat attached.

**Why.** §19 step 13.

**Files — new**
- `backend/src/planning/googleMapsUrl.ts` — `origin`, `destination`, up to 9 `waypoints`, `travelmode=driving`. 1–4 stops fits comfortably.
- `backend/src/planning/disclaimers.ts`.
- Tests, including one that pins the exact wording.

**Disclaimers ship in the payload, not the frontend, so the frontend cannot omit them.**
- `GOOGLE_LINK_NOT_TRUCK_LEGAL` — **always fires.** The link gives the driver a *car* route: stops correct, roads unchecked for truck restrictions. No worse than today's process, but a real gap between what is computed and what is driven.
- `ACCESSIBILITY_UNVERIFIED` — only when a plan actually contains an unverified stop. A disclaimer that always fires is one nobody reads.
- `MIN_LEG_RELAXED` — only when §5.1's second pass ran, naming the short legs.
- `PRICE_STALENESS` — **always fires**, carrying `priceAsOf` (confirmed against §14's sample payload, which fires it unconditionally alongside `GOOGLE_LINK_NOT_TRUCK_LEGAL`).

**Dependencies.** T-16. **Needs Q5** — your sign-off on the wording, which the test then pins.

**Definition of done**
- The URL opens in Google Maps with every stop as a waypoint in order.
- The two always-on disclaimers are present on every plan; the two conditional ones fire only in their conditions.
- Wording is asserted by a test, so it cannot drift silently.

---

## T-18 · Supporting read endpoints

**Priority 18.**

**Goal.** Everything `UI-DATA-CONTRACT.md` §6 needs that §19 never scheduled.

**Why.** §19 collapses this into steps 12 and 15. The UI contract lists twelve backend additions beyond §14; without them large parts of the Plan tab cannot be built at all.

**Files — new**
- `backend/src/api/routes/priceSheets.ts` — `GET /price-sheets` → `effectiveOn`, `importedAt`, `rowCount`, `stationCount` (derived from `station_prices`), newest first. The sheet picker cannot exist without it.
- `backend/src/api/routes/stations.ts` — `GET /stations?bbox=&resolution=`, paged; `GET /stations/{id}/prices`.
- `backend/src/api/routes/truckProfiles.ts` — `GET /truck-profiles` for the Dev Tools truck-profile panel (`UI-DATA-CONTRACT.md` §5.1). **Not** the fleet/header truck selector — see T-21's A16 amendment and D23 for that endpoint (`GET /trucks`, T-37/T-38-era).
- `backend/src/api/routes/health.ts` — DB, provider reachability, **both** call meters shown separately, latest sheet date. Not exempt from auth.
- Tests.

**Files — modified**
- `backend/src/api/routes/plans.ts` — add `GET /plans` as a **list projection** with pagination, not full payloads; accept `priceEffectiveOn` on `POST /plans` so a lane can be re-priced against a historical sheet.
- `backend/src/domain/planResponse.ts` — fully specify `candidateStations[]`, which §14 leaves as a comment stub. Three separate parts of the Plan tab consume it (dot layer, hover card, cheapest-along-route list), so at minimum: `id`, `name`, `city`, `state`, `location`, `unitPriceUsd`, `distanceAlongRouteMiles`, `detourMiles`. Each needs a **stable `id`** so the frontend can diff against `stops[]`. Also add `detourCostUsd` plus the `costPerMile` used to compute it, and **separate drive time from dwell time** so the "excludes time at the pump" caption is true.

**Dependencies.** T-16. **Needs D6** and the open trip-reference and status-vocabulary questions.

**Definition of done**
- Every one of UI contract §6's twelve items is served or explicitly deferred with a reason.
- `GET /price-sheets` lists the January backfill plus August, newest first, with correct `stationCount`.
- `GET /plans` paginates and returns a projection, not full plans.
- `GET /health` shows the two meters **separately** — a single "calls remaining" figure would hide whichever is about to bite.

---

## T-19 · `sentToDriver` write path

**Priority 19.**

**Goal.** Dispatcher bookkeeping that survives a reload.

**Why.** UI contract §3.10 and §6.11. `plans.dispatched_at` exists in §12 but **nothing writes it** — in v1 it carries no weight until a caller does. Phase 3 backtesting depends on it, because reconciling receipts against every exploratory plan a dispatcher discarded would manufacture false mismatches.

**Files — new**
- `backend/src/api/routes/planPatch.ts` — `PATCH /plans/{id}` with `{ sentToDriver }`, recording `dispatched_at` and the acting user.
- Tests.

**Files — modified.** `backend/src/domain/planResponse.ts` — add `sentToDriver` and `sentToDriverAt` for the Recent table.

**Semantics: a flag only.** It does not freeze the plan or stop re-pricing. It is deliberately a checkbox rather than a status badge because it is a third axis alongside solve status and trip lifecycle.

**Dependencies.** T-18.

**Definition of done**
- Ticking persists; reopening the plan shows it still ticked.
- `dispatched_at` and the acting user are recorded.
- The Recent list projection can show *when*.

---

## T-20 · Route geometry retention job — **DEFERRED, not in v1**

**Deferred 10 September 2026.** §17 was revised to drop route-geometry expiry from v1: ORS is the only routing provider, ODbL carries no storage cap, and stored geometry only ever redraws a historical plan rather than being planned against — so there is nothing for a retention job to do. There is no `routes.expires_at`, no expiry trigger, and no `geometryExpired` response field to serve.

**Do not build this ticket** until a contractually capped provider (HERE, Google) is adopted. It is kept in the register because the design below is worked out and should not be rediscovered.

**The trigger for reinstating it.** Adopting HERE or Google. §7's named triggers for that decision are unchanged. At that point this ticket comes back together with the provider-aware `expires_at` column and trigger specified in §17, and T-24 regains it as a dependency.

**What it will need when it comes back**
- `backend/src/cli/expireGeometry.ts` — nulls `line`, `polyline`, `legs` and any raw provider payload on expired rows. **The row itself stays** — `origin_geom`, `destination_geom`, `truck_profile_id`, `distance_miles` and `duration_s` survive, so geometry can be re-fetched later without asking the dispatcher to re-enter anything.
- `backend/src/domain/planResponse.ts` and the plan serialiser — return `geometryExpired: true` instead of a broken polyline. Nothing is recomputed and no provider call is made just to display one.
- Tests.

**The distinction that is costly to get wrong in either direction — and which still applies in v1.** `routes` is a cache. `plans` and `plan_stops` are the record and are permanent. Nulling `plan_stops` on the theory that its distances are provider-derived destroys the audit trail needed to reconcile against driver receipts — which is exactly why `plan_stops` stores `unit_price_usd` as a literal beside the foreign key rather than relying on a join.

**Re-fetching is one `route()` call and writes to `routes` only** — never to `plans` or `plan_stops`. **This rule holds in v1 already**, independent of expiry: a refreshed line reflects *today's* road network, so stored totals stay authoritative and the fresh line is an approximate shape.

**Dependencies.** T-16, plus adoption of a capped provider.

---

# Phase 5 · Frontend

## T-21 · Frontend API client, retire the mock

**Priority 21.**

**Goal.** Real data behind the components.

**Why.** §19 step 15, first half. T-04 already typed the components against `PlanResponse`, so this is a data-source swap rather than a rewrite.

**v2 note (read before starting).** This ticket predates the sidebar redesign
(D15/A7) and the real fleet roster (`trucks`, T-25) — both change its scope.
See `PROJECT-SCOPE-v2.md` A16's amended T-21 note and `UI-DATA-CONTRACT.md` §2
before touching `Header.tsx`. In short: **build against the existing v1 tab
bar, not a sidebar** — T-39 (v2) owns building the sidebar shell and re-hosts
this ticket's finished screens into it afterward, so building one here would
be duplicate, throwaway work. And the truck selector is **not** `truck_profiles`
— see below.

**Files — new**
- `frontend/src/lib/api.ts` — typed client over `/api/v1`.
- `frontend/src/hooks/usePlan.ts`, `useTruckProfiles.ts`, `useTrucks.ts`, `usePriceSheets.ts`.

**Files — modified**
- `page.tsx` — state from the API instead of `trips[0]`.
- `Header.tsx` — the truck selector, wired for a short lifespan (T-39 absorbs
  this file almost immediately after): put the real-data logic in
  `useTrucks.ts`, not inline in the component, so T-39 can lift the hook into
  `TopBar.tsx`/New Plan without redoing the wiring.
- `PlanTab.tsx` — live plan; the sheet picker driven by `GET /price-sheets`, with the amber archived state keyed on "not index 0".
- `RecentTab.tsx` — the `GET /plans` projection with pagination.
- `DevToolsTab.tsx` — every field currently uncontrolled and inert becomes a real `POST /plans` input, including the new `corridorMiles` / `maxDetourMiles` split from T-16.
- `RouteMap.tsx` — fed real stops; still the placeholder canvas until T-22.

**Files — deleted.** `frontend/src/data/trips.ts`. It was a design artefact, not a stub to fill in, and it has served its purpose.

**Dependencies.** T-18, T-38.

**Definition of done**
- No component reads from a local fixture.
- "Plan route" issues a real `POST /plans` and renders the result.
- **The truck selector lists the real fleet roster** (`GET /trucks` with no
  `period`, D23 — `PROJECT-SCOPE-v2.md` A15), by `unit_number` exactly as
  stored (no zero-pad — D18 superseded D6), and selecting one sets
  `plans.truck_id` (T-38/D22) on the request. `truck_profiles` stays a
  separate, required field (`truckProfileId`) for the optimiser's tank/mpg
  class — the two are not interchangeable (A16's T-03 note).
- The sheet picker lists real imports and re-prices the lane.
- Every displayed string is composed frontend-side from a number.
- `GET /plans`' list projection (used by `RecentTab.tsx`/T-39's Plans screen)
  carries enough to render the design's Plan list `Truck` column — join
  through to `unit_number`, not just `truck_id`.

---

## T-22 · MapLibre map

**Priority 22.**

**Goal.** A real map replacing the fake diagonal.

**Why.** §19 step 15, second half. `RouteMap.tsx` currently positions every pin by array index through `pinPos()`.

**Files — new**
- `frontend/src/map/style.ts` — OpenFreeMap base; swapping to MapTiler or Protomaps later is a style-URL change.
- `frontend/src/map/layers.ts` — the five §9.3 layers: `route-baseline` muted and dashed, `route-optimized` prominent and solid, `stations-selected` numbered with hover popups, `stations-candidate` small dots and toggleable, `endpoints` distinct icons.

**Files — modified**
- `RouteMap.tsx` — **rewritten.** `pinPos()` and the placeholder geometry go; pins come from `stops[].station.location`. A `city`-tier station also draws an **uncertainty circle** of radius `uncertaintyMiles`, so the dispatcher can see that a pin is a town rather than a forecourt. MapLibre circle radii need **metres**, so the map converts at render (T-52 moved storage and the API to miles).
- `App.css` — map container styles; the existing design tokens are reused, not replaced.
- `frontend/package.json` — add `maplibre-gl`.

**Dependencies.** T-21.

**Definition of done**
- Both routes render in their §9.3 styles, bounds fitted.
- Numbered pins sit at real coordinates; hover shows the §3.2 six-row card.
- Candidate dots toggle; `city`-tier pins draw their uncertainty circle.
- Attribution from the API response is displayed — under ODbL a licence condition, not a courtesy.

---

## T-23 · Missing UI states

**Priority 23.**

**Goal.** Render everything the API can return.

**Why.** `UI-DATA-CONTRACT.md` §8. None of these can be expressed today, and the payloads arrive before there is anywhere to put them.

**Files — new**
- `frontend/src/components/InfeasiblePanel.tsx` — the structured reason, gap miles, suggestions and the candidates the API still returns. Currently a rich payload with nowhere to go.
- `frontend/src/components/Disclaimers.tsx` — the API guarantees at least one entry on every plan and the design surfaces none of them. `GOOGLE_LINK_NOT_TRUCK_LEGAL` needs a home in the driver-link card, whose footnote is currently generic marketing copy rather than the warning.
- `frontend/src/components/EmptyState.tsx` — no recent trips, no candidates, no sheet imported.

**Files — modified**
- `PlanTab.tsx` — add the **second** layer toggle (drift item 1). Two buttons with different counts from different sources: `Show all sheet stations` from `GET /price-sheets`'s `stationCount` over a bbox-paged station layer, and `Show in-corridor not selected` from `candidateStations[]` minus chosen. The two counts must not be conflated. Add the **"Sent to driver" checkbox** (drift item 2) wired to T-19. Make the "within the leg bounds" caption conditional on `MIN_LEG_RELAXED`, and the "excludes time at the pump" caption honest against separated drive/dwell time.
- `RecentTab.tsx` — style an `infeasible` row, which the design has no styling for.
- `page.tsx` — a request-in-flight spinner around the single synchronous `fetch`. Not a poll — but 3–10s is long enough that the UI cannot render nothing.

**Dropped from this ticket:** the `geometryExpired` empty map state. Route geometry does not expire in v1 (§17), so the field is never returned and the state is unreachable. It returns with T-20 if a capped provider is adopted.

**Dependencies.** T-21, T-22.

**Definition of done**
- An infeasible plan renders its reason, suggestions and candidates.
- Disclaimers are visible on every plan; the truck-legality warning sits in the driver-link card.
- Both toggles show independently-sourced counts.
- The solve spinner covers the full request.
- Geocode failure and provider outage have distinct error states.

---

# Phase 6 · Ship

## T-24 · Deployment — Vercel + Neon

**Priority 24.**

**Goal.** v1 live.

**Why.** §19 step 16.

**Files — new**
- `vercel.json` — root directory `frontend`, workspace install from the repo root.
- `docs/RUNBOOK.md` — ingest cadence, backfill, retention job, meter checks.

**Files — modified**
- `.github/workflows/ci.yml` — **built in T-01 (D10), extended here** with a production Next build and a deploy concurrency guard.
- `package.json` (root) — production scripts.
- `docs/PROJECT-SCOPE.md` §2 — rewrite "Where the project actually stands", which currently describes a repository with no backend.

**Neon and migrations.** The runner from T-01 is the single path; D8 already removed the Docker-only route. **No retention cron** — T-20 is deferred (§17), so v1 deploys with no scheduled job at all.

**Dependencies.** T-05, T-23. **Needs Q6.**

**v2 note.** As scoped, this ticket has no dependency on T-39 — it could ship
the v1 tab-bar UI to production shortly before T-49 replaces it with the
sidebar-redesigned merged app. Given D11 ("one repository, one deployment"),
confirm whether a standalone v1 production milestone is still wanted, or
whether T-24 should fold into T-49 once Phase 9 is underway, before picking
this up.

**Definition of done**
- A real lane plans end-to-end in production.
- Auth protects every route; anonymous API calls get 401, pages 307.
- Migrations apply to Neon through the runner.
- ~~The retention cron runs daily.~~ **No cron** — T-20 is deferred (§17); this
  bullet contradicted the ticket body above and predates that decision.
- CI blocks a merge on a failing drift test.
- Attribution is visible in the deployed UI.
