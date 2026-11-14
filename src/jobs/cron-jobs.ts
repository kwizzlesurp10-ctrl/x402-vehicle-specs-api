import type { AppEnv } from "../config/env.js";
import type { DbExecutor } from "../db/executor.js";
import { logJobsEvent } from "../lib/job-logger.js";
import { JobQueue } from "./queue.js";
import { recordJobsCronRun } from "./queue-stats.js";
import { processQueuedBatch, type JobsCronBatchResult } from "./worker-once.js";

export function resolveCronTimeBudgetMs(env: AppEnv): number {
  const vercelCap = env.VERCEL_MAX_DURATION_MS ?? 300_000;
  const configured = env.JOB_CRON_TIME_BUDGET_MS;
  const underVercel = Math.min(configured, Math.floor(vercelCap * 0.85));
  return Math.max(underVercel - 5_000, 30_000);
}

export type JobsCronRunResult = JobsCronBatchResult & {
  duration_ms: number;
  time_budget_ms: number;
};

export async function runJobsCron(
  options: { db: DbExecutor; env: AppEnv },
): Promise<JobsCronRunResult> {
  const started = Date.now();
  const timeBudgetMs = resolveCronTimeBudgetMs(options.env);

  logJobsEvent("cron_jobs_start", {
    time_budget_ms: timeBudgetMs,
    max_concurrency: options.env.JOB_MAX_CONCURRENCY,
  });

  try {
    const batch = await processQueuedBatch(
      options,
      options.env.JOB_MAX_CONCURRENCY,
      { timeBudgetMs },
    );
    const duration_ms = Date.now() - started;
    const summary: JobsCronRunResult = {
      ...batch,
      duration_ms,
      time_budget_ms: timeBudgetMs,
    };

    await recordJobsCronRun(options.db, true, summary);

    logJobsEvent("cron_jobs_complete", {
      duration_ms,
      processed: batch.processed,
      succeeded: batch.succeeded,
      failed: batch.failed,
      reclaimed: batch.reclaimed,
      reclaimed_failed: batch.reclaimed_failed,
      skipped_time_budget: batch.skipped_time_budget,
    });

    return summary;
  } catch (error) {
    const duration_ms = Date.now() - started;
    const message = error instanceof Error ? error.message : "unknown_error";
    const summary: JobsCronRunResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      reclaimed: 0,
      reclaimed_failed: 0,
      skipped_time_budget: 0,
      duration_ms,
      time_budget_ms: timeBudgetMs,
      error: message,
    };
    await recordJobsCronRun(options.db, false, summary);
    logJobsEvent("cron_jobs_error", { duration_ms, error: message });
    throw error;
  }
}