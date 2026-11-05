# CH Fuel Operations

An internal web app for **2043733 Ontario Inc., DBA CH Logistics**, a trucking company, that does two things:

- **Plan** — a dispatcher enters a load (origin, destination, truck) and gets back a truck-legal route, the cheapest diesel stops along it under a hard 500-mile leg cap, and a Google Maps link to send the driver.
- **Actuals** — a weekly supplier invoice comes in and every transaction, driver, truck, station and express charge on it gets recorded, reconciled against receipts, checked for anomalies, and compared against what was originally planned.

Single supplier (BVD), single fuel product (ULSD), US lanes only, a handful of named internal users — not a multi-tenant product.

## How it's built

```
Next.js (frontend, MapLibre GL) ──▶ Next.js API route ──▶ @ch/core (backend, framework-free) ──▶ Postgres 18 + PostGIS
                                                              │
                                                              ▼
                                                    OpenRouteService (routing/geocoding)
```

- **Node 22, TypeScript, two npm workspaces**: `backend/` (`@ch/core` — pure Node, no HTTP framework, testable without a server) and `frontend/` (Next.js, also where the API mounts).
- **Postgres 18 + PostGIS**, raw `pg` — no ORM, no query builder, parameterized SQL only.
- **Zod** for validation, **vitest** for tests, **MapLibre GL JS** for the map, **OpenRouteService** for routing/geocoding.
- Distances are stored and returned in **miles and gallons** throughout; the metric/imperial conversion happens at exactly four defined boundaries (see [CLAUDE.md](CLAUDE.md)).

### Backend modules (`backend/src/`)

| Module | Responsibility |
|---|---|
| `catalog/` | Trucks, drivers, fuel cards, stations, price sheets, saved locations, geocoding — the shared reference layer |
| `ingest/` | BVD price-sheet CSV ingest |
| `invoice/` | BVD invoice parsing (PDF and portal CSV) |
| `resolution/`, `resolve/` | Matching raw invoice rows to known drivers/trucks/stations |
| `anomaly/` | Rule-based checks over resolved transactions (sub-gallon fills, price-above-published, DEF ratio, etc.) |
| `actuals/` | Transactions, receipts, rollups, driver/truck/station reporting |
| `routing/` | OpenRouteService adapter, geocoding, request budget guard |
| `planning/`, `optimizer/`, `planActual/` | Route planning, the stop-selection optimiser, and plan-vs-actual comparison |
| `domain/` | Shared domain types |
| `api/` | Framework-free route handlers, mounted by the Next.js app |
| `cli/` | `ingest`, `backfill`, `import-invoice`, `backfill-invoices`, `resolve`, `reresolve`, `seed`, `serve` — argv/stdout only, no business logic of their own |
| `db/` | Connection pool and the migration runner |

### Frontend (`frontend/src/`)

Next.js app (Auth.js credentials login, JWT sessions, single seeded user) with a Plan tab, a Recent-plans tab, and an Actuals side (transactions, overview, receipt queue, drivers/trucks/stations, plan-vs-actual) — see `docs/PROJECT-SCOPE-v2.md` §A8 for the full screen list.

## Getting started

```bash
git clone https://github.com/SimardeepKullar/CH-Fuel-Operations.git
cd CH-Fuel-Operations
npm install
cp .env.example .env              # fill in ORS_API_KEY, AUTH_SECRET, SEED_USER_*
npm run db:up                     # Postgres+PostGIS via Docker, on :5433
npm run db:create                 # ch_fuel_dev, ch_fuel_test, ch_fuel_real
npm run db:migrate                # applies migrations/synthetic to ch_fuel_dev (see below)
npm run db:migrate:test           # and to ch_fuel_test, which `npm test` uses
npm run seed                      # truck profiles, product code, dispatcher account
npm run dev
```

Requires Docker (for Postgres) and a free [OpenRouteService](https://openrouteservice.org/) API key for routing/geocoding.

### Common commands

```bash
npm run verify          # typecheck && lint && test — the CI gate
npm run test:unit       # backend unit tests only, no database required
npm test                # full suite, in ch_fuel_test
npm run db:reset        # drop and recreate ch_fuel_dev only, then seed
npm run db:backup       # dump the current APP_ENV's database into backups/ (see below)
```

See [CLAUDE.md](CLAUDE.md) for the full command list, branch/PR workflow, and the domain rules (unit handling, ingest invariants, invoice parsing quirks) that are easy to get wrong.

## Backups and restores

### Local backups (T-101)

```powershell
npm run db:backup                                   # the current APP_ENV's database (default: ch_fuel_dev)
$env:APP_ENV='real'; npm run db:backup              # ch_fuel_real
npm run db:restore-to-real -- backups/<file>.dump   # replace ch_fuel_real from a dump
```

- **`db:backup`:**
  - writes `backups/<env>-<database>-<UTC time>.dump` and a `.counts.json` beside it, holding exact row counts from the same snapshot as the dump;
  - prints the target first, never the password;
  - is read-only, so it runs against any environment.
- **`backups/` is gitignored:** it holds real data.
- **`BACKUP_DIR` moves the dumps out of the repo** (for example out of a OneDrive-synced folder). Set it in `.env`, any `.env.<APP_ENV>.local`, or the shell; a relative value is resolved against the repo root, and the directory is created if missing. It applies to `db:backup`, the dump `db:restore-to-real` takes before replacing `ch_fuel_real`, and the dump `db:reset:real` takes first. `db:restore-to-real -- <file>` still takes the file's path as given. Unset means `backups/`.
- **`pg_dump` runs inside the Docker container,** so PowerShell never re-encodes the binary file.
- **`db:restore-to-real`** goes through the destructive-operation guard. It:
  1. checks that the file is a readable `pg_dump -Fc` archive;
  2. dumps the current `ch_fuel_real` to `backups/` (and stops if that fails);
  3. recreates `ch_fuel_real` and restores into it;
  4. fails if the restored row counts differ from the dump's `.counts.json`.

  It lists pending `migrations/real` files but does not apply them.

### Production on Neon

> **Postgres versions must match.**
> - The Neon project runs Postgres **18** (18.6, read from a prod dump on 2026-11-05), and the local container and CI match it (`postgis/postgis:18-3.6`).
> - A dump made by a newer major version's `pg_dump` cannot be restored by an older `pg_restore`, which is why they are kept in step: a prod dump restores into `ch_fuel_real` with `db:restore-to-real`.
> - If Neon's major ever moves ahead of the container, move `docker-compose.yml`, `ci.yml`, `LOCAL_PG_MAJOR` (`backend/src/db/backup.ts`) and `RECOMMENDED_MAJOR` (`backend/src/cli/migrateProd.ts`) with it.

**Before every prod migration, take a snapshot branch:** create a Neon branch from `production`, named `pre-<ticket>-<date>`.

```bash
neon branches create --name pre-T-102-2026-11-05 --parent production
```

(`neon` is Neon's CLI, formerly `neonctl`. The console's *Branches → Create branch* does the same.) The branch is an instant copy of `production` at that moment.

**If the migration or release goes wrong,** restore `production` from that branch. Keep the broken state as its own branch, in case you need to look at it:

```bash
neon branches restore production pre-T-102-2026-11-05 --preserve-under-name production-broken-2026-11-05
```

- Then check the app and the data.
- Delete `production-broken-…` and the `pre-…` branch once you are sure: `neon branches delete <name>`.
- **Never run `db:reset` or `db:restore-to-real` to fix production.** Both are local-only and refused by the guard.

**Applying a migration to production (`db:migrate:prod`, T-103).** It is unit-tested against a fake pool only, not yet run against a real Neon server.

```powershell
$env:APP_ENV='production'; npm run db:migrate:prod              # preview: applies nothing
$env:APP_ENV='production'; npm run db:migrate:prod -- --confirm # apply
```

- **Needs `APP_ENV=production` set in the shell,** and a `.env.production.local` that you create yourself, holding the Neon **direct** connection string. A `-pooler` host is refused.
- **Without `--confirm` it only previews:** the target (environment, host, database; never the password), the server's Postgres version, and the pending `migrations/real` files. It reminds you to create the `pre-<ticket>-<date>` snapshot branch first.
- **It warns, and does not block,** when the server's Postgres major version is not 18.
- **It applies `migrations/real` and nothing else.** It never resets, seeds or drops, and a test proves there is no code path from it to a reset. It runs from your machine because `migrations/real` is gitignored.
- **It refuses to run** if `migrations/synthetic` and `migrations/real` do not have identical filenames; a test checks the same on every run where `migrations/real` exists.

**What to check on the Neon plan.** These change between plans and over time, so read them in the Neon console and docs rather than assuming them:

- **History / point-in-time restore window:** how far back `production` can be restored without a snapshot branch.
- **Branch limit:** each `pre-…` branch counts, so delete old ones.
- **Branch storage:** whether the storage a branch holds onto, as `production` moves away from it, is billed.
- **Compute:** whether a branch's compute starts and uses compute hours when it isn't queried, and how long until it suspends.
- **Restoring the default/root branch:** whether `production` can be restored in place on your plan, and whether computes restart during it.

**A local copy of prod as well (unit-tested only, not yet run against a real Neon server).**
- `$env:APP_ENV='production'; npm run db:backup` would dump prod into `backups/`.
- **Use the direct URL:** it reads the URL from `.env.production.local`, which must hold the **direct** connection string. A `-pooler` host is refused.
- **Version-matched:** it runs `pg_dump` from a `postgres:<server major>` container.
- **No password in arguments:** the connection string is passed to that container through an environment variable, never as an argument.

## What's in this repo, and what isn't

This is a real operating company's fuel and invoice data pipeline, so the repo is deliberately split between what's safe to publish and what stays local-only:

**Committed and public:**
- All application source, migrations, tests, and documentation.
- `migrations/synthetic/` — the schema, seeded with an **invented** fleet roster (made-up driver names, fuel-card numbers in a range obviously outside the supplier's real numbering). This is what a fresh clone, CI, and `npm run db:migrate` always apply.
- `backend/test/fixtures/` — small, hand-written synthetic CSV/PDF fixtures standing in for real supplier price sheets and invoices. CI runs entirely against these.
- `data/US-CA-GasStations/LovesSearchResults.xlsx` — a public station-locator export (location and amenity fields only; see below).

**Never committed** (`.gitignore`), and not recoverable from this repo's history:
- `data/bvd-prices/` and `data/bvd-invoices/` — the real supplier price sheets and invoices (real contract pricing, real per-driver fuel purchases).
- `migrations/real/` — the real fleet roster (real employee names, real fuel-card numbers), mirroring `migrations/synthetic/` file-for-file so schema and test behavior are identical either way.
- `docs/design/*.dc.html` — exported design mockups that embed real invoice figures as sample data.
- `.env`, `.env.*.local` and `.env.production*` — local secrets (API keys, auth secret, the production database URL). `.env.development`, `.env.test` and `.env.real` are committed: they hold only the local Docker database URL.

A small number of tests assert exact figures from the real supplier invoice; they're gated behind `describe.skipIf(!hasRealFixture)` and simply skip when the underlying file isn't present — which is always the case in CI and on a fresh clone.

Two supplier-data rules worth knowing if you're reading the code: prices from the station-locator export (`data/US-CA-GasStations/`) are never stored, only location/amenity fields — those are street prices, not the negotiated contract prices this app runs on; and geocoded coordinates from the routing provider are never persisted past a 30-day cap, by license (station coordinates come only from the operator export, OpenStreetMap, or the Census gazetteer).

## Documentation

Specs and process live in `docs/`, in the authority order defined in [CLAUDE.md](CLAUDE.md):

1. `migrations/*.sql` — authoritative schema
2. `docs/PROJECT-SCOPE.md` (v1, the planner) and `docs/PROJECT-SCOPE-v2.md` (v2, actuals/reconciliation — wins on conflict)
3. GitHub issues `T-NN · <title>` — one per ticket, with its definition of done and build steps; the "CH Fuel Planner" project board tracks their status
4. `docs/UI-DATA-CONTRACT.md` — frontend data requirements not yet covered by the API spec
5. `docs/HANDOFF-PROMPT.md` — bootstrap prompt for picking the project back up cold

## Status

Built ticket-by-ticket (one issue, one branch, one squashed PR per ticket). Both the v1 route planner and the v2 actuals/reconciliation build are functionally complete through T-58; see the project board for open tickets.

## License

Private/proprietary. All rights reserved — 2043733 Ontario Inc., DBA CH Logistics.
