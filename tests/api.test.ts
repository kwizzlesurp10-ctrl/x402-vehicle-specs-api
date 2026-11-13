import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { preparePaymentLayer } from "../src/api/x402-routes.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import type { AppEnv } from "../src/config/env.js";
import type { DbExecutor } from "../src/db/executor.js";
import { createTestDb, testEnv } from "./test-db.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

async function seedDatabase(db: DbExecutor): Promise<void> {
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
}

describe("API routes", () => {
  let db: DbExecutor;
  let env: AppEnv;

  beforeAll(async () => {
    env = testEnv();
    db = await createTestDb();
    await seedDatabase(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("serves free menu endpoints", async () => {
    const app = createApp({ db, env, enablePayments: false });
    const res = await app.request("/v1/makes?year=2009");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { makes: string[] };
    expect(body.makes).toContain("Volkswagen");
  });

  it("returns paid vehicle payload when payments are bypassed (mocked settlement)", async () => {
    const app = createApp({ db, env, enablePayments: false });
    const res = await app.request("/v1/vehicles/25262");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vehicle: { make: string; mpg: { combined: number | null } };
      meta: { source: string; updated_at: string | null };
    };
    expect(body.vehicle.make).toBe("Volkswagen");
    expect(body.vehicle.mpg.combined).toBe(32);
    expect(body.meta.source).toBe("EPA FuelEconomy.gov");
    expect(new Date(body.meta.updated_at ?? "").toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("returns HTTP 402 on paid routes without payment", async () => {
    const paymentLayer = await preparePaymentLayer(env);
    const app = createApp({
      db,
      env,
      enablePayments: true,
      paymentLayer,
    });
    const res = await app.request("/v1/vehicles/25262");
    expect(res.status).toBe(402);
  });
});
