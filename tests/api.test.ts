import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/client.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import { createApp } from "../src/api/app.js";
import { preparePaymentLayer } from "../src/api/x402-routes.js";
import type { AppEnv } from "../src/config/env.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

function seedDatabase(dbPath: string): void {
  const vehicleCsv = fs.readFileSync(
    path.join(fixturesDir, "sample-vehicles.csv"),
    "utf8",
  );
  const emissionsCsv = fs.readFileSync(
    path.join(fixturesDir, "sample-emissions.csv"),
    "utf8",
  );
  const db = openDatabase(dbPath);
  ingestFromCsvText(
    db,
    vehicleCsv,
    emissionsCsv,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
  db.close();
}

const baseEnv: AppEnv = {
  PORT: 8787,
  NODE_ENV: "test",
  DATABASE_PATH: "",
  PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
  X402_NETWORK: "base-sepolia",
  FACILITATOR_URL: "https://x402.org/facilitator",
  PRICE_SEARCH: 0.001,
  PRICE_VEHICLE: 0.002,
  PRICE_EMISSIONS: 0.002,
  PRICE_COMPARE: 0.005,
  PRICE_STATS: 0.01,
  EPA_VEHICLES_ZIP_URL: "https://fueleconomy.gov/feg/epadata/vehicles.csv.zip",
  EPA_EMISSIONS_ZIP_URL: "https://fueleconomy.gov/feg/epadata/emissions.csv.zip",
};

describe("API routes", () => {
  let dbPath: string;

  beforeAll(() => {
    dbPath = path.join(os.tmpdir(), `vehicle-api-test-${Date.now()}.db`);
    seedDatabase(dbPath);
  });

  afterAll(() => {
    fs.rmSync(dbPath, { force: true });
  });

  it("serves free menu endpoints", async () => {
    const app = createApp({
      env: { ...baseEnv, DATABASE_PATH: dbPath },
      enablePayments: false,
    });
    const res = await app.request("/v1/makes?year=2009");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { makes: string[] };
    expect(body.makes).toContain("Volkswagen");
  });

  it("returns paid vehicle payload when payments are bypassed (mocked settlement)", async () => {
    const app = createApp({
      env: { ...baseEnv, DATABASE_PATH: dbPath },
      enablePayments: false,
    });
    const res = await app.request("/v1/vehicles/25262");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vehicle: { make: string; mpg: { combined: number | null } };
      meta: { source: string; updated_at: string | null };
    };
    expect(body.vehicle.make).toBe("Volkswagen");
    expect(body.vehicle.mpg.combined).toBe(32);
    expect(body.meta.source).toBe("EPA FuelEconomy.gov");
    expect(body.meta.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns HTTP 402 on paid routes without payment", async () => {
    const env = { ...baseEnv, DATABASE_PATH: dbPath };
    const paymentLayer = await preparePaymentLayer(env);
    const app = createApp({
      env,
      enablePayments: true,
      paymentLayer,
    });
    const res = await app.request("/v1/vehicles/25262");
    expect(res.status).toBe(402);
  });
});
