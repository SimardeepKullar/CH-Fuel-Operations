# Build plan — CH Fuel Planner v1

**Document version:** 1.0 — 6 September 2026
**Companion:** `TICKETS.md` holds the ticket register — goals, file lists, dependencies and definitions of done. This document breaks each ticket into steps.
**Authority:** `PROJECT-SCOPE.md` is the specification. Section references below (§4, §11.1, §15.3 …) point into it.

---

## How to use this

Every ticket is decomposed into **steps that can be implemented and tested one at a time**, in dependency order. Each step gives:

- **Goal** — the one thing the step achieves.
- **Files** — created, modified, and where it matters, *left alone and why*.
- **Logic** — the interfaces and rules involved, and how they meet existing code.
- **Tests** — specific cases including edge cases, and what counts as pass.

Work one step at a time. A step is finished when its tests pass, not when the code is written. Steps within a ticket are sequential unless marked parallel-safe.

### Conventions

- Tests are co-located as `*.test.ts` beside the unit under test. Anything needing a live database goes in `backend/test/integration/` and is skipped when `DATABASE_URL` is unset.
- Storage is **miles and gallons**; conversion happens at the API boundary only (§6 decision 16).
- No strategy or pure function performs I/O — no database, no HTTP, no clock.
- "Pass" means an assertion, not an eyeball, except where a step explicitly calls for visual confirmation.

### Working state this plan starts from

Measured 5–6 September 2026. There is no backend, no TypeScript, no test runner, and the sole migration does not parse. `backend/` and `scripts/` exist but are empty. The frontend is a Vite + React 19 mock in plain JSX reading a hard-coded fixture. Full detail is in `TICKETS.md` under *Current state, as measured*.

---

# Phase 0 · Foundation

## T-01 · Toolchain and workspace skeleton

### Step 1.1 — Create the `backend` workspace

**Goal.** A second workspace that compiles and type-checks.

**Files.** New: `backend/package.json` (`@ch/core`, `type: module`), `backend/tsconfig.json`, `.nvmrc` (Node 22). Modified: root `package.json` — add `backend` to `workspaces`, add a `typecheck` script, and **remove `"main": "index.js"`**, which points at a file that has never existed.

**Logic.** `strict: true` plus `noUncheckedIndexedAccess: true`. The latter matters more than usual here: the DP in T-12 indexes bucket arrays constantly, and an unchecked index is exactly the class of bug that produces a plausible-but-wrong plan.

**Tests.**
- `npm run typecheck` exits 0 against an empty `src`.
- `npm ls --workspaces` resolves both workspaces.
- **Pass:** no `tsc` error, both workspaces linked.

### Step 1.2 — Wire up vitest

**Goal.** A test command that runs and reports.

**Files.** New: `backend/vitest.config.ts`, `backend/src/domain/units.ts` + `units.test.ts`. Modified: root `package.json` — replace the `test` stub, which today is npm's default `echo "Error: no test specified" && exit 1`.

**Logic.** `units.ts` carries metres↔miles, gallons↔litres, and `formatUnitNumber()` — the D6 three-digit zero-pad turning `22` into `022`. Writing it first gives step 1.2 something real to assert against instead of a placeholder test.

**Tests.**
- Round-trip 1609.344 m → 1 mi → 1609.344 m within 1e-9.
- `formatUnitNumber(22)` → `"022"`; `(7)` → `"007"`; `(1234)` → `"1234"` (no truncation).
- **Pass:** `npm test` runs vitest, all green, non-zero test count.

### Step 1.3 — Database pool and migration runner

**Goal.** `npm run db:migrate` applies `migrations/*.sql` idempotently.

**Files.** New: `backend/src/db/pool.ts`, `backend/src/db/migrate.ts`, `backend/.env.example`. Modified: `docker-compose.yml` — **remove** `./migrations:/docker-entrypoint-initdb.d:ro`; root `package.json` — `db:reset` becomes `down -v && up -d` then migrate; `.env` — populate (currently 0 bytes).

**Logic.** The runner creates `schema_migrations (filename text primary key, applied_at timestamptz)`, then applies each unapplied file in filename order inside a transaction. `pool.ts` exposes `query<T>(text, params)` and **accepts parameters only** — no string interpolation of values anywhere, which is the whole safety story under D1.

**Why the compose change.** The init mount only fires on a *fresh* volume and has no counterpart on Neon. Keeping both would mean a fresh local volume applies `0001` via init without recording it in `schema_migrations`, after which the runner applies it again and fails. One path, everywhere.

**Tests.**
- Against a clean volume: `db:migrate` applies all files; a second run applies zero.
- A file that throws mid-way leaves `schema_migrations` without its row (transaction rolled back).
- Files apply in filename order, asserted with two throwaway migrations.
- `docker compose config` validates.
- **Pass:** all four hold; re-running is a genuine no-op.

### Step 1.4 — CI and git hooks

**Goal.** The merge gate exists before the first ticket is merged.

**Files.** New: `.github/workflows/ci.yml`, `.githooks/pre-commit`, `.githooks/pre-push`, `.github/pull_request_template.md`. Modified: root `package.json` — add `verify`, `test:unit`, and a `prepare` script setting `core.hooksPath`.

**Logic.** The workflow runs the **same** `npm run verify` a developer runs — CI has no test suite of its own to maintain. What it adds is the environment: a clean checkout on Linux with a fresh PostGIS service container and a pinned Node 22.

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: ch_fuel
          POSTGRES_PASSWORD: ch_fuel
          POSTGRES_DB: ch_fuel_planner
        ports: ['5433:5432']
        options: >-
          --health-cmd "pg_isready -U ch_fuel -d ch_fuel_planner"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_planner
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npm run db:migrate
      - run: npm run verify
```

**Hooks split by cost, so neither is worth bypassing.** `pre-commit` runs `typecheck && lint && test:unit` — fast, no database. `pre-push` runs the full `verify`. Installed via `git config core.hooksPath .githooks` from `prepare`, so there is no husky dependency.

Hooks are convenience; **CI is the gate.** A hook can be skipped with `--no-verify` and exists only on the machine that ran `npm install`.

**Why this is in T-01 and not T-24.** Under one-branch-per-ticket, a gate introduced at the end would leave the preceding 23 merges unverified. The gate has to exist before the first merge or it is not a gate.

**Tests.**
- CI passes on the T-01 branch.
- A deliberately failing test **fails** the PR check — verify the gate before trusting it.
- `pre-commit` rejects a commit that fails typecheck.
- `pre-push` rejects a push that fails the full suite.
- CI runs green with **no `.env` present**, proving nothing depends on an untracked local file.
- **Pass:** all five.

---

## T-02 · Rewrite the database schema

### Step 2.1 — Reference, user and truck tables

**Goal.** The first third of §12 applies cleanly.

**Files.** New: `migrations/0001_init.sql` — **replaces** the existing file wholesale. The current one has never successfully applied and holds no data, so §12.1's recommendation is a rewrite rather than an `ALTER` chain.

**Logic.** `place_centroids`, `product_codes`, `users`, `saved_locations`, `truck_profiles`. Key rule per D3: `uuid` for URL-exposed, composite natural keys for reference tables.

Two changes beyond a transcription of §12:
- `truck_profiles.reserve_fraction` defaults to **0.150**, not the current file's `0.100` (D2). This is the only column that decision touches.
- `users` gains **`password_hash text NOT NULL`** and **`display_name text NOT NULL`**. §12's `users` has neither, so the login page in T-05 cannot be built against it as specified. `display_name` also feeds the header chip (UI contract §2).

**Tests.**
- `db:reset` applies with no error — the single most important assertion in this ticket, since the current file fails at line 79.
- `reserve_fraction` default reads `0.150`.
- `CHECK (min_leg_miles <= max_leg_miles)` rejects `min 600 / max 500`.
- `role` rejects a value outside the enum.
- The partial unique index permits the same `slug` under two different owners.
- **Pass:** all constraints fire as specified.

### Step 2.2 — Stations, imports and prices

**Goal.** The ingest target exists and enforces its keys.

**Files.** Modified: `migrations/0001_init.sql` (continues).

**Logic.** `stations` with `UNIQUE (supplier, site_ref)` — not the current file's bare `site_ref UNIQUE`, which breaks the moment a second supplier shares a site ID. Plus the §11.4 resolution columns, §11.5 accessibility, and `city_raw`/`city_normalized` as a pair.

`price_imports.effective_date` **loses its `UNIQUE`** (§12.1 item 2). The SHA-256 already provides idempotency; the constraint adds nothing and forbids a legitimate corrected re-send or a second supplier's sheet for the same day. A plain index on `(supplier, effective_date)` replaces it.

`station_prices` renames `effective_on` → `valid_on`, re-keys to `UNIQUE (station_id, raw_product, valid_on)`, and adds the generated `price_pump` and `price_ifta_net` columns. Keying on `raw_product` rather than the mapped type preserves the ability to carry two raw codes mapping to one type.

**Tests.**
- Same `(supplier, site_ref)` twice → rejected; same `site_ref` under different suppliers → accepted.
- Two imports, same `effective_date`, different hashes → **both accepted**. Same hash twice → rejected. This pair is the §12.1 item 2 regression test.
- `price_ifta_net` computes `cost + freight + other + federal_tax` and treats nulls as zero.
- `UNIQUE (station_id, raw_product, valid_on)` rejects a genuine duplicate.
- `resolution` rejects a value outside `exact`/`city`/`unresolved`.
- **Pass:** all six.

### Step 2.3 — Routes, plans, stops and meters

**Goal.** The business record and the cache exist.

**Files.** Modified: `migrations/0001_init.sql` (completes).

**Logic.** `routes` with **nullable** `line`/`polyline`/`legs` — the current file has them `NOT NULL` — plus `provider`. **No `expires_at` and no expiry trigger** (§17, decided 10 September 2026): ORS is ODbL, carries no storage cap, and stored geometry only ever redraws a historical plan rather than being planned against. Geometry stays nullable regardless, so adopting a contractually capped provider later needs a job rather than a migration.

Then `plans`, `plan_stops`, `import_batches`, `import_rejections`, `provider_usage`, `provider_quota`. `plans.status` has exactly two values — `completed` and `infeasible` — because there is no async job model to hold an in-between state.

**Tests.**
- `routes` has **no `expires_at` column** and **no expiry trigger** — asserted against `information_schema`, so a future reinstatement is a deliberate act rather than a silent one.
- Nulling `line`, `polyline` and `legs` on an existing row succeeds.
- `plans.status = 'pending'` is rejected.
- `UNIQUE (plan_id, seq)` rejects a duplicate stop sequence.
- Deleting a plan cascades to `plan_stops`; deleting a `station` referenced by a stop is **refused**.
- **Pass:** all five.

### Step 2.4 — Schema descriptor and drift test

**Goal.** Code and database cannot drift silently.

**Files.** New: `backend/src/db/schema.ts`, `backend/src/db/types.ts`, `backend/test/integration/drift.test.ts`.

**Why the test is not at `src/db/drift.test.ts`** as first specified: it needs a live database, and `test:unit` — the pre-commit gate, which declares itself "Fast gate: no database" — excludes `test/integration/` by path. Under `src/` it would run inside that gate and fail whenever Docker was not up. `diffSchema()` itself is pure and lives in `schema.ts`, so the fault-injection cases need no database.

**Logic.** §12.2 assumes a query builder whose schema definition doubles as the mirror. Under D1 there is no such definition, so `schema.ts` is a hand-maintained descriptor — table, column, type, nullability, default, constraint — compared against `information_schema` on every test run. It costs discipline and buys the same guarantee.

Note the direction of authority: the drift test checks code against the database. Neither checks *this document*. When they disagree with §12, the migration wins and §12 gets edited.

**Tests.**
- Descriptor matches `information_schema` exactly for every table.
- A deliberately wrong nullability in the descriptor **fails** the test — proving it detects rather than rubber-stamps.
- A column present in the database but absent from the descriptor fails.
- **Pass:** green on a correct schema, red on both injected faults.

---

## T-03 · Seed reference data

### Step 3.1 — Truck profiles and the product code

**Goal.** Three profiles and the `ULSD` mapping.

**Files.** New: `migrations/0002_seed.sql`.

**Logic.** The §16 table exactly: `volvo-vnl-300` (150 gal, 6.5 mpg), `volvo-vnl-760` (200, 7.5), `volvo-vnl-860` (250, 7.2). All three carry `reserve_fraction 0.15`, `max_leg_miles 500`, `min_leg_miles 300`, and a placeholder `truck_number` (022 / 056 / 091) — dispatchers identify a truck by fleet number, not model name, so the selector needs one from day one even before the real roster is known. The 860 also carries the physical spec the router needs: 36,287 kg, 411 cm high, 259 cm wide, 2,250 cm long, 5 axles.

Product code: `('BVD','ULSD','highway_diesel','seed', now(), 'Confirmed from 2026-08-22 sheet')`. One row, and it is a **tripwire** rather than a lookup — its job is to fail an unmapped code, not to enrich a known one.

These MPG figures are sourced averages, not CH Logistics's fleet (§21 Q4). They drive every dollar the app reports, so they are the first number worth correcting.

**Tests.**
- Three profiles, each `is_system = true`, `reserve_fraction = 0.150`, `min_leg_miles = 300`.
- Re-running the migration does not duplicate (guarded by `slug` uniqueness).
- Exactly one product-code row.
- **Pass:** all three.

### Step 3.2 — Census gazetteer load

**Goal.** `place_centroids` populated for the tier-3 fallback.

**Files.** New: `scripts/load_gazetteer.py`, `scripts/requirements.txt`.

**Logic.** Places plus county subdivisions, restricted to the 50 states plus DC (§4.4 — US-only; also sidesteps a mojibake encoding issue in Puerto Rico's rows in the 2024 source file). Uncertainty `r = sqrt(ALAND_SQMI / π)`, stored as miles (the source unit) in `uncertainty_miles` — storage is miles everywhere (T-52 renamed the column from `uncertainty_m` and dropped the conversion to metres). Places carry an LSAD code naming their legal/statistical suffix exactly, so it is looked up, not guessed from text; County Subdivisions have no such code, so their suffix is matched against a documented vocabulary and left as-is when nothing matches. On a `(state, name)` clash, Places win. Python is explicitly permitted here by §7.1: one-time analysis whose deliverable is rows in a table, not code. It lives in `scripts/`, is run by hand, and **is never imported by application code**.

Name normalisation (post-suffix-stripping) must match `cityNormalize.ts` from T-09 — same case folding, same prefix expansion — or the join silently misses. Census names already arrive in the target convention ("McCalla", "Mount Vernon", "St. Augustine"); T-09 has to reproduce that convention from BVD's ALL-CAPS `city_raw`. Building them apart and asserting agreement is the point of the shared test in step 9.1.

**Tests.**
- All 50 states plus DC present.
- Every `uncertainty_miles` is positive and finite.
- Spot-check three known places against published coordinates within 1 km.
- A name with a `Mc`/`Mt`/`St` prefix is stored normalised.
- **Pass:** all four.

### Step 3.3 — Seed the dispatcher account

**Goal.** One user who can sign in at T-05.

**Files.** New: `backend/src/cli/seed.ts`, `backend/src/domain/password.ts` (`hashPassword`/`verifyPassword`, scrypt via Node's built-in `crypto` — no new dependency). Modified: root `package.json` and `backend/package.json` — add `seed`.

**Logic.** Reads `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` (required) and `SEED_USER_DISPLAY_NAME` (optional, defaults to `"Dispatcher"`), hashes the password with `hashPassword()` — the same function `authorize()` verifies against in T-05 via `verifyPassword()` — inserts with `role = 'dispatcher'`. **Refuses to overwrite an existing user** — a seed script that silently resets a password is a foot-gun. Env is validated before any database call, so a missing var never reaches an insert.

**Tests.**
- Creates one user with a hash that is not the plaintext.
- Re-running with the same email is a no-op and exits non-zero with a clear message.
- Missing env vars fail fast rather than seeding a blank password.
- **Pass:** all three.

---

# Phase 1 · Shell and access

## T-04 · Next.js + TypeScript migration

### Step 4.1 — Shared domain types first

**Goal.** The types both sides will use, before either side is rewritten.

**Files.** New: `backend/src/domain/planResponse.ts`.

**Logic.** `PlanResponse`, `PlanStop`, `CandidateStation`, `Disclaimer`, `TruckProfileSummary`, `InfeasibleReason` — from §14's payload and UI contract §3.

This step exists to make the rest of the ticket cheap. Typing the mock against the **target** shape rather than its current one means T-21 swaps a data source instead of reshaping every component a second time.

Two rules from UI contract §1 are encoded here: everything is a **number, not a display string** (`286.62`, not `"$286.62"`; `27600`, not `"7h 40m"`), and **nullable fields are genuinely nullable** — "no cap" on max detour and max stops must survive the round trip and must not be coerced to `0`.

**Tests.**
- Type-level: a fixture with `maxStops: null` compiles; `maxStops: 0` is a *different, valid* value.
- `npm run typecheck` passes.
- **Pass:** compiles, and the null/zero distinction is expressible.

### Step 4.2 — Next.js scaffold

**Goal.** The app boots under Next with the existing look intact.

**Files.** New: `frontend/next.config.ts`, `frontend/tsconfig.json`, `frontend/src/app/layout.tsx`, `frontend/src/app/page.tsx`. Deleted: `frontend/index.html`, `frontend/src/main.jsx`, `frontend/vite.config.js`, `frontend/README.md` (a stock Vite template README describing a stack that no longer exists), `frontend/src/assets/vite.svg`. Modified: `frontend/package.json`, `frontend/.gitignore` (`dist` → `.next`), root `package.json`.

**Left alone deliberately.** `frontend/src/App.css` and `frontend/src/index.css` — 578 lines of plain CSS driven by custom properties, fully portable. The Google Fonts `@import` in `index.css` works under Next; moving to `next/font` is an optimisation, not a requirement, and is out of scope. `frontend/public/favicon.svg` and `icons.svg` are untouched.

**Logic.** `layout.tsx` absorbs the `index.html` document shell and the `index.css` import. `page.tsx` takes the tab state from `App.jsx`.

**Tests.**
- `npm run build` succeeds with zero type errors.
- `npm run dev` renders all three tabs.
- **Visual check** against the pre-migration Vite build: identical layout. This is the one step where an eyeball is the right instrument.
- **Pass:** builds, renders, visually unchanged.

### Step 4.3 — Components to TSX

**Goal.** Every component typed, no `.jsx` left.

**Files.** Modified → `.tsx`: `Header`, `PlanTab`, `RecentTab`, `DevToolsTab`, `RouteMap`, `Corners`. `data/trips.js` → `data/trips.ts`, retyped as `PlanResponse[]` with **values converted from display strings to numbers**. New: `frontend/src/lib/format.ts`.

**Logic.** `format.ts` holds what the mock currently hard-codes: currency, distance, duration (`27600` → `7h 40m`), gallons, and the D6 unit-number pad. The components compose labels; the server never formats.

**Fix the drift found during exploration**, all in `DevToolsTab.tsx`:
- min-leg default `350` → **`300`** (§5.5; §21 Q8 confirms 300 is the current decision and 350 was the pre-v3.4 value)
- the 120 gal / 7.1 mpg truck → a real §16 profile, since no profile matches those numbers
- `opis-live · v3` → the BVD import identity, and `osrm-truck · hgv` → ORS. Both labels describe systems this project does not use.

**Tests.**
- `formatDuration(27600)` → `"7h 40m"`; `formatCurrency(286.62)` → `"$286.62"`; `formatUnitNumber(22)` → `"022"`.
- `trips.ts` type-checks as `PlanResponse[]`.
- Grep proves no `.jsx` remains under `frontend/src`.
- Grep proves no component receives a pre-formatted string prop.
- Rendered output still matches the pre-migration screenshots.
- **Pass:** all five.

### Step 4.4 — API mount point

**Goal.** A route handler ready for T-16's routes.

**Files.** New: `frontend/src/app/api/v1/[[...path]]/route.ts`, `backend/src/api/app.ts` (stub), `backend/src/api/problem.ts`.

**Logic.** §13's rule holds: `backend/src/api/` is **framework-free**, so the whole API mounts in one Next route file and can be exercised by tests without a server. The handler translates `Request` → the internal route table → `Response` and contains **no business logic**. `problem.ts` implements RFC 9457.

**Tests.**
- `GET /api/v1/health` returns a stub 200 through the mount.
- An unknown path returns 404 as `application/problem+json`, not HTML.
- `createApp()` is callable in a unit test with no server and no session.
- **Pass:** all three.

---

## T-04B · Backend build step and package boundary

### Step 4B.1 — Compile `@ch/core` to a real package

**Goal.** `npm run build --workspace backend` emits real, importable JS.

**Files.** New: `backend/tsconfig.build.json`, `backend/.gitignore`. Modified: `backend/package.json` — add `"build": "tsc -p tsconfig.build.json"` and an `"exports"` map.

**Logic.** `tsconfig.build.json` extends the base config with `noEmit: false`, `declaration: true`, `outDir: "dist"`, `rootDir: "./src"`, `include: ["src"]`, and excludes `*.test.ts` — the same NodeNext settings, just actually emitting. Because backend's source already writes `import "./foo.js"` for `foo.ts` (NodeNext's whole premise), the compiled output needs no extension rewriting at all: `foo.ts` → `dist/foo.js`, and the specifier is already correct.

The `exports` map (`"."` and `"./*"`, each mapping `types` to the matching `.d.ts` and `default` to the matching `.js` under `dist/`) is what turns `@ch/core` from "a source tree a neighbour happens to reach into" into an actual package boundary: any consumer — Turbopack, `tsc`, plain Node — resolves `@ch/core/api/app` to `dist/api/app.js` through ordinary package resolution, no bundler-specific configuration required.

**Tests.**
- `npm run build --workspace backend` against a clean checkout (no prior `dist/`) exits 0.
- `dist/api/app.js`, `dist/api/problem.js`, `dist/domain/planResponse.js` exist, each with a matching `.d.ts`.
- No `*.test.js` appears anywhere under `dist/`.
- `dist/` is untracked (`git status` clean after a build).
- **Pass:** all four.

### Step 4B.2 — Remove both T-04 stopgaps and wire the scripts

**Goal.** The real package boundary replaces the interim workarounds everywhere they were needed.

**Files.** Modified: `backend/src/api/app.ts` (restore `import { problemResponse } from "./problem.js"`, drop the stopgap comment), `frontend/tsconfig.json` (remove the `@ch/core/*` → `../backend/src/*` `paths` override), `package.json` (root) — `"build"` becomes `npm run build --workspace backend && npm run build --workspace frontend`; `"predev"` also builds backend; add `"pretypecheck": "npm run build --workspace backend"`.

**Logic.** The `pretypecheck` script is an npm lifecycle hook — `npm run typecheck` runs it automatically before the `typecheck` script body, with no change to `typecheck` itself and no separate CI step. Since `verify` is `typecheck && lint && test`, this alone keeps `dist/` fresh for every path that matters (a developer's `npm run verify`, and CI's identical invocation) without CI-specific plumbing.

**Tests.**
- `backend/src/api/app.ts` has exactly one import statement, from `./problem.js`; the hand-built 404 body from T-04 is gone.
- `frontend/tsconfig.json` has no `paths` key.
- `npm run typecheck` (root, clean checkout, `backend/dist` absent) exits 0 with no manual pre-step — proving the hook actually ran.
- `npm run build` (root, clean checkout) exits 0 end to end (backend, then frontend).
- `npm run dev`, then `GET /api/v1/health` → 200 and `GET /api/v1/nope` → 404 `application/problem+json` — T-04's two mount behaviours, unchanged from the consumer's point of view.
- Backend's existing `src/api/app.test.ts` and `src/api/problem.test.ts` (T-04) still pass unmodified.
- `npm run verify` is green from a clean checkout.
- **Pass:** all seven.

---

## T-05 · Auth and login page

### Step 5.1 — Auth.js credentials provider

**Goal.** The seeded user authenticates.

**Files.** New: `frontend/src/auth.ts`, `frontend/src/app/api/auth/[...nextauth]/route.ts`, `backend/src/catalog/users.ts`.

**Logic.** Credentials provider with **JWT sessions** (D7). JWT avoids the `accounts`/`sessions`/`verification_tokens` tables that database sessions would require — disproportionate for a single account. `authorize()` looks the user up by email and verifies against `users.password_hash` from step 3.3, using `verifyPassword()` from `backend/src/domain/password.ts` — built in T-03 for `seed.ts`'s `hashPassword()`, and reused here rather than duplicated.

**Tests.**
- Correct credentials return a session carrying `displayName` and `role`.
- Wrong password returns null, and the failure path takes comparable time to the success path — no user enumeration by timing.
- Unknown email returns null without throwing.
- **Pass:** all three.

### Step 5.2 — The boundary

**Goal.** Anonymous requests refused, with the right refusal per surface.

**Files.** New: `frontend/middleware.ts`. Modified: `backend/src/api/app.ts` — `createApp({ authRequired })`.

**Logic.** §13's split, and it matters: a **307 to `/signin`** for a page request, a **401 `application/problem+json`** for an `/api/` path. A redirect answers `fetch` with a 200 carrying a sign-in page, which is a confusing failure to debug. **Nothing is exempt, including `/health`.**

The API is *told* whether it is protected rather than asserting it. That is what keeps every later ticket's tests session-free — which is the substance of §19's reason for scheduling auth late, preserved even though D7 moves it early.

**Tests.**
- Anonymous `GET /` → 307, `Location: /signin`.
- Anonymous `GET /api/v1/health` → 401, content-type `application/problem+json`, **not** a redirect.
- Anonymous `GET /api/v1/plans/{id}` → 401.
- Authenticated requests pass through on both surfaces.
- `createApp({ authRequired: false })` serves without a session.
- **Pass:** all five.

### Step 5.3 — Login page and header identity

**Goal.** A dispatcher can sign in and see who they are.

**Files.** New: `frontend/src/app/signin/page.tsx`. Modified: `Header.tsx` — the hard-coded `M. Hodson` / `Dispatch` chip and the inert **Sign out** button become session-backed and functional.

**Tests.**
- Valid credentials land on `/` with the header showing the seeded name and role.
- Invalid credentials show an inline error and stay on `/signin`.
- Sign-out clears the session; the next page request redirects to `/signin`.
- A signed-in user visiting `/signin` is redirected to `/`.
- Password field is `type="password"` and the form does not log credentials.
- **Pass:** all five.

---

# Phase 2 · Data in

## T-06 · Ingest service and `npm run ingest`

### Step 6.1 — Parse the file

**Goal.** Bytes → structured rows, metadata separated.

**Files.** New: `backend/src/ingest/parseBvdCsv.ts` + test.

**Logic.** Line 1 is metadata, not a header — parse `company_id` and `effective_date` from it, then skip. Line 2 is the 15-column header; normalise by trimming, uppercasing and collapsing whitespace.

**Trust the header's effective date directly.** The file arrives on day *N* stating day *N+1*, and the header is already correct — **no `+1` offset logic anywhere** (§4.1). The pattern holds on weekends.

Do not "correct" `CH LOGISTIX` to `CH LOGISTICS`. That is the name on file with the supplier, and the ingest's job is to record what arrived.

**Tests.**
- The August sheet parses to **605 rows** with `effective_date = 2026-08-22` and `company_id = 981`.
- A January file parses to **594 rows**.
- All 15 columns present after normalisation; a header with stray whitespace still matches.
- Metadata row is excluded from the data rows.
- A file whose header shape differs is **rejected**, not coerced — all 31 January files share one shape, so the gate can be strict.
- **Pass:** all five.

### Step 6.2 — Validate

**Goal.** A row is accepted or rejected with a reason, never guessed at.

**Files.** New: `backend/src/ingest/validate.ts` + test.

**Logic.** Zod schemas checking: columns present, numerics parse, `PROD` mapped in `product_codes`, `STATE` a valid USPS code, and `YOUR PRICE = min(TOTAL COST, RETAIL PRICE)`.

Two rules that are the whole point:
- **An unmapped `PROD` fails the row.** It is never default-mapped. That guard is the entire reason `product_codes` exists (§22.4).
- **`YOUR PRICE` is read, never recomputed.** The `min()` cap is a BVD business rule only they can apply; validation asserts the invariant but the stored value is theirs.

**Tests.**
- All 605 August rows pass, including the **30 rows capped at retail** where `savings = 0`.
- The `YOUR PRICE = min(...)` invariant holds on 605/605 with zero error.
- A row with `PROD = 'DYED'` is **rejected** with an unmapped-product code, not mapped to diesel.
- A row with `STATE = 'XX'` is rejected.
- A row with a non-numeric `COST` is rejected with a parse code.
- Rejections carry line number and site ref.
- **Pass:** all six.

### Step 6.3 — `ingestFile()`

**Goal.** §11.1's seven steps as one function with no side channels.

**Files.** New: `backend/src/ingest/ingestFile.ts`, `backend/src/ingest/report.ts` + tests.

**Logic.** Hash → dedupe on `file_sha256` → stage → validate → promote only on a clean pass → upsert stations on `(supplier, site_ref)` and touch `last_seen_at` → insert one `station_prices` row per station per day keyed on `valid_on`.

**The function does no HTTP, reads no `process.argv`, and prints nothing.** That is what makes §11.2's deferred upload route and §20's Gmail poller wrappers rather than rewrites, and it is the constraint §7.1 leans on to rule out a Python ingest.

Nothing is closed out and nothing is mutated — a day's prices are written once and never touched again.

Stations store `city_raw` as received and `city_normalized` for matching. Never overwrite what the supplier sent.

**Tests.**
- August sheet → **605 stations, 605 price rows**, one `price_imports` row `completed`.
- Re-ingesting the same bytes returns the existing import unchanged and writes nothing.
- A file with one bad row promotes the other 604 and records one `import_rejections` row.
- A new `site_ref` creates a station; an existing one updates `last_seen_at` without duplicating.
- The function produces no stdout output — asserted by spying on `console`.
- Report names new stations, unmapped products and stations absent from this sheet.
- **Pass:** all six.

### Step 6.4 — The CLI

**Goal.** `npm run ingest -- <file>`.

**Files.** New: `backend/src/cli/ingest.ts`. Modified: root `package.json`.

**Logic.** argv and stdout, nothing else — the same rule the API layer follows (§13). Non-zero exit on a failed import.

**Tests.**
- The command prints the §11.1 report and exits 0.
- A malformed file exits non-zero with the reason on stderr.
- A duplicate exits 0 and says so.
- **Pass:** all three.

---

## T-07 · Backfill CLI and the January import

### Step 7.1 — Directory walk with per-file status

**Goal.** One bad sheet does not sink a run.

**Files.** New: `backend/src/ingest/backfill.ts` + test.

**Logic.** Writes an `import_batches` row, then calls `ingestFile` per file, recording per-file status. Because `valid_on` is a single date rather than a range, **ingest is order-independent** — files can arrive in any sequence and the unique constraint fires only on a genuine duplicate.

**Tests.**
- A directory of 3 files where the middle one is malformed: 2 complete, 1 failed, batch still completes.
- Shuffled processing order produces byte-identical database state.
- The batch row counts files correctly.
- **Pass:** all three.

### Step 7.2 — Gap detection

**Goal.** A missing day is visible, not papered over.

**Files.** New: `backend/src/ingest/gapReport.ts` + test.

**Logic.** Any date in the range with no `price_imports` row. This is why validity is a plain `valid_on` date and not "valid until superseded": a carried-forward stale price would hide the gap.

**Tests.**
- Against January: reports exactly **`2026-01-11`**.
- A contiguous range reports no gaps.
- A range with two separated gaps reports both.
- **Pass:** all three. Reporting the January gap is **correct behaviour**, not a bug to suppress.

### Step 7.3 — Run the real backfill

**Goal.** Thirty days of real history.

**Files.** New: `backend/src/cli/backfill.ts`. Modified: root `package.json`.

**Logic.** `npm run backfill -- ./data/bvd-prices/2026-01/`.

**Tests.**
- 31 files in, **30 distinct dates** stored.
- `pcn-usd-8097639-981 (1).csv` is skipped as a duplicate on `file_sha256` — verified byte-identical to its sibling (`84fc7c50…`), so this exercises the idempotency guard against a real case rather than a synthetic one.
- 594 price rows per date; **594 × 30 = 17,820** total.
- 594 distinct stations, all also present in the August set (January ⊂ August).
- The gap report names `2026-01-11`.
- Re-running the whole directory changes nothing.
- **Pass:** all six.

---

## T-08 · Station resolution from the operator export

### Step 8.1 — Store-number extraction

**Goal.** The join key, parsed correctly.

**Files.** New: `backend/src/resolution/storeNumber.ts` + test.

**Logic.** Parse the number out of `NAME` (`LOVES #368` → `368`). **Never from `SITE`** — `SITE` is BVD's internal ID and matches the store number in **0 of 605** rows. Brand extraction is generic: strip the trailing `#nnnn` so a future brand degrades gracefully rather than breaking.

**Tests.**
- `"LOVES #368"` → brand `LOVES`, number `368`.
- All 605 names parse; the numbers are **605 distinct** values in range 22–1055.
- `SITE` matches the store number in **0** cases — asserted, since this is the trap.
- An unrecognised brand yields a brand string and does **not** throw.
- **Pass:** all four.

### Step 8.2 — Load and join the export

**Goal.** 604 of 605 at `exact`.

**Files.** New: `scripts/resolve_from_operator.py`, `backend/src/resolution/operatorExport.ts` + test.

**Logic.** The xlsx reads with `header=2` — rows 1–2 are Love's branding and a price disclaimer — and the last row is a footer to drop. Join on store number.

**The rule this step must not break:** `operator_attrs` stores `StoreType`, `ParkingSpaces`, `DEFLanes`, `Address`, `Zip`, `HighwayOrExit` — location and amenity fields only. **Never the price column** (§17.1). Those are street prices, not contract prices, and are not what the app plans against.

Matched stations get `resolution = 'exact'`, `uncertainty_miles = 0`, `resolution_source = 'operator_export'`, and `truck_accessible = 'operator_verified'` — justified by `StoreType = 'Travel Stop'` plus a non-null `DEFLanes` count, which settles §11.5 from the operator directly rather than by inference from OSM tagging.

**Tests.**
- **604 matched, 1 unmatched (store #306, temporarily closed — absent from the export).**
- **State agreement on 604 of 604** — an independent check that must pass completely; a mismatch means the join is wrong even where it looks right.
- All 604 are `StoreType = 'Travel Stop'` with non-null `DEFLanes`.
- Coordinates inside CONUS: lat 25.95–48.57, lng −123.37 to −72.26.
- **No price field appears anywhere in `operator_attrs`** — asserted by key inspection.
- Store #306 remains `unresolved` and is never planned against (it is temporarily closed).
- **Pass:** all six.

---

## T-09 · Gazetteer fallback and manual entry

### Step 9.1 — City normalisation

**Goal.** Dirty city strings match the gazetteer.

**Files.** New: `backend/src/resolution/cityNormalize.ts` + test.

**Logic.** 25 ALL-CAPS rows to title case; 5 abbreviated prefixes expanded — `Mc Calla`, `Mt Juliet`, `Mt Vernon`, `N Little Rock`, `St Augustine`. Must agree with `scripts/load_gazetteer.py` from step 3.2, or the join silently misses.

`city_raw` is never overwritten.

**Tests.**
- All 25 ALL-CAPS strings normalise (`ELOY` → `Eloy`, `BRIGHTON` → `Brighton`).
- All 5 prefixes expand.
- A shared fixture asserts the TypeScript and Python normalisers agree on every one of the 30.
- `city_raw` survives unchanged alongside `city_normalized`.
- **Pass:** all four.

### Step 9.2 — Gazetteer lookup and manual entry

**Goal.** Every station that can be placed is resolved *(amended 2026-09-20: was 605 of 605; #306 is temporarily closed and stays `unresolved`)*.

**Files.** New: `backend/src/resolution/gazetteer.ts`, `backend/src/cli/resolve.ts` + tests.

**Logic.** Lookup on `(state_usps, name_normalized)`, giving `resolution = 'city'` with the centroid's uncertainty. A `city`-tier station is eligible as a stop **only if** `uncertainty_miles < 5` (miles; it was 8 km until 2026-09-20) and the leg has at least `2u` slack. `unresolved` stations are never planned against — the station is never silently planned against with a bad coordinate.

Store #306 is temporarily closed and stays `unresolved`. The manual subcommand takes coordinates from an approved source for any future case; a coordinate copied from a provider's map is still provider data under §17 and is not admissible.

**Tests.**
- All 604 operator-export stations have a non-null `geom` after this step; #306 (temporarily closed) does not.
- A city-tier station with an uncertainty of 7.5 mi is **excluded** from candidacy.
- One with an uncertainty of 2 mi on a slack leg is included; one at exactly 5 mi is excluded.
- The 9 ambiguous `(city, state)` pairs covering 21 rows resolve by store number at tier 1 and **never consult the city** — asserted by confirming all 21 carry `resolution_source = 'operator_export'`.
- Manual entry records its source and `resolved_at`.
- **Pass:** all five.

---

# Phase 3 · Routing and solving

## T-10 · ORS adapter, budget guard, both meters

### Step 10.1 — The provider interface

**Goal.** A contract no adapter can half-implement.

**Files.** New: `backend/src/routing/provider.ts`, `backend/src/routing/factory.ts`.

**Logic.** §8.4's interface. **`legs` is mandatory** — T-13's validation loop needs per-leg distances from the final waypointed route, and an adapter that cannot supply them is unusable regardless of its other qualities. The factory selects on `ROUTING_PROVIDER`; adopting HERE later is one new file plus one case here, with no caller changed.

**Tests.**
- The factory returns the ORS adapter for `ors` and throws on an unknown value.
- Type-level: an adapter omitting `legs` does not compile.
- **Pass:** both.

### Step 10.2 — ORS adapter against fixtures

**Goal.** Routing that works offline in tests.

**Files.** New: `backend/src/routing/ors.ts` + test, `backend/test/fixtures/ors/*.json`.

**Logic.** `driving-hgv` with the truck spec from the profile. Fixtures are recorded real responses, committed with ODbL attribution so the suite runs with no network. §17 permits this permanently for ORS; HERE fixtures would never be committed.

**Tests.**
- A recorded route decodes to polyline, distance, duration and per-leg breakdown.
- Leg distances sum to the total within rounding.
- A 4xx maps to a typed error, not a throw of the raw body.
- Every call emits a structured log keyed by request hash (§6 decision 18).
- The whole suite passes with the network disabled.
- **Pass:** all five.

### Step 10.3 — Budget guard

**Goal.** A ceiling that stops the call.

**Files.** New: `backend/src/routing/budgetGuard.ts` + test.

**Logic.** **Ours.** A persisted ceiling per endpoint, counted per UTC day, counted as calls are *reserved*. On call N+1 it **throws** — an error that stops the call, not a log line. The real risk is a retry loop, not ordinary use. (Built as a pooled monthly ceiling and re-based to per-endpoint, per-day by T-54; the steps that did it are in `BUILD-PLAN-v2.md`.)

**Tests.**
- Calls up to the ceiling succeed; N+1 throws and **the HTTP call is not made** — asserted by a spy on the fetch.
- The counter is per `(provider, period, endpoint)` and each endpoint's ceiling is checked against its own counter.
- A new UTC day resets.
- A reserved-then-failed call still counts (it consumed quota).
- **Pass:** all four.

### Step 10.4 — Quota observer and drift

**Goal.** Their meter, recorded honestly.

**Files.** New: `backend/src/routing/quotaObserver.ts` + test.

**Logic.** **Theirs.** Read `x-ratelimit-limit` / `-remaining` into `provider_quota` with `observed_at`, keeping the previous reading. The provider does not state what window its limit covers, **so neither do we** — store the number and the moment observed, label no period.

Drift is a **rate, not a level**: compare the two most recent observations as `(their fall) − (our permitted calls)`, floored at zero. One reading says nothing. Both counters can legitimately go backwards — theirs at a window reset, ours at UTC midnight — and neither is drift; each starts a fresh baseline.

**Tests.**
- Headers persist with `observed_at`; the prior reading moves to `prev_*`.
- Their remaining falling faster than our permitted calls reports drift.
- Falling in step reports zero drift.
- Their counter increasing (a reset) reports **zero drift and rebaselines**, not a negative.
- Our counter resetting at UTC midnight likewise rebaselines.
- A single observation with no prior reports nothing.
- **Pass:** all six.

### Step 10.5 — Measure the real limits

**Goal.** Replace an unverified claim with a measurement.

**Files.** Modified: `docs/PROJECT-SCOPE.md` §8.3.

**Logic.** §8.3 currently carries a v3.4 claim of **200 directions / 50 matrix / 100 geocoding** against documented figures of 2,000 and 500 per day, explicitly flagged as unverified with no code in the repository producing it. Measure against the live free tier and record the real numbers. If the low figures hold, the documented quota is not the operative one and the guard's ceiling must be set against the header rather than the docs.

**Tests.**
- Measured figures are written into §8.3 with the observation date, replacing the warning block.
- The guard's ceiling is set from the measurement.
- **Pass:** §8.3 no longer contains an unverified rate-limit claim.

---

## T-11 · Corridor query

### Step 11.1 — The spatial query

**Goal.** Stations along a route, with position and price.

**Files.** New: `backend/src/planning/corridor.ts` + integration test.

**Logic.** §15.4's SQL. `ST_LineLocatePoint` for the fraction along, `ST_Distance` for perpendicular offset, `ST_DWithin` for the screen, filtered to `resolution <> 'unresolved'`.

Two of §15.4's three requirements land here:
- **No `product_codes` join in the hot path.** `product_type` is denormalised onto `station_prices` at import and indexed as `(valid_on, product_type, station_id)`. §11.1's hard rule keeps unmapped codes out of the table entirely, so re-deriving the type per query is redundant work.
- **`LEFT JOIN LATERAL` for the price, never an inner join.** An inner join makes a station with no price on `valid_on` **vanish** — indistinguishable from one that was never near the route. Those must be counted and named in `exclusions`, because "no price that day" and "not on this route" are different facts and only one of them is a data problem.

`valid_on` is an explicit date parameter, never an implied "current" flag. It is recorded on the plan as `price_as_of`, which is what makes a plan reproducible after the fact.

**Tests.**
- A known lane returns candidates ordered by `offset_along_route_miles`.
- A station priced on a *different* date appears in `exclusions`, **not** silently missing — the regression test for requirement (b).
- `unresolved` stations never appear.
- The query plan uses the GIST index (asserted via `EXPLAIN`).
- `offset_along_route_miles` is monotonic and bounded by route length.
- **Pass:** all five.

### Step 11.2 — Stratified top-K

**Goal.** Coverage before price.

**Files.** New: `backend/src/planning/stratifiedTopK.ts` + test.

**Logic.** §15.4 requirement (c). Cut the route into **50-mile buckets** and draw **round-robin, cheapest within each bucket**, to K ≈ 40.

Sorting by price globally is the trap: prices cluster regionally — TX has 84 stations, CT has 1 — so the 40 cheapest on a Texas→Illinois run can all sit at one end. The optimiser then reports a range gap across ground that had usable stations on it, and the output looks like a legitimate infeasibility rather than a selection bug.

**Tests.**
- **The trap case:** 200 synthetic stations where the 40 cheapest all fall in the first 300 miles of a 900-mile route. Stratified selection returns candidates in every 50-mile bucket that had any; a price sort leaves a 500-mile hole. Assert the hole does not appear.
- Every bucket containing a station contributes at least one candidate until K is exhausted.
- Within a bucket, selection is cheapest-first.
- Fewer stations than K returns all of them.
- Zero candidates returns empty, not an error.
- **Pass:** all five.

---

## T-12 · Optimiser registry, `dp_v1`, `greedy_v1`

**Tests come first in this ticket.** Every case runs with no database and no network, in milliseconds.

### Step 12.1 — Types and registry

**Goal.** The strategy seam.

**Files.** New: `backend/src/optimizer/types.ts`, `backend/src/optimizer/registry.ts`.

**Logic.** §13.1's `OptimizerInput`, `OptimizerResult`, `OptimizerStrategy`. **No I/O in a strategy** — no database, no HTTP, no clock. Adding one is a new file plus a registry entry, and nothing else changes. `plans.optimizer_strategy` records which ran so historical plans stay interpretable after an upgrade.

**Tests.**
- The registry exposes `dp_v1` and `greedy_v1` with stable ids.
- Type-level: a strategy performing I/O in `solve()` is structurally excluded (signature returns a value, not a promise).
- **Pass:** both.

### Step 12.2 — `greedy_v1`

**Goal.** A reference baseline to diff against.

**Files.** New: `backend/src/optimizer/greedy_v1.ts` + test.

**Logic.** Purely a comparison baseline. Note the classic rule is **nearest cheaper**, not "cheapest within range" (§22.3) — the latter looks right in review and is wrong. Building this first gives the DP something to be measured against from its first test.

**Tests.**
- On a monotonically rising price sequence it fills early.
- On a falling sequence it buys minimum until the cheap station.
- It implements nearest-cheaper, asserted on a fixture where the two rules diverge.
- **Pass:** all three.

### Step 12.3 — `dp_v1` core

**Goal.** The exact DP.

**Files.** New: `backend/src/optimizer/dp_v1.ts`, `backend/src/optimizer/dp_v1.test.ts`.

**Logic.** State `cost[i][f]` — minimum cost to arrive at candidate *i* holding *f* gallons, *f* a bucket index at **2-gallon** granularity. **Round conservatively — down on arrival fuel** — so discretisation never manufactures range that does not exist.

*Phase A, purchase in place:* scan buckets upward at station *i*; buying moves `f` → `f+1` at `bucketGallons × price_i`. One linear pass gives the optimal cost of reaching every departure level. The fixed stop penalty is charged once, on the first gallon bought.

*Phase B, drive:* for each departure bucket at *i* and each *j* with `min_leg ≤ s_j − s_i ≤ max_leg`, compute burn and relax `cost[j][f']`. **The transition into the virtual destination ignores the lower bound** — there is no floor on the final leg.

Origin is a virtual node at mile 0, fuel = tank capacity, price = ∞. Destination is virtual at mile D, reachable only if the leg is within `max_leg` and arrival fuel ≥ `min_arrival_gallons`.

Reconstruct by storing the predecessor `(station, bucket, purchase)` at each relaxation.

**Why a fuel dimension is required at all.** Because the floor can be relaxed and the cap forces stops regardless of need, surplus fuel has value: fill cheap at mile 100, stop at 550 as the cap requires, buy little there. A plain shortest path over stop positions cannot express that, which is the single most important structural fact about this algorithm.

**Tests — the full §15.6 suite.**

| Case | Expected |
|---|---|
| single candidate | plan or infeasible, no crash |
| zero candidates | `infeasible` (`LEG_GAP`, structured) when the trip needs a stop; a plan with no stops when it does not |
| candidate at mile 0 | handled; origin already counts as a fill |
| monotonically rising prices | fill early |
| monotonically falling prices | minimum until cheap |
| gap exactly 500 mi | **accepted** |
| gap 501 mi | **rejected** |
| gap exactly 300 mi | **accepted** |
| gap 299 mi | **rejected** |
| cheapest station at mile 200, floor 300 | not selectable |
| **final leg under 300 mi** | **ACCEPTED** — no floor on arrival |
| destination exactly 500 mi from last stop | accepted |
| arrival reserve forces a larger purchase | purchase increases accordingly |
| **cheap early station, expensive mandatory stop later** | **carries fuel forward; buys the minimum (one bucket) at the expensive stop** |
| `maxStops` binding | respects the ceiling |

Plus: `dp_v1` total cost is **never greater than** `greedy_v1` on the same input, across a randomised fixture sweep.

**Two cases carry more weight than the rest.** The final-leg case is a frequent off-by-one source and needs its own test rather than being folded into a general leg-bounds test. The carry-forward case is the one that distinguishes the DP from a shortest path — **without it the suite does not prove the algorithm does anything a greedy could not.**

**Pass:** every row above, plus the cost-comparison sweep.

### Step 12.4 — Performance sanity

**Goal.** Confirm the cost model.

**Files.** Modified: `dp_v1.test.ts`.

**Logic.** O(n·B) Phase A, O(n²·B) Phase B. At n = 80, B = 75 that is ~480,000 relaxations.

**Tests.**
- n = 80, B = 75 solves in well under 100 ms.
- Doubling n roughly quadruples the work — confirms O(n²), catching an accidental cubic. Asserted on the counted relaxations (`solveWithStats`), not on wall-clock: at a few milliseconds a timing ratio is scheduler noise (measured 3.3 ms at n = 80 against 2.1 ms at n = 160).
- **Pass:** both.

---

## T-13 · Validation loop and two-pass relaxation

### Step 13.1 — Relaxation wrapper

**Goal.** §5.1's two passes, outside the strategy.

**Files.** New: `backend/src/planning/relaxation.ts` + test.

**Logic.** Solve at `min_leg = 300`. If infeasible, re-solve at `0` and attach `MIN_LEG_RELAXED` naming which legs fall short. A hard floor can otherwise declare impossible a trip the truck could comfortably make — no station in the 300–500 window fails a lane the truck could run to mile 600. A plan with a 280-mile leg and a clear warning is more useful than a dead end.

**The strategy stays pure.** The retry lives here, in the service, never inside `solve()`.

**Tests.**
- A lane feasible at 300 does **not** relax and does not emit the disclaimer.
- A lane feasible only at 0 relaxes, sets `min_leg_relaxed = true`, and names the short legs.
- A lane infeasible at both stays infeasible with the original reason.
- The optimiser's own tests still require no I/O — proving the retry did not leak into the strategy.
- **Pass:** all four.

### Step 13.2 — The validation loop

**Goal.** The 500-mile guarantee, measured rather than asserted.

**Files.** New: `backend/src/planning/validationLoop.ts` + test.

**Logic.** §15.5: DP on baseline distances → route with the stops as vias → re-check cap and reserve against **real** per-leg distances → if violated, recompute with real distances and re-run the DP → if the stop set changed, route again → **cap at 3 iterations** → `Infeasible(NO_STABLE_PLAN)`. Then recompute costs and cumulative values from the real route.

This is necessary because everything upstream measures along the *baseline* polyline, and inserting a stop can change which highway the router picks. Until the legs are re-measured, the guarantee is a claim — which is exactly why §19 puts this before the API surface.

**Tests.**
- A stable lane converges on iteration 1 with one extra route call.
- A lane whose real legs differ converges on iteration 2.
- An oscillating fixture hits the cap and returns `NO_STABLE_PLAN` rather than looping — assert the call count stops at 3.
- A real leg exceeding 500 miles after waypointing triggers recomputation, never a silent pass.
- Final totals derive from the real route, not the baseline.
- **Pass:** all five.

---

## T-14 · Detour costing

### Step 14.1 — The estimate

**Goal.** A cheap filter before spending matrix calls.

**Files.** New: `backend/src/planning/detourEstimate.ts` + test.

**Logic.** `d ≈ 2 × perp_offset_miles × 1.35` — the multiplier covering ramps, frontage roads and no left turns for a 53-foot trailer. Below 0.124 mi (200 m) perpendicular offset, treat as `d = 0`.

**Tests.**
- 0.1 mi offset → 0.
- 0.5 mi offset → 1.35 mi.
- Monotonic in offset.
- **Pass:** all three.

### Step 14.2 — The bracket model

**Goal.** A detour figure that reflects how a truck actually drives.

**Files.** New: `backend/src/planning/detour.ts` + test.

**Logic.** `detour = d(before → station) + d(station → after) − d(before → after)`, with `before`/`after` ten miles either side via `ST_LineInterpolatePoint`. `d(before → after)` is the route's **own arc length** — already known, never requested from the provider.

The naive alternative — route to the station and double it — fails because a truck cannot turn around on a controlled-access highway, so the router correctly returns a long trip to the next interchange and back. The provider is right; the question is wrong. The truck is already driving past and will use the interchange that serves the station.

**Two matrix calls, not one.** The legs point in opposite directions; a single call covering both needs a 2N × 2N grid — 5,184 pairs at N = 36, past what ORS accepts. Two N × N calls stay well inside the limit — while N fits the per-call ceiling. Past it (a lane long enough that `stratifiedTopK` widens K), chunk into diagonal blocks: 2 × ⌈N / side⌉ calls, never 2N × 2N.

**Route ends.** `before = max(0, s − 10)`, `after = min(L, s + 10)`; the arc subtracted is `after − before`, not a fixed 20.

**Keep the estimate beside the measurement.** `estimatedDetourMiles` is never overwritten. That comparison is the only evidence that would ever show the 1.35 multiplier badly chosen — and per v3.4 it is what caught the naive model's error in the first place.

**Tests.**
- A station 0.25 mi off the route measures a **small** detour, not tens of miles — the regression test for the naive model.
- Exactly **two** matrix calls per candidate set, each N × N; assert no 2N × 2N call is ever constructed.
- `estimatedDetourMiles` and the measured value both persist.
- `detourEstimateError()` reports the gap across a candidate set.
- A station on the far side of a divided highway shows a larger detour than one on the near side.
- **Route ends (§15.4.1, decided 2026-09-21):** a station within 10 miles of the origin brackets from the origin, one within 10 miles of the destination to the destination, and on a route under 20 miles both ends clamp; in each case the subtracted arc is the clamped one, not 20.
- **Raw and floored:** a router path that beats the polyline yields a raw detour below 0, the optimiser's value is 0, and the raw figure is still on the record.
- **Null cell:** an unreachable pair stays null, never a 0-mile detour, and the station is named in `exclusions`.
- **Chunking:** N ≤ `MAX_MATRIX_SIDE` makes exactly two calls; N = side + 1 makes 2 × 2 = 4, each block within the side, and no call is ever 2N × 2N.
- **Pass:** all nine.

### Step 14.3 — Record the measurements

**Goal.** Close another unverified claim.

**Files.** Modified: `docs/PROJECT-SCOPE.md` §15.4.1.

**Logic.** §15.4.1 carries v3.4 figures explicitly marked unverified — LOVES #759 at 38 mi naive vs 1.98 mi bracket, MAE 9.8 → 2.4 mi, worst underestimate 37.6 → 3.0 mi, and an ORS matrix ceiling of 50 × 50. Re-measure and record. The reasoning was sound; the numbers were never reproduced in this repository.

**Tests.**
- §15.4.1 carries measured figures with a date and no unverified warning.
- The real ORS matrix ceiling is recorded, and K = 40 is confirmed safe or chunking is added.
- **Pass:** both.

---

# Phase 4 · API

## T-15 · Address geocoding and `saved_locations`

### Step 15.1 — Geocode with cache

**Goal.** Addresses resolve, cheaply and legally.

**Files.** New: `backend/src/catalog/geocode.ts`, `backend/src/catalog/savedLocations.ts` + tests.

**Logic.** Normalise the address, look it up in `saved_locations`, and on a miss geocode and store with a **30-day `expires_at`** per §17's provider cap. Increment `use_count` on a hit.

**Cache the geocode, never the plan.** §4.3 measured a median **41¢/gal** daily swing per station; yesterday's cheapest route for the same lane is not today's. Only the geocoding is cached.

**This is also why station coordinates never come from a provider geocoder** — otherwise you re-geocode 605 stations every 30 days forever, or you are out of compliance.

**Tests.**
- A miss geocodes once and stores with `expires_at ≈ now + 30 days`.
- A hit returns from cache with **no provider call** and increments `use_count`.
- An expired row is re-geocoded, not served stale.
- Address normalisation makes two spellings of one address a single cache row.
- A provider geocode is **never** written to `stations.geom` — asserted.
- **Pass:** all five.

### Step 15.2 — Accept both input shapes

**Goal.** `{address}` or `{lat,lng}`.

**Files.** Modified: `backend/src/catalog/geocode.ts`.

**Tests.**
- `{lat,lng}` bypasses geocoding entirely.
- `{address}` resolves through the cache path.
- Neither shape present → a validation error naming the field.
- Out-of-range coordinates rejected.
- **Pass:** all four.

---

## T-16 · Plan orchestration, `POST /plans`, `GET /plans/{id}`

### Step 16.1 — The parameter split

**Goal.** Two distinct detour concepts, separately expressed.

**Files.** Modified: `backend/src/domain/planResponse.ts`, `docs/PROJECT-SCOPE.md` §14 and §15.1.

**Logic.** UI contract §5.3 is right that §14's single `maxDetourMiles` does two different jobs, and the design's own help text already distinguishes them:
- **`corridorMiles`** — a straight-line **screening** radius, inflated by each station's uncertainty, deciding what is considered at all.
- **`maxDetourMiles`** — a **post-routing** cap on one station's actual round-trip drive. **Nullable**; blank means no cap.

§15.1's constraint list gains the second. Recording the split in the scope is part of this step, not an afterthought.

**Also here, from T-14 (decided 2026-09-21).** `plans.max_detour_miles` is `NOT NULL` while this parameter is nullable; make the column nullable so "no cap" is stored, not coerced to `0`. And the matrix-result cache lands in T-16 (see TICKETS.md T-16): keyed on the exact matrix request, so a same-lane re-run with an unchanged shortlist spends no matrix calls.

**Tests.**
- A station inside the corridor but exceeding the per-stop cap is considered and then **rejected** — proving the two act at different stages.
- `maxDetourMiles: null` applies no cap; `0` is a different, valid, restrictive value.
- Defaults come from the profile when omitted.
- **Pass:** all three.

### Step 16.2 — The plan service

**Goal.** The orchestration, end to end.

**Files.** New: `backend/src/planning/planService.ts` + test.

**Logic.** Geocode → baseline route → corridor → stratified top-K → detour estimate → optimise (with relaxation) → validation loop → measured detours → totals → persist.

Persisted with `status = 'completed'` or `'infeasible'`, recording `optimizer_strategy`, `price_as_of`, and the actual `max_leg_miles` / `min_leg_miles` / `min_leg_relaxed` the DP ran with. Those columns are the record of what happened, which is why they stay on `plans` regardless of where the values came from.

A technical failure — provider timeout, budget guard, unhandled exception — is **not persisted**. It returns an RFC 9457 error. Only `infeasible` is a persisted non-success, because it is the DP's actual answer rather than a crash.

**Tests.**
- A real lane produces a plan with stops, totals, `priceAsOf` and a baseline comparison.
- Totals reconcile: `Σ stop_cost = total_fuel_cost`; `Σ purchase_gallons = total_gallons`.
- Every leg is ≤ `max_leg_miles` against **measured** distances.
- Tank level never exceeds capacity nor drops below reserve at any stop.
- An infeasible lane persists with a structured reason and **still returns candidates**.
- A provider timeout persists **nothing** and returns an RFC 9457 error.
- `solveMs` and `stationsScanned` are recorded.
- **Pass:** all seven.

### Step 16.3 — The endpoints

**Goal.** `POST /plans` and `GET /plans/{id}`.

**Files.** New: `backend/src/api/routes/plans.ts`, `backend/src/cli/serve.ts` + tests.

**Logic.** **Synchronous.** The request computes in-process and returns the finished result — the same body `GET /plans/{id}` returns, not a job reference to poll. This follows §6 decision 19 and §10's measured 3–10s solve, and it is why `plans.status` has no in-progress states. `GET /plans/{id}` exists to re-fetch later — a shared link, browsing history — not to poll one still computing.

`serve.ts` binds `127.0.0.1` with no session check, per §13.

**Tests.**
- `POST /plans` returns the complete plan body, not a job id.
- `GET /plans/{id}` returns an identical body for the same plan.
- An infeasible result is **200 with `status: "infeasible"`**, not a 4xx — it is a legitimate answer, not an error.
- `?units=metric` converts distances and volumes; storage remains miles and gallons.
- Resolved origin and destination coordinates are echoed back (UI contract §6.10).
- `null` for `maxStops` and `maxDetourMiles` survives the round trip and is not coerced to `0`.
- An unknown plan id returns 404 as `application/problem+json`.
- **Pass:** all seven.

---

## T-17 · Google Maps URL and disclaimers

### Step 17.1 — The URL builder

**Goal.** The dispatcher's deliverable.

**Files.** New: `backend/src/planning/googleMapsUrl.ts` + test.

**Logic.** `origin`, `destination`, `waypoints` pipe-separated, `travelmode=driving`. Up to 9 intermediate waypoints; 1–4 fuel stops fits comfortably.

**Tests.**
- 3 stops → 3 waypoints in `seq` order.
- Coordinates formatted `lat,lng` and URL-encoded.
- 0 stops → a valid origin/destination link.
- More than 9 stops → a typed error rather than a silently truncated link.
- **Pass:** all four.

### Step 17.2 — Disclaimers

**Goal.** Warnings the frontend cannot omit.

**Files.** New: `backend/src/planning/disclaimers.ts` + test.

**Logic.** They ship **in the payload, not the frontend**, precisely so the frontend cannot drop them.

- `GOOGLE_LINK_NOT_TRUCK_LEGAL` — **always.** The link gives the driver a *car* route: stops correct, roads unchecked for truck restrictions. No worse than the current process, but a real gap between what is computed and what is driven.
- `ACCESSIBILITY_UNVERIFIED` — only when a plan actually contains a non-operator-verified stop. A disclaimer that always fires is one nobody reads, which is why §11.5 changed this from v3.4's blanket version.
- `MIN_LEG_RELAXED` — only when §5.1's second pass ran, naming the short legs.
- `PRICE_STALENESS` — carries `priceAsOf`.

**Needs Q5:** your sign-off on the exact wording, which the test then pins.

**Tests.**
- Every plan carries `GOOGLE_LINK_NOT_TRUCK_LEGAL`.
- An all-operator-verified plan does **not** carry `ACCESSIBILITY_UNVERIFIED`; one with an unverified stop does.
- `MIN_LEG_RELAXED` appears only after relaxation and names the short legs.
- Wording is asserted verbatim so it cannot drift silently.
- **Pass:** all four.

---

## T-18 · Supporting read endpoints

### Step 18.1 — Price sheets

**Goal.** The sheet picker's data source.

**Files.** New: `backend/src/api/routes/priceSheets.ts` + test.

**Logic.** `GET /price-sheets` → `effectiveOn`, `importedAt`, `rowCount`, `stationCount`, newest first. `stationCount` is distinct stations priced on that sheet, derived from `station_prices` — the only field of the four not already on `price_imports`. The frontend decides "is newest" by comparing to index 0.

**Tests.**
- After the January backfill plus August: 31 entries, newest first.
- `stationCount` is 594 for a January sheet and 605 for August.
- The missing `2026-01-11` is simply absent — no placeholder row.
- **Pass:** all three.

### Step 18.2 — Stations, profiles, health

**Goal.** The remaining read surface.

**Files.** New: `backend/src/api/routes/stations.ts`, `truckProfiles.ts`, `health.ts` + tests.

**Logic.** `GET /stations?bbox=&resolution=` paged for the map's sheet layer; `GET /stations/{id}/prices` for history; `GET /truck-profiles` for the Dev Tools truck-profile panel (§5.1), unit numbers formatted per D6. **Superseded by D18 (v2):** as shipped, `truck_profiles.truck_number` stays an unpadded `integer` and is display-only; `formatUnitNumber()` moved to the real roster's `text` unit numbers instead (T-25). `GET /truck-profiles` is not the New Plan truck selector — see T-21's A16 amendment and D23.

`GET /health` reports DB, provider reachability, latest sheet date, and **both call meters separately**. A single "calls remaining" figure would hide whichever is about to bite — just after UTC midnight our counter can read untouched while the endpoint pool the next plan needs is three calls from empty. Health is **not exempt from auth**.

**Tests.**
- `bbox` filters correctly; paging is stable across pages.
- `resolution=exact` excludes city-tier stations.
- `/truck-profiles` returns three. (As shipped: `truck_number` is an unpadded `integer` — zero-padding was D6, superseded by D18 before this landed.)
- `/health` shows two distinct meter objects, never a merged figure.
- Anonymous `/health` → 401.
- **Pass:** all five.

### Step 18.3 — Plan list and the payload additions

**Goal.** Close UI contract §6.

**Files.** Modified: `backend/src/api/routes/plans.ts`, `backend/src/domain/planResponse.ts` + tests.

**Logic.** `GET /plans` as a **list projection with pagination** — not full plan payloads. `POST /plans` accepts `priceEffectiveOn` so a lane can be re-priced against a historical sheet.

Then the payload additions the UI cannot be built without:
- **`candidateStations[]` fully specified.** §14 leaves it a comment stub, yet three separate parts of the Plan tab consume it — the dot layer, the hover card and the cheapest-along-route list. Minimum: `id`, `name`, `city`, `state`, `location`, `unitPriceUsd`, `distanceAlongRouteMiles`, `detourMiles`. Each needs a **stable `id`** so the frontend can diff against `stops[]`.
- **`detourCostUsd`** plus the `costPerMile` used to compute it. The design hard-codes `$0.60/mi`; that rate is a business input and belongs on the response.
- **Drive time and dwell time separated**, so the "excludes time at the pump" caption is actually true.

**Tests.**
- `GET /plans` paginates; a page is a projection, asserted by the absence of `stops[]`.
- Every candidate has a stable id; ids in `stops[]` are a subset of the candidate ids.
- `priceEffectiveOn` re-prices against a January sheet and sets `priceAsOf` accordingly.
- `detourCostUsd = Σ detourMiles × costPerMile`, with `costPerMile` present.
- `driveSeconds + dwellSeconds = totalSeconds`.
- **Pass:** all five.

---

## T-19 · `sentToDriver` write path

### Step 19.1 — `PATCH /plans/{id}`

**Goal.** Bookkeeping that survives a reload.

**Files.** New: `backend/src/api/routes/planPatch.ts` + test. Modified: `backend/src/domain/planResponse.ts` — add `sentToDriver`, `sentToDriverAt`.

**Logic.** Writes `plans.dispatched_at` and the acting user. That column exists in §12 but **nothing writes it** in v1, so it carries no weight until this lands.

**A flag only** — it does not freeze the plan or stop re-pricing. It is deliberately a checkbox rather than a status badge because it is a third axis alongside solve status and trip lifecycle.

Its real payoff is later: Phase 3 backtesting reconciles receipts against **dispatched** plans only, because matching against every exploratory plan a dispatcher computed and discarded would manufacture false mismatches.

**Tests.**
- Setting true records `dispatched_at` and the user; `GET` reflects it.
- Setting false clears it.
- The plan's stops and totals are **unchanged** by the patch.
- Patching an unknown id → 404 problem+json.
- Anonymous → 401.
- **Pass:** all five.

---

## T-20 · Route geometry retention job — **DEFERRED, not in v1**

**Deferred 10 September 2026.** §17 was revised to drop route-geometry expiry from v1: ORS is the only routing provider, ODbL carries no storage cap, and stored geometry only ever redraws a historical plan rather than being planned against. There is no `routes.expires_at`, no expiry trigger and no `geometryExpired` field, so this ticket has nothing to act on. **Do not build these steps.** They come back with HERE or Google, together with the provider-aware expiry column specified in §17.

The two rules below are **not** deferred — they hold in v1 already and belong to T-16's plan service:

- **`routes` is a cache; `plans` and `plan_stops` are the record and are permanent.** Nulling `plan_stops` on the theory that its distances are provider-derived destroys the audit trail needed to reconcile a plan against a driver's receipts — which is exactly why `plan_stops` stores `unit_price_usd` as a literal beside the foreign key rather than relying on a join.
- **A refreshed route writes to `routes` only** — never to `plans` or `plan_stops`. The refreshed line reflects *today's* road network, so stored totals stay authoritative. Silently overwriting `plans.total_distance_miles` with a new figure would corrupt the historical record. The `UNIQUE (provider, request_hash)` upsert refreshes `computed_at` rather than inserting a duplicate.

---

# Phase 5 · Frontend

## T-21 · Frontend API client, retire the mock

### Step 21.1 — Typed client and hooks

**Goal.** One place that talks to the API.

**Files.** New: `frontend/src/lib/api.ts`, `frontend/src/hooks/usePlan.ts`, `useTruckProfiles.ts`, `usePriceSheets.ts`.

**Logic.** Typed against the same `backend/src/domain/` types the server serialises — the compile-time guarantee across the boundary that §7 gives as the reason for one repository.

**Tests.**
- A mocked 200 yields a typed `PlanResponse`.
- A problem+json response surfaces as a typed error with its `title` and `detail`.
- A 401 is distinguishable from a 500 by the caller.
- **Pass:** all three.

### Step 21.2 — Swap the data source

**Goal.** Real data; the fixture gone.

**Files.** New: `frontend/src/hooks/useTrucks.ts`. Modified: `page.tsx`, `Header.tsx`, `PlanTab.tsx`, `RecentTab.tsx`, `DevToolsTab.tsx`, `RouteMap.tsx`. **Deleted:** `frontend/src/data/trips.ts`.

**Logic.** Because T-04 typed the components against `PlanResponse`, this is a data-source swap rather than a rewrite. The fixture was a **design artefact, not a stub to fill in** — it recorded what the dispatcher expects to see, and it has served that purpose.

**Truck selector — corrected against A16's amended T-21 note.** This step
originally called for `Header.tsx` to list `truck_profiles` with unit numbers
"zero-padded per D6." Both halves are now wrong: D18 superseded D6 (no
zero-pad, `unit_number` is `text`), and `truck_profiles` was never the real
fleet — it's the optimiser's abstract mpg/tank class (A16's T-03 note). The
selector lists the real 27-unit roster instead (`GET /trucks` with no
`period`, D23) and sets `plans.truck_id` (T-38/D22) on the request; keep the
data logic in `useTrucks.ts` rather than inline in `Header.tsx`, since T-39
absorbs that file almost immediately after this ticket lands. `DevToolsTab.tsx`'s
fields — every one currently uncontrolled and inert — become real `POST /plans`
inputs, including the new `corridorMiles` / `maxDetourMiles` split; its own
truck-*profile* panel (§5.1) is unaffected — that still reads/writes
`truck_profiles` via `GET /truck-profiles`.

**Tests.**
- Grep proves no component imports a local fixture.
- "Plan route" issues one `POST /plans` and renders the result, carrying `truckId`.
- The truck selector lists the real roster by `unit_number` (unpadded, D18), not `truck_profiles`.
- The sheet picker lists real imports; selecting a non-newest one applies the archived styling.
- Dev Tools inputs reach the request body, with blank → `null`, not `0`.
- **Pass:** all five.

---

## T-22 · MapLibre map

### Step 22.1 — Base map

**Goal.** A real map in the panel.

**Files.** New: `frontend/src/map/style.ts`. Modified: `RouteMap.tsx`, `frontend/package.json`, `App.css`.

**Logic.** MapLibre GL JS with OpenFreeMap tiles — free, keyless, no account. Swapping to MapTiler or Protomaps later is a style-URL change. The renderer is independent of the routing provider; changing provider does not touch the map at all.

**Tests.**
- The map mounts and tiles load.
- It resizes with its container.
- A tile failure degrades to a visible empty state rather than a blank panel.
- **Pass:** all three.

### Step 22.2 — Layers and interaction

**Goal.** The five §9.3 layers, and the hover card.

**Files.** New: `frontend/src/map/layers.ts`. Modified: `RouteMap.tsx` — **rewritten**; `pinPos()` and the drawn diagonal go entirely, replaced by real coordinates.

**Logic.** `route-baseline` muted and dashed, `route-optimized` prominent and solid, `stations-selected` numbered with popups, `stations-candidate` small dots and toggleable, `endpoints` distinct icons.

A `city`-tier station also draws an **uncertainty circle** of radius `uncertaintyMiles`, so the dispatcher can see that a pin is a town rather than a forecourt. MapLibre circle radii need **metres**, so the map converts at render (T-52) — CLAUDE.md's fourth conversion edge, in `uncertaintyRadiusMeters()`. MapLibre's `circle` layer sizes in screen pixels, so the circle is drawn as a geodesic polygon to keep its radius true on the ground.

**Attribution from the API response is rendered** — under ODbL a licence condition, not a courtesy, which is why it ships in the payload rather than being left to the frontend.

**Tests.**
- Both routes render in their distinct styles; bounds fit the optimised route.
- Numbered pins sit at `stops[].station.location`, in `seq` order.
- The hover card shows all six §3.2 rows.
- A city-tier pin draws its uncertainty circle; an exact pin does not.
- Candidate dots toggle without a refetch.
- Attribution text is present in the DOM.
- **Pass:** all six.

---

## T-23 · Missing UI states

### Step 23.1 — Infeasible and disclaimers

**Goal.** Render the payloads that currently have nowhere to go.

**Files.** New: `InfeasiblePanel.tsx`, `Disclaimers.tsx`. Modified: `PlanTab.tsx`, `RecentTab.tsx`.

**Logic.** An infeasible plan returns a structured reason with gap miles, suggestions, **and candidates** — a rich payload the design has no home for. Given §4.4's thin coverage in CT, NJ, WV, MD, SD, ID, MN and MT, this will fire on real lanes, and returning candidates alongside the failure is what lets the dispatcher fall back to judgement rather than hitting a dead end.

`GOOGLE_LINK_NOT_TRUCK_LEGAL` belongs in the driver-link card, whose footnote is currently generic marketing copy rather than the warning.

**Tests.**
- An infeasible plan renders reason, gap miles, all suggestions, and the candidate list.
- Every disclaimer in the array renders; the truck-legality one sits in the driver-link card.
- `RecentTab` styles an `infeasible` row distinctly.
- **Pass:** all three.

### Step 23.2 — The two toggles and the checkbox

**Goal.** Close drift items 1 and 2.

**Files.** Modified: `PlanTab.tsx`.

**Logic.** UI contract §3.8 specifies **two** buttons; the mock has one. They reveal non-overlapping layers and their counts come from different places, so they must not be conflated:
- `Show all sheet stations (N)` — every priced station on the selected sheet, `stationCount` from `GET /price-sheets`, points from a bbox-paged `GET /stations`. Thousands, mostly nowhere near the lane.
- `Show in-corridor not selected (M)` — `candidateStations[]` minus chosen. The solver's own consideration set.

Plus the **"Sent to driver" checkbox** from §3.10, wired to T-19's `PATCH`.

**Tests.**
- Both buttons render with independently-sourced counts.
- Sheet stations draw as green dots, in-corridor-not-selected as amber-ringed hollow dots.
- In-corridor count equals candidates minus chosen, asserted against the arrays.
- Ticking the checkbox persists across a reload.
- **Pass:** all four.

### Step 23.3 — Conditional captions, empty and loading states

**Goal.** Stop the UI asserting things that are not true.

**Files.** New: `EmptyState.tsx`. Modified: `PlanTab.tsx`, `RouteMap.tsx`, `page.tsx`.

**Logic.** Two captions in the stat grid are currently asserted but are really computed claims:
- **"within the leg bounds"** is false whenever relaxation ran. Read `MIN_LEG_RELAXED` and name the short legs instead.
- **"excludes time at the pump"** is only true if dwell time is excluded — now checkable against T-18's separated drive/dwell figures.

Then: empty states for no trips / no candidates / no sheet imported, a request-in-flight spinner, and distinct geocode-failure and provider-outage errors. **No `geometryExpired` map state** — geometry does not expire in v1 (§17), so it is unreachable and is deferred with T-20.

The spinner wraps a **single synchronous `fetch`** — `POST /plans` is not a poll — but 3–10s is long enough that the UI cannot render nothing.

**Tests.**
- A relaxed plan shows the corrected caption naming the short legs; an unrelaxed one shows the original.
- The dwell caption matches the separated figures.
- Each empty state renders on its condition.
- The spinner covers the full request and clears on both success and failure.
- Geocode failure and provider outage render distinct messages.
- **Pass:** all six.

---

# Phase 6 · Ship

## T-24 · Deployment — Vercel + Neon

### Step 24.1 — CI hardening for release

**Goal.** Extend the T-01 gate to cover deployment concerns.

**Files.** Modified: `.github/workflows/ci.yml`.

**Logic.** CI itself was built in **T-01 step 1.4** — it has been gating every merge since the first ticket. What this step adds is release-specific: a production build of the Next app (`npm run build`, catching anything that only fails under the production compiler), and a `concurrency` guard on deploys.

**Tests.**
- CI passes on a clean tree.
- A deliberate schema/descriptor mismatch **fails** CI — re-confirmed here because the drift test only became meaningful once T-02 landed.
- A production build failure fails the check even when dev builds pass.
- **Pass:** all three.

### Step 24.2 — Neon and migrations

**Goal.** The same migration path in production.

**Files.** Modified: root `package.json`.

**Logic.** The T-01 runner is the single path; D8 already removed the Docker-only route, so there is nothing production-specific to invent here.

**Tests.**
- Migrations apply to a fresh Neon branch.
- The drift test passes against Neon.
- PostGIS is available and the GIST indexes exist.
- **Pass:** all three.

### Step 24.3 — Vercel

**Goal.** v1 live.

**Files.** New: `vercel.json`, `docs/RUNBOOK.md`. Modified: `docs/PROJECT-SCOPE.md` §2.

**Logic.** Root directory `frontend`, workspace install from the repo root. **No cron** — T-20 is deferred (§17), so v1 deploys with no scheduled job. Function limits are not a constraint — Fluid Compute gives 300s on Hobby and up to 800s on Pro against a 3–10s solve that is mostly I/O wait.

**§2 needs rewriting.** "Where the project actually stands" currently describes a repository with no backend, which will be false the moment this ships. Leaving it would repeat exactly the failure v1.0 of the scope was written to correct — a document describing work that does not match the repository.

**Needs Q6:** whether this counts as business use, which decides Vercel Pro at $20/mo.

**Tests.**
- A real lane plans end-to-end in production.
- Anonymous API → 401, anonymous page → 307.
- The Vercel project has no cron entries — confirms T-20's deferral is deliberate, not an oversight.
- Attribution is visible in the deployed UI.
- `docs/RUNBOOK.md` covers ingest cadence, backfill and meter checks (no retention section — nothing to schedule).
- **Pass:** all five.

---

# Definition of done

**These checkboxes are the per-step test criteria, not a live status tracker** — they're left unchecked even for merged tickets so the pass condition stays visible. For current build state, see `TICKETS-v2.md`'s ticket index.

## Per ticket

- [ ] **T-01** — `typecheck`, `test` and `db:migrate` all run; migrate is idempotent; compose validates without the init mount.
- [ ] **T-02** — `db:reset` applies; all eleven §12.1 items closed; drift test detects an injected fault; `users` carries `password_hash` and `display_name`.
- [ ] **T-03** — three profiles at `reserve_fraction 0.150` / `min_leg 300`; gazetteer loaded for 50 states; one seeded user; one product code.
- [ ] **T-04** — Next builds with zero type errors; no `.jsx` under `frontend/src`; mock typed as `PlanResponse[]`; drift items 3–5 fixed; visually unchanged.
- [ ] **T-05** — seeded user signs in; anonymous page → 307, anonymous API → 401 problem+json; header shows real identity; tests run session-free.
- [ ] **T-06** — August sheet yields 605 stations and 605 prices; re-run is a no-op; unmapped `PROD` rejects its row and only its row; service prints nothing.
- [ ] **T-07** — 30 dates from 31 files; `2026-01-11` reported as a gap; the byte-identical duplicate skipped; order-independent.
- [ ] **T-08** — 604 `exact` + `operator_verified`; state agreement 604/604; #306 unresolved (temporarily closed); **no price data from the xlsx in the database**.
- [ ] **T-09** — 604/605 resolved, #306 left `unresolved` (temporarily closed); city-tier eligibility rule enforced; TS and Python normalisers agree on all 30 dirty strings.
- [ ] **T-10** — truck route differs from car route; guard throws and suppresses the call; drift computed as a rate with rebaselining; **real rate limits recorded in §8.3**.
- [ ] **T-11** — candidates ordered by position; unpriced stations in `exclusions`; stratified top-K leaves no covered stretch empty.
- [ ] **T-12** — **every §15.6 case passes**, including the final-leg-under-300 acceptance and the carry-fuel-forward case; `dp_v1` never worse than `greedy_v1`; no I/O.
- [ ] **T-13** — legs verified against measured distances; 3-iteration cap returns `NO_STABLE_PLAN`; relaxation sets the flag and the disclaimer; `solve()` still pure.
- [ ] **T-14** — bracket model replaces naive; exactly two N × N matrix calls; estimate retained beside measurement; §15.4.1 figures re-measured.
- [ ] **T-15** — both input shapes; cache hit makes no provider call; expiry honoured; no provider geocode reaches `stations.geom`.
- [ ] **T-16** — end-to-end plan on a real lane; totals reconcile; infeasible persists with candidates; technical failure persists nothing; units convert at the boundary; nulls survive.
- [ ] **T-17** — link opens with stops in order; always-on disclaimer present; conditional ones fire only in condition; wording pinned by test **(needs Q5)**.
- [ ] **T-18** — all twelve UI contract §6 items served or explicitly deferred; `candidateStations[]` fully specified with stable ids; both meters shown separately.
- [ ] **T-19** — flag persists across reload; `dispatched_at` and user recorded; plan content unchanged by the patch.
- [ ] ~~**T-20**~~ — **deferred, not in v1** (§17). Nothing to verify; the "refresh writes to `routes` only" rule is verified under T-16 instead.
- [ ] **T-21** — no component reads a fixture; `trips.ts` deleted; Dev Tools inputs reach the request with `null` preserved.
- [ ] **T-22** — five layers render; pins at real coordinates; uncertainty circles on city-tier; attribution displayed.
- [ ] **T-23** — infeasible, disclaimers, empty, loading and error states all render; both toggles with independent counts; both misleading captions corrected.
- [ ] **T-24** — production plan succeeds; auth enforced; migrations on Neon; cron runs; CI gates on drift **(needs Q6)**.

## Project overall

**Function**
- [ ] A dispatcher signs in, enters origin, destination and truck, and receives a plan.
- [ ] The plan returns a baseline route, an optimised route, selected stops with gallons, price, cost and cumulative distance, map data for both routes, and a Google Maps link.
- [ ] Every leg respects the 500-mile cap **verified against measured distances**, not predicted ones.
- [ ] The 300-mile floor holds except on the final leg, and relaxes with a disclaimer rather than dead-ending.
- [ ] Infeasible lanes return an actionable response with candidates, not a bare error.
- [ ] `priceAsOf` appears on every response.

**Data**
- [ ] 605 stations, all resolved; 604 operator-verified for truck access.
- [ ] Thirty days of January prices plus the August sheet loaded.
- [ ] The `2026-01-11` gap is reported, not hidden.
- [ ] Re-running any import is free.

**Correctness**
- [ ] Every §15.6 optimiser case passes with no database and no network.
- [ ] The carry-fuel-forward case passes — without it the suite does not prove the DP earns its complexity.
- [ ] The schema drift test passes in CI.
- [ ] Totals reconcile between stops and plan.

**Compliance**
- [ ] No provider geocode is stored permanently.
- [ ] Route geometry is retained indefinitely under ORS's ODbL (§17); plans and stops are permanent. A capped provider would reintroduce the 30-day cap.
- [ ] ORS and OSM attribution ships in the API response and renders in the UI.
- [ ] No price data from the operator export is stored anywhere.

**Operability**
- [ ] Both call meters are visible and separate.
- [ ] The budget guard stops calls rather than logging them.
- [ ] ~~The retention cron runs daily.~~ **No cron** — T-20 is deferred (§17); v1 ships no scheduled job at all.
- [ ] `docs/RUNBOOK.md` covers daily operation.

**Honesty of the record**
- [ ] §8.3's rate limits are measured, not carried over unverified.
- [ ] §15.4.1's detour figures are measured, not carried over unverified.
- [ ] §2 describes the repository as it actually is on the day v1 ships.

---

## Deferred, deliberately

Recorded so they are gaps rather than unknowns.

| Item | Why not now | Scope ref |
|---|---|---|
| Stop-penalty tuning | Needs real lanes where a detour is actually taken. v3.4 measured every chosen stop at 0.0 miles of detour, so the penalty term did no work. Tuning against zero evidence is worse than not tuning. | §5.2, §19 step 17 |
| Range-derived leg window | Needs a trustworthy fleet MPG (Q4) and a truck whose physical range falls below the policy cap. No §16 profile is close — the weakest carries 975 miles against a 500-mile cap. | §5.6 |
| HTTP `/imports` routes and upload UI | The operator and the user are the same person; a CLI is faster for them. Revisit the day a second person uses the planner — and the Gmail poller is then the better answer, with the upload route as the exception handler. | §11.2 |
| Gmail poller | Phase 2. `price_imports` is the seam and `ingestFile` does not change. | §20 |
| HERE routing | v1 cannot cash in better truck data while the driver follows a Google *car* route. Adopt when turn-by-turn ships to drivers, or when a coverage probe shows ORS missing restrictions materially. | §8.2 |
| Canada, multi-stop, round trips, user-defined profiles | Additive; the schema already carries `country`, `plan_stops.seq` and `owner_user_id`. | §3, §20 |
| Receipt backtesting | Needs `dispatched_at` accumulating real data. Driver invoices first, OCR second. | §20 Phase 3 |
