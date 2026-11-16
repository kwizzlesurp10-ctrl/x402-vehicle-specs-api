import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MANUAL_ONLY_MIGRATIONS } from "../src/db/client.js";

const migrationPath = path.join(
  import.meta.dirname,
  "../migrations/005_query_indexes.sql",
);

describe("migration 005_query_indexes.sql", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("uses concurrent idempotent index DDL", () => {
    expect(sql).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
    expect(sql).toMatch(/idx_vehicles_search_model_trgm/);
    expect(sql).toMatch(/idx_vehicles_year_make/);
    expect(sql).toMatch(/idx_vehicles_year_search_make_model/);
    expect(sql).toMatch(/idx_vehicles_year_v_class/);
  });

  it("documents pg_trgm and manual execution", () => {
    expect(sql).toMatch(/OUTSIDE a transaction/i);
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  });

  it("includes concurrent DOWN statements", () => {
    expect(sql).toMatch(/DROP INDEX CONCURRENTLY IF EXISTS idx_vehicles_year_v_class/);
    expect(sql).toMatch(
      /DROP INDEX CONCURRENTLY IF EXISTS idx_vehicles_search_model_trgm/,
    );
  });

  it("is excluded from automated npm migrate", () => {
    expect(MANUAL_ONLY_MIGRATIONS.has("005_query_indexes.sql")).toBe(true);
  });
});