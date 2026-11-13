export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS ingest_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  vehicles_retrieved_at TEXT NOT NULL,
  emissions_retrieved_at TEXT,
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
  displ REAL,
  eng_dscr TEXT,
  city_mpg INTEGER,
  highway_mpg INTEGER,
  combined_mpg INTEGER,
  mpg_data_reliable INTEGER,
  co2_g_per_mi REAL,
  co2_tailpipe_g_per_mi REAL,
  ghg_score INTEGER,
  fe_score INTEGER,
  smog_score REAL,
  smartway_score INTEGER,
  emissions_standard TEXT,
  emissions_standard_text TEXT,
  raw_modified_on TEXT,
  search_make TEXT NOT NULL,
  search_model TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicles_year_make_model
  ON vehicles(year, search_make, search_model);
CREATE INDEX IF NOT EXISTS idx_vehicles_year ON vehicles(year);
CREATE INDEX IF NOT EXISTS idx_vehicles_v_class ON vehicles(v_class);
`;
