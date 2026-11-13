const NULL_MARKERS = new Set(["", "-1", "-1.0", "NA", "N/A", "null"]);

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parseNullableNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = normalizeWhitespace(raw);
  if (NULL_MARKERS.has(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function parseNullableInt(raw: string | undefined): number | null {
  const n = parseNullableNumber(raw);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.trunc(n);
}

export function parseNullableString(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = normalizeWhitespace(raw);
  if (NULL_MARKERS.has(trimmed)) return null;
  return trimmed;
}

/** Canonical make/model labels for search (case preserved from EPA). */
export function normalizeLabel(raw: string | undefined): string | null {
  const s = parseNullableString(raw);
  return s ? normalizeWhitespace(s) : null;
}

export type NormalizedMpg = {
  city: number | null;
  highway: number | null;
  combined: number | null;
  mpg_data_reliable: boolean | null;
};

export function normalizeMpg(row: {
  city08?: string;
  highway08?: string;
  comb08?: string;
  mpgData?: string;
}): NormalizedMpg {
  return {
    city: parseNullableInt(row.city08),
    highway: parseNullableInt(row.highway08),
    combined: parseNullableInt(row.comb08),
    mpg_data_reliable:
      row.mpgData === undefined
        ? null
        : normalizeWhitespace(row.mpgData).toUpperCase() === "Y",
  };
}

export type NormalizedEmissions = {
  co2_g_per_mi: number | null;
  co2_tailpipe_g_per_mi: number | null;
  ghg_score: number | null;
  fe_score: number | null;
  smog_score: number | null;
  smartway_score: number | null;
  standard: string | null;
  standard_text: string | null;
};

export function emissionsFromVehicle(row: Record<string, string | undefined>): NormalizedEmissions {
  const co2 = parseNullableNumber(row.co2);
  const tailpipe = parseNullableNumber(row.co2TailpipeGpm);
  return {
    co2_g_per_mi: co2,
    co2_tailpipe_g_per_mi: tailpipe,
    ghg_score: parseNullableInt(row.ghgScore),
    fe_score: parseNullableInt(row.feScore),
    smog_score: null,
    smartway_score: null,
    standard: null,
    standard_text: null,
  };
}

export function mergeEmissionsCsv(
  vehicle: NormalizedEmissions,
  emissionRow: Record<string, string | undefined> | undefined,
): NormalizedEmissions {
  if (!emissionRow) return vehicle;
  return {
    ...vehicle,
    smog_score: parseNullableNumber(emissionRow.score),
    smartway_score: parseNullableInt(emissionRow.smartwayScore),
    standard: parseNullableString(emissionRow.standard),
    standard_text: parseNullableString(emissionRow.stdText),
  };
}
