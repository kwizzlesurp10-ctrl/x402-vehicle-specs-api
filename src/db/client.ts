import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AppEnv } from "../config/env.js";
import { createExecutorFromUrl } from "./executor.js";
import { createPgliteExecutor } from "./pglite.js";
import type { DbExecutor } from "./executor.js";

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
  mpg_data_reliable: boolean | null;
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

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

export function loadMigrationSql(): string {
  return readFileSync(path.join(migrationsDir, "001_init.sql"), "utf8");
}

export async function createDbExecutor(env: AppEnv): Promise<DbExecutor> {
  if (env.NODE_ENV === "test" && !env.DATABASE_URL) {
    return createPgliteExecutor(loadMigrationSql());
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  return createExecutorFromUrl(env.DATABASE_URL);
}

export async function createDirectDbExecutor(env: AppEnv): Promise<DbExecutor> {
  const url = env.DIRECT_URL ?? env.DATABASE_URL;
  if (!url) {
    throw new Error("DIRECT_URL or DATABASE_URL is required for ingest/migrations");
  }
  return createExecutorFromUrl(url);
}

export async function getIngestMetadata(
  db: DbExecutor,
): Promise<IngestMetadata | null> {
  return db.queryOne<IngestMetadata>(
    `SELECT vehicles_retrieved_at::text, emissions_retrieved_at::text,
            vehicle_row_count, emissions_row_count
     FROM ingest_metadata WHERE id = 1`,
  );
}
