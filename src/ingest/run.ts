import { parse } from "csv-parse/sync";
import type { AppEnv } from "../config/env.js";
import type { DbExecutor } from "../db/executor.js";
import { createDirectDbExecutor } from "../db/client.js";
import { downloadZipCsv } from "./download.js";
import {
  emissionsFromVehicle,
  mergeEmissionsCsv,
  normalizeLabel,
  normalizeMpg,
  parseNullableInt,
  parseNullableNumber,
  parseNullableString,
} from "./normalize.js";

type VehicleCsvRow = Record<string, string>;
type EmissionCsvRow = Record<string, string>;

export type IngestStats = {
  vehicleRows: number;
  emissionRows: number;
  vehiclesRetrievedAt: string;
  emissionsRetrievedAt: string;
};

const BATCH_SIZE = 500;

function buildEmissionIndex(rows: EmissionCsvRow[]): Map<string, EmissionCsvRow> {
  const map = new Map<string, EmissionCsvRow>();
  for (const row of rows) {
    const id = row.id?.trim();
    if (!id) continue;
    if (!map.has(id)) map.set(id, row);
  }
  return map;
}

function toSearchKey(value: string): string {
  return value.trim().toLowerCase();
}

type VehicleInsertRow = {
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
  search_make: string;
  search_model: string;
};

function mapVehicleRow(
  row: VehicleCsvRow,
  emissionByVehicleId: Map<string, EmissionCsvRow>,
): VehicleInsertRow | null {
  const id = parseNullableInt(row.id);
  const year = parseNullableInt(row.year);
  const make = normalizeLabel(row.make);
  const model = normalizeLabel(row.model);
  if (id === null || year === null || !make || !model) return null;

  const mpg = normalizeMpg(row);
  let emissions = emissionsFromVehicle(row);
  emissions = mergeEmissionsCsv(
    emissions,
    emissionByVehicleId.get(String(id)),
  );

  return {
    id,
    year,
    make,
    model,
    v_class: parseNullableString(row.VClass),
    drive: parseNullableString(row.drive),
    trany: parseNullableString(row.trany),
    trans_dscr: parseNullableString(row.trans_dscr),
    fuel_type1: parseNullableString(row.fuelType1),
    fuel_type: parseNullableString(row.fuelType),
    cylinders: parseNullableInt(row.cylinders),
    displ: parseNullableNumber(row.displ),
    eng_dscr: parseNullableString(row.eng_dscr),
    city_mpg: mpg.city,
    highway_mpg: mpg.highway,
    combined_mpg: mpg.combined,
    mpg_data_reliable: mpg.mpg_data_reliable,
    co2_g_per_mi: emissions.co2_g_per_mi,
    co2_tailpipe_g_per_mi: emissions.co2_tailpipe_g_per_mi,
    ghg_score: emissions.ghg_score,
    fe_score: emissions.fe_score,
    smog_score: emissions.smog_score,
    smartway_score: emissions.smartway_score,
    emissions_standard: emissions.standard,
    emissions_standard_text: emissions.standard_text,
    raw_modified_on: parseNullableString(row.modifiedOn),
    search_make: toSearchKey(make),
    search_model: toSearchKey(model),
  };
}

async function upsertVehicleBatch(db: DbExecutor, batch: VehicleInsertRow[]): Promise<void> {
  if (batch.length === 0) return;

  const values: unknown[] = [];
  const tuples: string[] = [];
  let param = 1;

  for (const row of batch) {
    const slots = Array.from({ length: 28 }, () => `$${param++}`);
    tuples.push(`(${slots.join(", ")})`);
    values.push(
      row.id,
      row.year,
      row.make,
      row.model,
      row.v_class,
      row.drive,
      row.trany,
      row.trans_dscr,
      row.fuel_type1,
      row.fuel_type,
      row.cylinders,
      row.displ,
      row.eng_dscr,
      row.city_mpg,
      row.highway_mpg,
      row.combined_mpg,
      row.mpg_data_reliable,
      row.co2_g_per_mi,
      row.co2_tailpipe_g_per_mi,
      row.ghg_score,
      row.fe_score,
      row.smog_score,
      row.smartway_score,
      row.emissions_standard,
      row.emissions_standard_text,
      row.raw_modified_on,
      row.search_make,
      row.search_model,
    );
  }

  const sql = `INSERT INTO vehicles (
    id, year, make, model, v_class, drive, trany, trans_dscr,
    fuel_type1, fuel_type, cylinders, displ, eng_dscr,
    city_mpg, highway_mpg, combined_mpg, mpg_data_reliable,
    co2_g_per_mi, co2_tailpipe_g_per_mi, ghg_score, fe_score,
    smog_score, smartway_score, emissions_standard, emissions_standard_text,
    raw_modified_on, search_make, search_model
  ) VALUES ${tuples.join(", ")}
  ON CONFLICT (id) DO UPDATE SET
    year = EXCLUDED.year,
    make = EXCLUDED.make,
    model = EXCLUDED.model,
    v_class = EXCLUDED.v_class,
    drive = EXCLUDED.drive,
    trany = EXCLUDED.trany,
    trans_dscr = EXCLUDED.trans_dscr,
    fuel_type1 = EXCLUDED.fuel_type1,
    fuel_type = EXCLUDED.fuel_type,
    cylinders = EXCLUDED.cylinders,
    displ = EXCLUDED.displ,
    eng_dscr = EXCLUDED.eng_dscr,
    city_mpg = EXCLUDED.city_mpg,
    highway_mpg = EXCLUDED.highway_mpg,
    combined_mpg = EXCLUDED.combined_mpg,
    mpg_data_reliable = EXCLUDED.mpg_data_reliable,
    co2_g_per_mi = EXCLUDED.co2_g_per_mi,
    co2_tailpipe_g_per_mi = EXCLUDED.co2_tailpipe_g_per_mi,
    ghg_score = EXCLUDED.ghg_score,
    fe_score = EXCLUDED.fe_score,
    smog_score = EXCLUDED.smog_score,
    smartway_score = EXCLUDED.smartway_score,
    emissions_standard = EXCLUDED.emissions_standard,
    emissions_standard_text = EXCLUDED.emissions_standard_text,
    raw_modified_on = EXCLUDED.raw_modified_on,
    search_make = EXCLUDED.search_make,
    search_model = EXCLUDED.search_model`;

  await db.queryRows(sql, values);
}

export async function ingestFromCsvText(
  db: DbExecutor,
  vehicleCsv: string,
  emissionsCsv: string,
  vehiclesRetrievedAt: string,
  emissionsRetrievedAt: string,
): Promise<IngestStats> {
  const vehicleRows = parse(vehicleCsv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as VehicleCsvRow[];

  const emissionRows = parse(emissionsCsv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as EmissionCsvRow[];

  const emissionByVehicleId = buildEmissionIndex(emissionRows);

  await db.exec("TRUNCATE vehicles");
  await db.exec("DELETE FROM ingest_metadata");

  const batch: VehicleInsertRow[] = [];
  let inserted = 0;

  for (const row of vehicleRows) {
    const mapped = mapVehicleRow(row, emissionByVehicleId);
    if (!mapped) continue;
    batch.push(mapped);
    if (batch.length >= BATCH_SIZE) {
      await upsertVehicleBatch(db, batch);
      inserted += batch.length;
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    await upsertVehicleBatch(db, batch);
    inserted += batch.length;
  }

  await db.queryRows(
    `INSERT INTO ingest_metadata (id, vehicles_retrieved_at, emissions_retrieved_at, vehicle_row_count, emissions_row_count)
     VALUES (1, $1::timestamptz, $2::timestamptz, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       vehicles_retrieved_at = EXCLUDED.vehicles_retrieved_at,
       emissions_retrieved_at = EXCLUDED.emissions_retrieved_at,
       vehicle_row_count = EXCLUDED.vehicle_row_count,
       emissions_row_count = EXCLUDED.emissions_row_count`,
    [vehiclesRetrievedAt, emissionsRetrievedAt, inserted, emissionRows.length],
  );

  return {
    vehicleRows: vehicleRows.length,
    emissionRows: emissionRows.length,
    vehiclesRetrievedAt,
    emissionsRetrievedAt,
  };
}

export async function ingestFromEpa(env: AppEnv): Promise<IngestStats> {
  const [vehicles, emissions] = await Promise.all([
    downloadZipCsv(env.EPA_VEHICLES_ZIP_URL),
    downloadZipCsv(env.EPA_EMISSIONS_ZIP_URL),
  ]);

  const db = await createDirectDbExecutor(env as AppEnv);
  try {
    return await ingestFromCsvText(
      db,
      vehicles.csvText,
      emissions.csvText,
      vehicles.retrievedAt,
      emissions.retrievedAt,
    );
  } finally {
    await db.close();
  }
}
