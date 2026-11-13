import type { IngestMetadata, VehicleRow } from "../db/client.js";
import {
  SOURCE_EMISSIONS_BULK,
  SOURCE_VEHICLE_BULK,
  type SourceMeta,
} from "../lib/attribution.js";

export type VehicleSpecs = {
  id: number;
  year: number;
  make: string;
  model: string;
  vehicle_class: string | null;
  drivetrain: string | null;
  transmission: string | null;
  transmission_detail: string | null;
  fuel_type_primary: string | null;
  fuel_type: string | null;
  cylinders: number | null;
  displacement_l: number | null;
  engine_description: string | null;
  mpg: {
    city: number | null;
    highway: number | null;
    combined: number | null;
    epa_data_reliable: boolean | null;
  };
  emissions: {
    co2_g_per_mi: number | null;
    co2_tailpipe_g_per_mi: number | null;
    ghg_score: number | null;
    fe_score: number | null;
    smog_score: number | null;
    smartway_score: number | null;
    standard: string | null;
    standard_text: string | null;
  };
  epa_modified_on: string | null;
  missing_fields_notes: string[];
};

function missingFieldNotes(row: VehicleRow): string[] {
  const notes: string[] = [];
  if (row.combined_mpg === null) notes.push("combined_mpg_unavailable");
  if (row.co2_g_per_mi === null && row.co2_tailpipe_g_per_mi === null) {
    notes.push("co2_unavailable");
  }
  if (row.ghg_score === null) notes.push("ghg_score_unavailable");
  if (row.fe_score === null) notes.push("fe_score_unavailable");
  if (row.smog_score === null) notes.push("smog_score_unavailable");
  return notes;
}

export function serializeVehicle(row: VehicleRow): VehicleSpecs {
  return {
    id: row.id,
    year: row.year,
    make: row.make,
    model: row.model,
    vehicle_class: row.v_class,
    drivetrain: row.drive,
    transmission: row.trany,
    transmission_detail: row.trans_dscr,
    fuel_type_primary: row.fuel_type1,
    fuel_type: row.fuel_type,
    cylinders: row.cylinders,
    displacement_l: row.displ,
    engine_description: row.eng_dscr,
    mpg: {
      city: row.city_mpg,
      highway: row.highway_mpg,
      combined: row.combined_mpg,
      epa_data_reliable:
        row.mpg_data_reliable === null ? null : row.mpg_data_reliable === 1,
    },
    emissions: {
      co2_g_per_mi: row.co2_g_per_mi,
      co2_tailpipe_g_per_mi: row.co2_tailpipe_g_per_mi,
      ghg_score: row.ghg_score,
      fe_score: row.fe_score,
      smog_score: row.smog_score,
      smartway_score: row.smartway_score,
      standard: row.emissions_standard,
      standard_text: row.emissions_standard_text,
    },
    epa_modified_on: row.raw_modified_on,
    missing_fields_notes: missingFieldNotes(row),
  };
}

export function buildSourceMeta(metadata: IngestMetadata | null): SourceMeta {
  const notes: string[] = [];
  if (!metadata) {
    notes.push("database_not_ingested");
  }
  return {
    source: "EPA FuelEconomy.gov",
    source_urls: [SOURCE_VEHICLE_BULK, SOURCE_EMISSIONS_BULK],
    updated_at: metadata?.vehicles_retrieved_at ?? null,
    ...(notes.length > 0 ? { notes } : {}),
  };
}
