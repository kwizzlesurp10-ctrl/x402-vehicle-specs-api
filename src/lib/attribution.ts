export const SOURCE_NAME = "EPA FuelEconomy.gov";
export const SOURCE_VEHICLE_BULK =
  "https://fueleconomy.gov/feg/epadata/vehicles.csv.zip";
export const SOURCE_EMISSIONS_BULK =
  "https://fueleconomy.gov/feg/epadata/emissions.csv.zip";
export const SOURCE_REST_BASE = "https://fueleconomy.gov/ws/rest";

export type SourceMeta = {
  source: string;
  source_urls: string[];
  updated_at: string | null;
  notes?: string[];
};

export function withSource<T extends Record<string, unknown>>(
  payload: T,
  meta: SourceMeta,
): T & { meta: SourceMeta } {
  return { ...payload, meta };
}
