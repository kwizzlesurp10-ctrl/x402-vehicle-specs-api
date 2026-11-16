/**
 * Substring match on normalized `search_model` (lowercase full model string from ingest).
 * Supported by `idx_vehicles_search_model_trgm` (pg_trgm) when migration 005 is applied.
 */
export function searchModelContainsSql(placeholder: string): string {
  return `search_model LIKE '%' || ${placeholder} || '%'`;
}

export function normalizedModelSearchTerm(model: string): string {
  return model.trim().toLowerCase();
}