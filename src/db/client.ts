import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATION_SQL } from "./schema.js";

export type VehicleRow = {
  id: number;
  year: number;
  make: string;
  model: string;
  v_class: string | null;
  drive: string | null;
  trany: string | null;
  trans_dscr: string | null;
  fuel_type1: string | null;
  fuel_type: string | null;
  cylinders: number | null;
  displ: number | null;
  eng_dscr: string | null;
  city_mpg: number | null;
  highway_mpg: number | null;
  combined_mpg: number | null;
  mpg_data_reliable: number | null;
  co2_g_per_mi: number | null;
  co2_tailpipe_g_per_mi: number | null;
  ghg_score: number | null;
  fe_score: number | null;
  smog_score: number | null;
  smartway_score: number | null;
  emissions_standard: string | null;
  emissions_standard_text: string | null;
  raw_modified_on: string | null;
};

export type IngestMetadata = {
  vehicles_retrieved_at: string;
  emissions_retrieved_at: string | null;
  vehicle_row_count: number;
  emissions_row_count: number;
};

export function openDatabase(databasePath: string): Database.Database {
  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.exec(MIGRATION_SQL);
  return db;
}

export function getIngestMetadata(db: Database.Database): IngestMetadata | null {
  const row = db
    .prepare(
      `SELECT vehicles_retrieved_at, emissions_retrieved_at, vehicle_row_count, emissions_row_count
       FROM ingest_metadata WHERE id = 1`,
    )
    .get() as IngestMetadata | undefined;
  return row ?? null;
}
