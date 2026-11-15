import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { buildHealthPayload } from "../src/api/health.js";
import { resetMigration003CapabilitiesCache } from "../src/db/migration-003-capabilities.js";
import type { DbExecutor } from "../src/db/executor.js";
import { isUndefinedColumnError } from "../src/db/postgres-errors.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import * as ingestRun from "../src/ingest/run.js";
import { recordIngestCronRun } from "../src/jobs/queue-stats.js";
import { createTestDbBeforeMigration003, testEnv } from "./test-db.js";

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

describe("migration 003 resilience", () => {
  let db: DbExecutor;
  const env = testEnv();

  beforeAll(async () => {
    db = await createTestDbBeforeMigration003();
    await seedDatabase(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("detects Postgres undefined_column errors", () => {
    expect(isUndefinedColumnError({ code: "42703" })).toBe(true);
    expect(isUndefinedColumnError({ code: "42P01" })).toBe(false);
    expect(isUndefinedColumnError(new Error("nope"))).toBe(false);
  });

  it("returns healthy payload with migrations_pending when observability columns are absent", async () => {
    resetMigration003CapabilitiesCache();
    const payload = await buildHealthPayload(db, env);

    expect(payload.status).toBe("ok");
    expect(payload.vehicles_indexed).toBeGreaterThan(0);
    expect(payload.migrations_pending).toEqual(["003_job_queue_observability"]);
    expect(payload.cron).toMatchObject({
      jobs_last_run_at: null,
      ingest_last_run_at: null,
    });
  });

  it("serves /health with HTTP 200 before migration 003", async () => {
    resetMigration003CapabilitiesCache();
    const app = createApp({ db, env, enablePayments: false });
    const res = await app.request("http://127.0.0.1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      migrations_pending: string[];
      vehicles_indexed: number;
    };
    expect(body.migrations_pending).toContain("003_job_queue_observability");
    expect(body.vehicles_indexed).toBeGreaterThan(0);
  });

  it("does not fail ingest cron when metadata columns are missing", async () => {
    resetMigration003CapabilitiesCache();
    const ingestSpy = vi.spyOn(ingestRun, "ingestFromEpa").mockResolvedValue({
      vehicleRows: 12,
      emissionRows: 10,
      vehiclesRetrievedAt: "2026-11-15T06:00:00.000Z",
      emissionsRetrievedAt: "2026-11-15T06:00:00.000Z",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = createApp({ db, env, enablePayments: false });
    const res = await app.request("http://127.0.0.1/cron/ingest");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; vehicleRows: number };
    expect(body.ok).toBe(true);
    expect(body.vehicleRows).toBe(12);

    await expect(recordIngestCronRun(db, true, { vehicleRows: 12 })).resolves.toBeUndefined();

    ingestSpy.mockRestore();
    logSpy.mockRestore();
  });
});