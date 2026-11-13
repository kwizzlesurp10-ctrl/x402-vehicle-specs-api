-- EPA vehicle specs + x402 jobs (Postgres / Supabase)

CREATE TABLE IF NOT EXISTS ingest_metadata (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  vehicles_retrieved_at TIMESTAMPTZ NOT NULL,
  emissions_retrieved_at TIMESTAMPTZ,
  vehicle_row_count INTEGER NOT NULL,
  emissions_row_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  v_class TEXT,
  drive TEXT,
  trany TEXT,
  trans_dscr TEXT,
  fuel_type1 TEXT,
  fuel_type TEXT,
  cylinders INTEGER,
  displ DOUBLE PRECISION,
  eng_dscr TEXT,
  city_mpg INTEGER,
  highway_mpg INTEGER,
  combined_mpg INTEGER,
  mpg_data_reliable BOOLEAN,
  co2_g_per_mi DOUBLE PRECISION,
  co2_tailpipe_g_per_mi DOUBLE PRECISION,
  ghg_score INTEGER,
  fe_score INTEGER,
  smog_score DOUBLE PRECISION,
  smartway_score INTEGER,
  emissions_standard TEXT,
  emissions_standard_text TEXT,
  raw_modified_on TEXT,
  search_make TEXT NOT NULL,
  search_model TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicles_year_make_model
  ON vehicles (year, search_make, search_model);
CREATE INDEX IF NOT EXISTS idx_vehicles_year ON vehicles (year);
CREATE INDEX IF NOT EXISTS idx_vehicles_v_class ON vehicles (v_class);
CREATE INDEX IF NOT EXISTS idx_vehicles_search_make ON vehicles (search_make);
CREATE INDEX IF NOT EXISTS idx_vehicles_search_model ON vehicles (search_model);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  depth TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json JSONB NOT NULL,
  result_json JSONB,
  error_message TEXT,
  webhook_url TEXT,
  payment_usd DOUBLE PRECISION NOT NULL,
  refund_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  verifier_passed BOOLEAN,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at);

CREATE TABLE IF NOT EXISTS job_flywheel (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  anonymized_input_json JSONB NOT NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_flywheel_type_created ON job_flywheel (job_type, created_at);
