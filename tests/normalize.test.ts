import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db/client.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import {
  mergeEmissionsCsv,
  normalizeMpg,
  parseNullableInt,
} from "../src/ingest/normalize.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("normalize", () => {
  it("treats EPA -1 sentinels as null", () => {
    expect(parseNullableInt("-1")).toBeNull();
    expect(parseNullableInt("4")).toBe(4);
  });

  it("parses MPG fields from vehicle row", () => {
    const mpg = normalizeMpg({
      city08: "29",
      highway08: "37",
      comb08: "32",
      mpgData: "Y",
    });
    expect(mpg).toEqual({
      city: 29,
      highway: 37,
      combined: 32,
      mpg_data_reliable: true,
    });
  });

  it("merges emissions CSV smog score", () => {
    const merged = mergeEmissionsCsv(
      {
        co2_g_per_mi: 318,
        co2_tailpipe_g_per_mi: 318,
        ghg_score: null,
        fe_score: null,
        smog_score: null,
        smartway_score: null,
        standard: null,
        standard_text: null,
      },
      {
        score: "1.0",
        smartwayScore: "-1",
        standard: "B9",
        stdText: "BIN 9",
      },
    );
    expect(merged.smog_score).toBe(1);
    expect(merged.standard).toBe("B9");
  });
});

describe("ingest", () => {
  it("loads fixture CSV into SQLite", () => {
    const vehicleCsv = fs.readFileSync(
      path.join(fixturesDir, "sample-vehicles.csv"),
      "utf8",
    );
    const emissionsCsv = fs.readFileSync(
      path.join(fixturesDir, "sample-emissions.csv"),
      "utf8",
    );
    const db = openDatabase(":memory:");
    const stats = ingestFromCsvText(
      db,
      vehicleCsv,
      emissionsCsv,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    expect(stats.vehicleRows).toBe(2);
    const jetta = db
      .prepare("SELECT * FROM vehicles WHERE id = 25262")
      .get() as {
      make: string;
      smog_score: number;
      combined_mpg: number;
    };
    expect(jetta.make).toBe("Volkswagen");
    expect(jetta.combined_mpg).toBe(32);
    expect(jetta.smog_score).toBe(1);
    db.close();
  });
});
