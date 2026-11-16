-- Vehicle lookup / search query performance (additive)
--
-- IMPORTANT: Run this file OUTSIDE a transaction. CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block. In Supabase: SQL Editor → paste → Run.
-- It is excluded from `npm run migrate` (see loadMigrationSql in src/db/client.ts).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GET /v1/vehicles/search, /v1/models, job fleet lookup — case-insensitive model substring
-- (search_model LIKE '%' || $1 || '%' with year + search_make equality)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_search_model_trgm
  ON vehicles USING gin (search_model gin_trgm_ops);

-- GET /v1/makes?year= — DISTINCT make … ORDER BY make
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_year_make
  ON vehicles (year, make);

-- GET /v1/models?year=&make= — DISTINCT model … ORDER BY model
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_year_search_make_model
  ON vehicles (year, search_make, model);

-- GET /v1/stats?year=&class= — aggregates and GROUP BY cylinders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_year_v_class
  ON vehicles (year, v_class);

-- DOWN (rollback — run outside a transaction, e.g. Supabase SQL Editor)
-- DROP INDEX CONCURRENTLY IF EXISTS idx_vehicles_year_v_class;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_vehicles_year_search_make_model;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_vehicles_year_make;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_vehicles_search_model_trgm;
-- DROP EXTENSION IF EXISTS pg_trgm;