import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { preparePaymentLayer } from "../src/api/x402-routes.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import type { AppEnv } from "../src/config/env.js";
import type { DbExecutor } from "../src/db/executor.js";
import { processJobById } from "../src/jobs/worker-once.js";
import * as pipeline from "../src/jobs/pipeline/run.js";
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

describe("swarm jobs", () => {
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

  it("returns HTTP 402 for POST /v1/jobs without payment", async () => {
    const paymentLayer = await preparePaymentLayer(env);
    const app = createApp({ db, env, enablePayments: true, paymentLayer });
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
    const app = createApp({ db, env, enablePayments: false });
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
    await processJobById({ db, env }, body.job_id);

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
  });

  it("marks partial + refund_eligible when verifier rejects numbers", async () => {
    const app = createApp({ db, env, enablePayments: false });
    const create = await app.request("http://127.0.0.1/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "fleet_analysis",
        depth: "standard",
        input: {
          vehicles: [
            { year: 2009, make: "Volkswagen", model: "Jetta", vehicle_id: 25262 },
          ],
        },
      }),
    });
    const { job_id } = (await create.json()) as { job_id: string };
    await processJobById({ db, env, forceVerifierFail: true }, job_id);
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
  });

  it("fails jobs that exceed token cap", async () => {
    const lowTokenEnv = { ...env, JOB_MAX_TOKENS: 1 };
    const app = createApp({ db, env: lowTokenEnv, enablePayments: false });
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
    await processJobById({ db, env: lowTokenEnv }, job_id);
    const job = (await (
      await app.request(`http://127.0.0.1/v1/jobs/${job_id}`)
    ).json()) as { status: string; refund_eligible: boolean };
    expect(job.status).toBe("failed");
    expect(job.refund_eligible).toBe(true);
  });

  it("times out long-running jobs", async () => {
    vi.spyOn(pipeline, "runSwarmPipeline").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("job_timeout")), 20);
        }),
    );

    const timeoutEnv = { ...env, JOB_TIMEOUT_MS: 5 };
    const app = createApp({ db, env: timeoutEnv, enablePayments: false });
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
    await processJobById({ db, env: timeoutEnv }, job_id);
    const job = (await (
      await app.request(`http://127.0.0.1/v1/jobs/${job_id}`)
    ).json()) as { status: string; refund_eligible: boolean };
    expect(job.status).toBe("timed_out");
    expect(job.refund_eligible).toBe(true);
    vi.restoreAllMocks();
  });
});
