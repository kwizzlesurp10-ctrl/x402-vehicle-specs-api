import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VehicleRepository } from "../src/api/repository.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import type { DbExecutor } from "../src/db/executor.js";
import {
  normalizedModelSearchTerm,
  searchModelContainsSql,
} from "../src/db/vehicle-search-sql.js";
import { createTestDb } from "./test-db.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

describe("VehicleRepository search SQL", () => {
  let db: DbExecutor;
  let repo: VehicleRepository;

  beforeAll(async () => {
    db = await createTestDb();
    const vehicleCsv = fs.readFileSync(
      path.join(fixturesDir, "sample-vehicles.csv"),
      "utf8",
    );
    const emissionsCsv = fs.readFileSync(
      path.join(fixturesDir, "sample-emissions.csv"),
      "utf8",
    );
    await ingestFromCsvText(
      db,
      vehicleCsv,
      emissionsCsv,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    repo = new VehicleRepository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("matches model substring via sargable LIKE concat (same results as legacy pattern)", async () => {
    const term = normalizedModelSearchTerm("Jetta");
    const legacy = `%${term}%`;
    const clause = searchModelContainsSql("$1");
    const legacyRows = await db.queryRows<{ id: number }>(
      `SELECT id FROM vehicles WHERE year = $1 AND search_make = $2 AND search_model LIKE $3`,
      [2009, "volkswagen", legacy],
    );
    const rewriteRows = await db.queryRows<{ id: number }>(
      `SELECT id FROM vehicles WHERE year = $2 AND search_make = $3 AND ${clause}`,
      [term, 2009, "volkswagen"],
    );
    expect(rewriteRows.map((r) => r.id).sort()).toEqual(
      legacyRows.map((r) => r.id).sort(),
    );
    expect(legacyRows.some((r) => r.id === 25262)).toBe(true);
  });

  it("search returns expected vehicles for year/make/model", async () => {
    const rows = await repo.search({
      year: 2009,
      make: "Volkswagen",
      model: "Jetta",
      limit: 10,
    });
    expect(rows.some((r) => r.id === 25262)).toBe(true);
  });

  it("listMakes and listModels return menu ordering", async () => {
    const makes = await repo.listMakes(2009);
    expect(makes).toContain("Volkswagen");
    const models = await repo.listModels(2009, "Volkswagen");
    expect(models).toContain("Jetta");
  });

  it("statsByYearAndClass aggregates fixtures", async () => {
    const stats = await repo.statsByYearAndClass(2009, "Compact Cars");
    expect(stats.count).toBeGreaterThan(0);
    expect(stats.engine_mix.length).toBeGreaterThan(0);
  });
});