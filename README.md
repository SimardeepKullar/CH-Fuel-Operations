# CH Fuel Planner

An internal web app for **2043733 Ontario Inc., DBA CH Logistics**, a trucking company, that does two things:

- **Plan** — a dispatcher enters a load (origin, destination, truck) and gets back a truck-legal route, the cheapest diesel stops along it under a hard 500-mile leg cap, and a Google Maps link to send the driver.
- **Actuals** — a weekly supplier invoice comes in and every transaction, driver, truck, station and express charge on it gets recorded, reconciled against receipts, checked for anomalies, and compared against what was originally planned.

Single supplier (BVD), single fuel product (ULSD), US lanes only, a handful of named internal users — not a multi-tenant product.

## How it's built

```
Next.js (frontend, MapLibre GL) ──▶ Next.js API route ──▶ @ch/core (backend, framework-free) ──▶ Postgres 16 + PostGIS
                                                              │
                                                              ▼
                                                    OpenRouteService (routing/geocoding)
```

- **Node 22, TypeScript, two npm workspaces**: `backend/` (`@ch/core` — pure Node, no HTTP framework, testable without a server) and `frontend/` (Next.js, also where the API mounts).
- **Postgres 16 + PostGIS**, raw `pg` — no ORM, no query builder, parameterized SQL only.
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
cp backend/.env.example .env      # fill in ORS_API_KEY, AUTH_SECRET, SEED_USER_*
npm run db:up                     # Postgres+PostGIS via Docker, on :5433
npm run db:migrate                # applies migrations/synthetic (see below)
npm run seed                      # truck profiles, product code, dispatcher account
npm run dev
```

Requires Docker (for Postgres) and a free [OpenRouteService](https://openrouteservice.org/) API key for routing/geocoding.

### Common commands

```bash
npm run verify          # typecheck && lint && test — the CI gate
npm run test:unit       # backend unit tests only, no database required
npm test                # full suite, needs a live database
npm run db:reset        # destroy and recreate the local database
```

See [CLAUDE.md](CLAUDE.md) for the full command list, branch/PR workflow, and the domain rules (unit handling, ingest invariants, invoice parsing quirks) that are easy to get wrong.

## What's in this repo, and what isn't

This is a real operating company's fuel and invoice data pipeline, so the repo is deliberately split between what's safe to publish and what stays local-only:

**Committed and public:**
- All application source, migrations, tests, and documentation.
- `migrations/synthetic/` — the schema, seeded with an **invented** fleet roster (made-up driver names, fuel-card numbers in a range obviously outside the supplier's real numbering). This is what a fresh clone, CI, and `npm run db:migrate` always apply.
- `backend/test/fixtures/` — small, hand-written synthetic CSV/PDF fixtures standing in for real supplier price sheets and invoices. CI runs entirely against these.
- `data/loves/LovesSearchResults.xlsx` — a public station-locator export (location and amenity fields only; see below).

**Never committed** (`.gitignore`), and not recoverable from this repo's history:
- `data/bvd-prices/` and `data/bvd-invoices/` — the real supplier price sheets and invoices (real contract pricing, real per-driver fuel purchases).
- `migrations/real/` — the real fleet roster (real employee names, real fuel-card numbers), mirroring `migrations/synthetic/` file-for-file so schema and test behavior are identical either way.
- `docs/design/*.dc.html` — exported design mockups that embed real invoice figures as sample data.
- `.env` — local secrets (database URL, API keys, auth secret).

A small number of tests assert exact figures from the real supplier invoice; they're gated behind `describe.skipIf(!hasRealFixture)` and simply skip when the underlying file isn't present — which is always the case in CI and on a fresh clone.

Two supplier-data rules worth knowing if you're reading the code: prices from the station-locator export (`data/loves/`) are never stored, only location/amenity fields — those are street prices, not the negotiated contract prices this app runs on; and geocoded coordinates from the routing provider are never persisted past a 30-day cap, by license (station coordinates come only from the operator export, OpenStreetMap, or the Census gazetteer).

## Documentation

Specs and process live in `docs/`, in the authority order defined in [CLAUDE.md](CLAUDE.md):

1. `migrations/*.sql` — authoritative schema
2. `docs/PROJECT-SCOPE.md` (v1, the planner) and `docs/PROJECT-SCOPE-v2.md` (v2, actuals/reconciliation — wins on conflict)
3. `docs/TICKETS.md` / `docs/TICKETS-v2.md` — the ticket register and current build status
4. `docs/BUILD-PLAN.md` / `docs/BUILD-PLAN-v2.md` — per-ticket implementation steps and test plans
5. `docs/UI-DATA-CONTRACT.md` — frontend data requirements not yet covered by the API spec
6. `docs/HANDOFF-PROMPT.md` — bootstrap prompt for picking the project back up cold

## Status

Built ticket-by-ticket (one branch, one squashed PR, one entry in `docs/TICKETS-v2.md` per ticket). Both the v1 route planner and the v2 actuals/reconciliation build are functionally complete through T-58; see `docs/TICKETS-v2.md` for the current ticket index and any open items.

## License

Private/proprietary. All rights reserved — 2043733 Ontario Inc., DBA CH Logistics.
