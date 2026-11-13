import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { preparePaymentLayer } from "../src/api/x402-routes.js";
import { loadEnv, type AppEnv } from "../src/config/env.js";
import { openDatabase } from "../src/db/client.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import { JobWorker } from "../src/jobs/worker.js";
import * as pipeline from "../src/jobs/pipeline/run.js";

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

function testEnv(dbPath: string): AppEnv {
  return loadEnv({
    NODE_ENV: "test",
    DATABASE_PATH: dbPath,
    LLM_PROVIDER: "mock",
    FACILITATOR_URL: "https://x402.org/facilitator",
    PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
  });
}

describe("swarm jobs", () => {
  let dbPath: string;
  let env: AppEnv;

  beforeAll(() => {
    dbPath = path.join(os.tmpdir(), `vehicle-jobs-test-${Date.now()}.db`);
    seedDatabase(dbPath);
    env = testEnv(dbPath);
  });

  afterAll(() => {
    fs.rmSync(dbPath, { force: true });
  });

  it("returns HTTP 402 for POST /v1/jobs without payment", async () => {
    const paymentLayer = await preparePaymentLayer(env);
    const app = createApp({ env, enablePayments: true, paymentLayer });
    const res = await app.request("http://127.0.0.1/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "starter_kit",
        depth: "standard",
        input: { language: "typescript" },
      }),
    });
    expect(res.status).toBe(402);
  });

  it("runs job lifecycle with mock LLM and payments bypassed", async () => {
    const db = openDatabase(dbPath);
    const worker = new JobWorker({ db, env });
    const app = createApp({
      env,
      enablePayments: false,
    });

    const create = await app.request("http://127.0.0.1/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "fleet_analysis",
        depth: "standard",
        input: {
          vehicles: [{ year: 2009, make: "Volkswagen", model: "Jetta" }],
        },
      }),
    });

    expect(create.status).toBe(202);
    const body = (await create.json()) as { job_id: string };
    await worker.processJobById(body.job_id);

    const poll = await app.request(`http://127.0.0.1/v1/jobs/${body.job_id}`);
    expect(poll.status).toBe(200);
    const job = (await poll.json()) as {
      status: string;
      verifier_passed: boolean;
      result: { reporter: { short_answer: string } };
    };
    expect(job.status).toBe("completed");
    expect(job.verifier_passed).toBe(true);
    expect(job.result.reporter.short_answer.length).toBeGreaterThan(10);
    db.close();
  });

  it("marks partial + refund_eligible when verifier rejects numbers", async () => {
    const db = openDatabase(dbPath);
    const worker = new JobWorker({
      db,
      env,
      forceVerifierFail: true,
    });
    const app = createApp({
      env,
      enablePayments: false,
    });

    const create = await app.request("http://127.0.0.1/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "fleet_analysis",
        depth: "standard",
        input: {
          vehicles: [{ year: 2009, make: "Volkswagen", model: "Jetta", vehicle_id: 25262 }],
        },
      }),
    });
    const { job_id } = (await create.json()) as { job_id: string };
    await worker.processJobById(job_id);
    const job = (await (
      await app.request(`http://127.0.0.1/v1/jobs/${job_id}`)
    ).json()) as {
      status: string;
      refund_eligible: boolean;
      verifier_passed: boolean;
    };
    expect(job.status).toBe("partial");
    expect(job.refund_eligible).toBe(true);
    expect(job.verifier_passed).toBe(false);
    db.close();
  });

  it("fails jobs that exceed token cap", async () => {
    const db = openDatabase(dbPath);
    const worker = new JobWorker({
      db,
      env: { ...env, JOB_MAX_TOKENS: 1 },
    });
    const app = createApp({ env, enablePayments: false });
    const create = await app.request("http://127.0.0.1/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "starter_kit",
        depth: "standard",
        input: { language: "curl" },
      }),
    });
    const { job_id } = (await create.json()) as { job_id: string };
    await worker.processJobById(job_id);
    const job = (await (
      await app.request(`http://127.0.0.1/v1/jobs/${job_id}`)
    ).json()) as { status: string; refund_eligible: boolean };
    expect(job.status).toBe("failed");
    expect(job.refund_eligible).toBe(true);
    db.close();
  });

  it("times out long-running jobs", async () => {
    vi.spyOn(pipeline, "runSwarmPipeline").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("job_timeout")), 20);
        }),
    );

    const db = openDatabase(dbPath);
    const worker = new JobWorker({
      db,
      env: { ...env, JOB_TIMEOUT_MS: 5 },
    });
    const app = createApp({ env, enablePayments: false });
    const create = await app.request("http://127.0.0.1/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "starter_kit",
        depth: "standard",
        input: { language: "typescript" },
      }),
    });
    const { job_id } = (await create.json()) as { job_id: string };
    await worker.processJobById(job_id);
    const job = (await (
      await app.request(`http://127.0.0.1/v1/jobs/${job_id}`)
    ).json()) as { status: string; refund_eligible: boolean };
    expect(job.status).toBe("timed_out");
    expect(job.refund_eligible).toBe(true);
    vi.restoreAllMocks();
    db.close();
  });
});
