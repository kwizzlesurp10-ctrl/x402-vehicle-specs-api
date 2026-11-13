import { err, ok, type Result } from "../../lib/result.js";

export type DecodedVin = {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  error: string | null;
};

export async function decodeVin(vin: string): Promise<Result<DecodedVin, string>> {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`;
  const response = await fetch(url);
  if (!response.ok) {
    return err(`NHTSA vPIC HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    Results?: Array<{ Variable: string; Value: string | null }>;
  };

  const byVar = new Map(
    (json.Results ?? []).map((row) => [row.Variable, row.Value ?? ""]),
  );

  const yearRaw = byVar.get("Model Year");
  const year = yearRaw && Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : null;
  const make = byVar.get("Make")?.trim() || null;
  const model = byVar.get("Model")?.trim() || null;
  const error = byVar.get("Error Text")?.trim() || null;

  return ok({ vin, year, make, model, error });
}
