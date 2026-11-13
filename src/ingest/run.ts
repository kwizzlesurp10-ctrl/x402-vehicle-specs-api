import { parse } from "csv-parse/sync";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/client.js";
import type { AppEnv } from "../config/env.js";
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

export function ingestFromCsvText(
  db: Database.Database,
  vehicleCsv: string,
  emissionsCsv: string,
  vehiclesRetrievedAt: string,
  emissionsRetrievedAt: string,
): IngestStats {
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

  const insert = db.prepare(`
    INSERT INTO vehicles (
      id, year, make, model, v_class, drive, trany, trans_dscr,
      fuel_type1, fuel_type, cylinders, displ, eng_dscr,
      city_mpg, highway_mpg, combined_mpg, mpg_data_reliable,
      co2_g_per_mi, co2_tailpipe_g_per_mi, ghg_score, fe_score,
      smog_score, smartway_score, emissions_standard, emissions_standard_text,
      raw_modified_on, search_make, search_model
    ) VALUES (
      @id, @year, @make, @model, @v_class, @drive, @trany, @trans_dscr,
      @fuel_type1, @fuel_type, @cylinders, @displ, @eng_dscr,
      @city_mpg, @highway_mpg, @combined_mpg, @mpg_data_reliable,
      @co2_g_per_mi, @co2_tailpipe_g_per_mi, @ghg_score, @fe_score,
      @smog_score, @smartway_score, @emissions_standard, @emissions_standard_text,
      @raw_modified_on, @search_make, @search_model
    )
  `);

  const run = db.transaction(() => {
    db.exec("DELETE FROM vehicles");
    db.exec("DELETE FROM ingest_metadata");

    for (const row of vehicleRows) {
      const id = parseNullableInt(row.id);
      const year = parseNullableInt(row.year);
      const make = normalizeLabel(row.make);
      const model = normalizeLabel(row.model);
      if (id === null || year === null || !make || !model) continue;

      const mpg = normalizeMpg(row);
      let emissions = emissionsFromVehicle(row);
      emissions = mergeEmissionsCsv(
        emissions,
        emissionByVehicleId.get(String(id)),
      );

      insert.run({
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
        mpg_data_reliable:
          mpg.mpg_data_reliable === null ? null : mpg.mpg_data_reliable ? 1 : 0,
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
      });
    }

    db.prepare(
      `INSERT INTO ingest_metadata (id, vehicles_retrieved_at, emissions_retrieved_at, vehicle_row_count, emissions_row_count)
       VALUES (1, @vehicles_retrieved_at, @emissions_retrieved_at, @vehicle_row_count, @emissions_row_count)`,
    ).run({
      vehicles_retrieved_at: vehiclesRetrievedAt,
      emissions_retrieved_at: emissionsRetrievedAt,
      vehicle_row_count: vehicleRows.length,
      emissions_row_count: emissionRows.length,
    });
  });

  run();

  return {
    vehicleRows: vehicleRows.length,
    emissionRows: emissionRows.length,
    vehiclesRetrievedAt,
    emissionsRetrievedAt,
  };
}

export async function ingestFromEpa(env: Pick<
  AppEnv,
  "DATABASE_PATH" | "EPA_VEHICLES_ZIP_URL" | "EPA_EMISSIONS_ZIP_URL"
>): Promise<IngestStats> {
  const [vehicles, emissions] = await Promise.all([
    downloadZipCsv(env.EPA_VEHICLES_ZIP_URL),
    downloadZipCsv(env.EPA_EMISSIONS_ZIP_URL),
  ]);

  const db = openDatabase(env.DATABASE_PATH);
  try {
    return ingestFromCsvText(
      db,
      vehicles.csvText,
      emissions.csvText,
      vehicles.retrievedAt,
      emissions.retrievedAt,
    );
  } finally {
    db.close();
  }
}
