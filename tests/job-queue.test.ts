import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { ingestFromCsvText } from "../src/ingest/run.js";
import type { AppEnv } from "../src/config/env.js";
import type { DbExecutor } from "../src/db/executor.js";
import { JobQueue } from "../src/jobs/queue.js";
import {
  getCronMetadata,
  getJobsQueueStats,
  recordJobsCronRun,
} from "../src/jobs/queue-stats.js";
import { processQueuedBatch } from "../src/jobs/worker-once.js";
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

async function insertQueuedJob(
  db: DbExecutor,
  overrides?: { maxAttempts?: number },
): Promise<string> {
  const id = randomUUID();
  await db.queryRows(
    `INSERT INTO jobs (
       id, type, depth, status, input_json, payment_usd, max_attempts
     ) VALUES ($1, 'starter_kit', 'standard', 'queued', $2::jsonb, 0.25, $3)`,
    [
      id,
      JSON.stringify({
        type: "starter_kit",
        depth: "standard",
        input: { language: "typescript" },
      }),
      overrides?.maxAttempts ?? 3,
    ],
  );
  return id;
}

describe("job queue reliability", () => {
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

  it("claimNext skips jobs until next_run_at", async () => {
    const queue = new JobQueue(db);
    const blockedId = await insertQueuedJob(db);
    const readyId = await insertQueuedJob(db);

    await db.queryRows(
      `UPDATE jobs SET next_run_at = now() + interval '1 hour' WHERE id = $1`,
      [blockedId],
    );

    const claimed = await queue.claimNext();
    expect(claimed?.id).toBe(readyId);
    expect(claimed?.attempt_count).toBe(1);
  });

  it("reclaims stuck running jobs with backoff or fails at max attempts", async () => {
    const queue = new JobQueue(db);
    const retryId = await insertQueuedJob(db, { maxAttempts: 3 });
    const terminalId = await insertQueuedJob(db, { maxAttempts: 1 });

    await db.queryRows(
      `UPDATE jobs SET status = 'running', started_at = now() - interval '1 hour',
              attempt_count = 1 WHERE id = $1`,
      [retryId],
    );
    await db.queryRows(
      `UPDATE jobs SET status = 'running', started_at = now() - interval '1 hour',
              attempt_count = 1 WHERE id = $1`,
      [terminalId],
    );

    const reclaim = await queue.reclaimStuckJobs({
      leaseMs: 60_000,
      retryBackoffMs: 1_000,
    });

    expect(reclaim.requeued).toBe(1);
    expect(reclaim.failed).toBe(1);

    const retryJob = await queue.getById(retryId);
    const terminalJob = await queue.getById(terminalId);
    expect(retryJob?.status).toBe("queued");
    expect(retryJob?.next_run_at).not.toBeNull();
    expect(terminalJob?.status).toBe("failed");
    expect(terminalJob?.error_message).toBe("stuck_running_max_attempts");
  });

  it("requeues transient failures up to max attempts", async () => {
    const pipelineSpy = vi
      .spyOn(pipeline, "runSwarmPipeline")
      .mockRejectedValue(new Error("transient_llm_error"));

    const queue = new JobQueue(db);
    const jobId = await insertQueuedJob(db, { maxAttempts: 2 });

    const batch = await processQueuedBatch(
      { db, env: { ...env, JOB_MAX_ATTEMPTS: 2 } },
      1,
      { skipReclaim: true },
    );
    expect(batch.processed).toBe(1);
    expect(batch.failed).toBe(0);

    const job = await queue.getById(jobId);
    expect(job?.status).toBe("queued");
    expect(job?.error_message).toBe("transient_llm_error");
    expect(job?.attempt_count).toBe(1);

    vi.restoreAllMocks();
  });

  it("exposes queue and cron stats on /health and /health/jobs", async () => {
    await recordJobsCronRun(db, true, {
      processed: 2,
      succeeded: 2,
      duration_ms: 120,
    });

    const app = createApp({ db, env, enablePayments: false });
    const health = await app.request("http://127.0.0.1/health");
    expect(health.status).toBe(200);
    const body = (await health.json()) as {
      jobs_queue: { queued_count: number; by_status: Record<string, number> };
      cron: { jobs_last_ok: boolean; jobs_last_summary: { processed: number } };
    };
    expect(body.jobs_queue).toBeDefined();
    expect(typeof body.jobs_queue.queued_count).toBe("number");
    expect(body.cron.jobs_last_ok).toBe(true);
    expect(body.cron.jobs_last_summary.processed).toBe(2);

    const jobsHealth = await app.request("http://127.0.0.1/health/jobs");
    expect(jobsHealth.status).toBe(200);

    const stats = await getJobsQueueStats(db, env.JOB_RUN_LEASE_MS);
    expect(stats.by_status).toBeDefined();

    const cron = await getCronMetadata(db);
    expect(cron?.jobs_cron_last_summary?.processed).toBe(2);
  });

  it("rejects unauthorized cron when CRON_SECRET is set", async () => {
    const secretEnv = { ...env, CRON_SECRET: "test-secret", NODE_ENV: "production" as const };
    const app = createApp({ db, env: secretEnv, enablePayments: false });
    const res = await app.request("http://127.0.0.1/cron/jobs");
    expect(res.status).toBe(401);
    const ok = await app.request("http://127.0.0.1/cron/jobs", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(ok.status).toBe(200);
  });
});