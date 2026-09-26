-- Planning schema: everything the forward-looking half of the app needs —
-- price ingest, stations, routes, plans and provider metering — plus the
-- tables the actuals schema (0003) also references: users, trucks and
-- stations. `trucks` is defined here (T-56), not in 0003, because `routes`
-- and `plans` below need it first; 0003's truck_assignments/fuel_stops/
-- express_charges reference this same table. Nothing in this file
-- references an actuals-only table.
--
-- Storage is miles and gallons (CLAUDE.md), so every distance column is
-- `_miles`. A unit is converted at the ORS adapter, at a PostGIS geography call
-- and at the API — never in the schema. Durations stay in seconds.
--
-- Schema only; seed rows live in 0002_planning_seed.sql.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Reference ───────────────────────────────────────────────────────────

CREATE TABLE place_centroids (
  state_usps       char(2) NOT NULL,
  name_normalized  text    NOT NULL,
  name_raw         text    NOT NULL,
  geoid            text,
  geom             geography(Point,4326) NOT NULL,
  land_area_sqmi   numeric(10,4),
  uncertainty_miles numeric(8,3) NOT NULL,
  source           text NOT NULL,
  PRIMARY KEY (state_usps, name_normalized)
);

CREATE TABLE product_codes (
  supplier      text NOT NULL,
  raw_code      text NOT NULL,
  product_type  text NOT NULL
    CHECK (product_type IN ('highway_diesel','off_road_diesel','gasoline','def','other')),
  mapped_by     text NOT NULL,
  mapped_at     timestamptz NOT NULL DEFAULT now(),
  notes         text,
  PRIMARY KEY (supplier, raw_code)
);

-- ─── Users and locations ─────────────────────────────────────────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  role          text NOT NULL DEFAULT 'dispatcher'
                  CHECK (role IN ('dispatcher','driver','admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label          text,
  address_raw    text NOT NULL,
  address_norm   text NOT NULL UNIQUE,
  matched_label  text,                     -- the geocoder's own formatted match (T-15); distinct from `label`, a dispatcher-set favourite name never written by the resolver
  geom           geography(Point,4326) NOT NULL,
  geocode_source text NOT NULL,
  geocoded_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,     -- provider geocodes: 30-day cap
  use_count      integer NOT NULL DEFAULT 0
);

-- ─── Trucks ───────────────────────────────────────────────────────────────
-- One row per real fleet unit (T-56): trucks and the abstract mpg/tank
-- "truck_profiles" class this table used to sit beside are collapsed into
-- one table, because every plan is for one of the 27 known real trucks —
-- there is no use case for planning "for a truck like unit 072" that isn't
-- better served by just picking 072. unit_number is text, never integer:
-- '072' and '1012' coexist and the leading zero is meaningful (D18).
--
-- The 7 planning fields are nullable at the schema level — there is zero
-- real per-unit mpg/tank/dimension data yet, only the old abstract classes'
-- numbers — but 0005_fleet_roster_seed.sql seeds every row to one flagged
-- working default so planning never silently no-ops. The 8 dimension
-- fields are real per-truck attributes, informational until a routing
-- feature (low-bridge/weight-restriction routing) reads them.
CREATE TABLE trucks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_number          text NOT NULL UNIQUE,

  -- fuel model (§5) — the 7 fields the optimiser actually reads
  tank_gallons         numeric(6,1),
  avg_mpg              numeric(4,2),
  reserve_fraction     numeric(4,3),
  max_leg_miles        numeric(6,1),
  min_leg_miles        numeric(6,1),
  cost_per_mile_usd    numeric(6,3),
  fixed_stop_minutes   integer,

  -- physical spec → routing provider (not wired into ORS calls yet)
  max_gallons_per_fill numeric(6,1),
  gross_weight_kg      integer,
  height_cm            integer,
  width_cm             integer,
  length_cm            integer,
  axle_count           smallint,
  trailer_count        smallint,
  hazmat_class         text,

  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CHECK (avg_mpg IS NULL OR avg_mpg > 0),
  CHECK (tank_gallons IS NULL OR tank_gallons > 0),
  CHECK (min_leg_miles IS NULL OR max_leg_miles IS NULL OR min_leg_miles <= max_leg_miles),
  CHECK (reserve_fraction IS NULL OR (reserve_fraction >= 0 AND reserve_fraction < 0.5))
);

-- ─── Stations ────────────────────────────────────────────────────────────

CREATE TABLE stations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier            text NOT NULL,
  site_ref            text NOT NULL,        -- BVD's SITE
  name_raw            text NOT NULL,        -- "LOVES #368"
  brand_normalized    text,                 -- "LOVES"
  store_number        integer,              -- 368 — the operator/OSM join key
  city_raw            text NOT NULL,
  city_normalized     text NOT NULL,
  state_usps          char(2) NOT NULL,
  country             char(2) NOT NULL DEFAULT 'US',

  geom                geography(Point,4326),
  resolution          text NOT NULL DEFAULT 'unresolved'
                        CHECK (resolution IN ('exact','city','unresolved')),
  uncertainty_miles   numeric(8,3),
  resolution_source   text,
  resolved_at         timestamptz,

  truck_accessible    text NOT NULL DEFAULT 'unverified'
                        CHECK (truck_accessible IN ('operator_verified','osm_verified',
                                                    'unverified','excluded')),
  osm_id              text,
  osm_tags            jsonb,
  operator_attrs      jsonb,                -- StoreType, ParkingSpaces, DEFLanes.
                                            -- NEVER prices — see §17.1.
  max_gallons_per_txn numeric(6,1),

  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (supplier, site_ref)
);

CREATE INDEX stations_geom_gix   ON stations USING GIST (geom);
CREATE INDEX stations_resolution ON stations (resolution) WHERE resolution <> 'unresolved';
CREATE INDEX stations_store_num  ON stations (brand_normalized, store_number);

CREATE TABLE station_geocode_candidates (
  id            bigserial PRIMARY KEY,
  station_id    uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  rank          smallint NOT NULL,
  geom          geography(Point,4326) NOT NULL,
  source        text NOT NULL,
  score         numeric(5,4),
  uncertainty_miles numeric(8,3),
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Imports and prices ──────────────────────────────────────────────────

CREATE TABLE import_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label        text,
  file_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE price_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid REFERENCES import_batches(id),
  supplier        text NOT NULL,
  company_id      text,
  country         char(2) NOT NULL DEFAULT 'US',
  source_filename text NOT NULL,
  file_sha256     char(64) NOT NULL UNIQUE,   -- the idempotency key
  effective_date  date NOT NULL,              -- from the header. NOT unique — see §12.1
  received_at     timestamptz,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','parsing','validating','completed','failed')),
  rows_read       integer,
  rows_accepted   integer,
  rows_rejected   integer,
  report          jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX price_imports_effective ON price_imports (supplier, effective_date);

CREATE TABLE import_rejections (
  id          bigserial PRIMARY KEY,
  import_id   uuid NOT NULL REFERENCES price_imports(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  site_ref    text,
  code        text NOT NULL,
  message     text NOT NULL
);

CREATE TABLE station_prices (
  id             bigserial PRIMARY KEY,
  station_id     uuid   NOT NULL REFERENCES stations(id),
  import_id      uuid   NOT NULL REFERENCES price_imports(id) ON DELETE CASCADE,
  raw_product    text   NOT NULL,
  product_type   text   NOT NULL,   -- denormalised at import; see §15.4

  cost           numeric(8,4),
  federal_tax    numeric(8,4),
  state_tax      numeric(8,4),
  sales_tax      numeric(8,4),
  freight        numeric(8,4),
  other          numeric(8,4),
  total_cost     numeric(8,4),
  retail_price   numeric(8,4),
  your_price     numeric(8,4),   -- = min(total_cost, retail_price); READ, never compute
  savings        numeric(8,4),

  price_pump     numeric(8,4) GENERATED ALWAYS AS (your_price) STORED,
  price_ifta_net numeric(8,4) GENERATED ALWAYS AS
                   (COALESCE(cost,0) + COALESCE(freight,0)
                    + COALESCE(other,0) + COALESCE(federal_tax,0)) STORED,

  valid_on       date NOT NULL,   -- exactly one day. Not a range.

  UNIQUE (station_id, raw_product, valid_on)
);

CREATE INDEX station_prices_lookup ON station_prices (valid_on, product_type, station_id);

-- ─── Routes and plans ────────────────────────────────────────────────────

-- ORS geometry is ODbL and carries no storage cap, so v1 keeps it indefinitely
-- and there is no expiry column or trigger. Geometry stays nullable: adopting a
-- contractually capped provider (HERE, Google) reintroduces expiry, and the
-- retention job then needs somewhere to null it to. See §17.
CREATE TABLE routes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL,
  request_hash     char(64) NOT NULL,
  origin_geom      geography(Point,4326) NOT NULL,
  destination_geom geography(Point,4326) NOT NULL,
  truck_id         uuid NOT NULL REFERENCES trucks(id),
  via_hash         char(64),
  line             geography(LineString,4326),   -- NULLABLE: see §17
  polyline         text,                         -- NULLABLE: see §17
  legs             jsonb,                        -- NULLABLE: see §17
  distance_miles   numeric(9,3)  NOT NULL,       -- scalar: permanent
  duration_s       integer NOT NULL,             -- scalar: permanent
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, request_hash)
);

CREATE INDEX routes_line_gix ON routes USING GIST (line);

CREATE TABLE plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by           uuid REFERENCES users(id),
  base_route_id        uuid NOT NULL REFERENCES routes(id),
  optimized_route_id   uuid REFERENCES routes(id),
  -- T-56: every plan is for one of the 27 real trucks, no exceptions — the
  -- abstract truck_profiles class this column used to name is gone, and
  -- unlike that class this FK is NOT NULL from creation.
  truck_id             uuid NOT NULL REFERENCES trucks(id),
  -- T-16: the geocoder's resolved label, echoed back so GET can rebuild the
  -- exact same ResolvedLocation without a live re-geocode (UI contract §6.10).
  -- NULL for a {lat,lng} request, which typed no address to resolve.
  origin_label         text,
  destination_label    text,

  optimizer_strategy   text NOT NULL DEFAULT 'dp_v1',
  price_basis          text NOT NULL DEFAULT 'pump'
                         CHECK (price_basis IN ('pump','ifta_net','total_cost')),
  start_fuel_gallons   numeric(6,1) NOT NULL,
  min_arrival_gallons  numeric(6,1) NOT NULL,
  max_leg_miles        numeric(6,1) NOT NULL,
  min_leg_miles        numeric(6,1) NOT NULL,
  min_leg_relaxed      boolean      NOT NULL DEFAULT false,   -- §5.1 two-pass fallback
  corridor_miles       numeric(6,1) NOT NULL,                 -- T-16: straight-line screening radius (§15.1)
  max_detour_miles     numeric(5,1),                          -- T-16: nullable; NULL = no cap on a stop's routed detour
  driver_cost_per_hour numeric(7,2) NOT NULL DEFAULT 0,
  fixed_stop_minutes   integer      NOT NULL DEFAULT 20,
  max_stops            smallint,

  status               text NOT NULL
                         CHECK (status IN ('completed','infeasible')),
  -- T-16: the full structured InfeasibleReason (code, message, gap figures,
  -- suggestions), not just a message string — GET must round-trip the same
  -- body POST returned, and a dispatcher's fallback suggestions live here.
  infeasible_reason    jsonb,

  total_fuel_cost_usd  numeric(10,2),
  total_gallons        numeric(8,2),
  total_distance_miles numeric(9,3),
  total_duration_s     integer,
  baseline_cost_usd    numeric(10,2),
  price_as_of          date,
  -- T-16: the request's wall-clock solve time (UI contract §6.7). Unlike
  -- stationsScanned/candidateStations, this cannot be recomputed on a later
  -- GET — a re-fetch's own latency is not the original solve's — so it is
  -- the one piece of solve telemetry that must be stored.
  solve_ms             integer      NOT NULL,
  google_maps_url      text,
  disclaimers          jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  dispatched_at        timestamptz   -- set when a human actually sends this plan to a driver; NULL = computed only
);

CREATE TABLE plan_stops (
  id                   bigserial PRIMARY KEY,
  plan_id              uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  seq                  smallint NOT NULL,
  stop_type            text NOT NULL DEFAULT 'fuel'
                         CHECK (stop_type IN ('fuel','rest','delivery')),
  station_id           uuid   REFERENCES stations(id),
  station_price_id     bigint REFERENCES station_prices(id),

  offset_along_route_miles numeric(9,3) NOT NULL,
  leg_distance_miles   numeric(9,3)  NOT NULL,   -- from the previous fill
  detour_distance_miles numeric(7,3) NOT NULL DEFAULT 0,
  detour_duration_s    integer      NOT NULL DEFAULT 0,

  arrival_gallons      numeric(6,2) NOT NULL,
  purchase_gallons     numeric(6,2) NOT NULL,
  departure_gallons    numeric(6,2) NOT NULL,
  unit_price_usd       numeric(8,4) NOT NULL,    -- literal, not a join. See §17.
  stop_cost_usd        numeric(9,2) NOT NULL,

  cum_distance_miles   numeric(9,3)  NOT NULL,
  cum_duration_s       integer      NOT NULL,

  UNIQUE (plan_id, seq)
);

-- ─── Provider metering (§8.3) ────────────────────────────────────────────

CREATE TABLE provider_usage (        -- ours: a daily call ceiling per endpoint; period = UTC day
  provider   text NOT NULL,
  period     date NOT NULL,
  endpoint   text NOT NULL,
  call_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, period, endpoint)
);

CREATE TABLE provider_quota (        -- theirs: an observed rate limit, no stated window
  provider     text NOT NULL,
  endpoint     text NOT NULL,
  limit_value  integer,
  remaining    integer,
  observed_at  timestamptz NOT NULL,
  prev_remaining integer,
  prev_observed_at timestamptz,
  PRIMARY KEY (provider, endpoint)
);
