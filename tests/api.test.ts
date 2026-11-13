import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/client.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import { createApp } from "../src/api/app.js";
import { preparePaymentLayer } from "../src/api/x402-routes.js";
import { loadEnv, type AppEnv } from "../src/config/env.js";

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

function baseEnv(dbPath: string): AppEnv {
  return loadEnv({
    NODE_ENV: "test",
    DATABASE_PATH: dbPath,
    FACILITATOR_URL: "https://x402.org/facilitator",
    PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
  });
}

describe("API routes", () => {
  let dbPath: string;
  let env: AppEnv;

  beforeAll(() => {
    dbPath = path.join(os.tmpdir(), `vehicle-api-test-${Date.now()}.db`);
    seedDatabase(dbPath);
    env = baseEnv(dbPath);
  });

  afterAll(() => {
    fs.rmSync(dbPath, { force: true });
  });

  it("serves free menu endpoints", async () => {
    const app = createApp({
      env,
      enablePayments: false,
    });
    const res = await app.request("/v1/makes?year=2009");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { makes: string[] };
    expect(body.makes).toContain("Volkswagen");
  });

  it("returns paid vehicle payload when payments are bypassed (mocked settlement)", async () => {
    const app = createApp({
      env,
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
