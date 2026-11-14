import type { AppEnv } from "../config/env.js";
import type { DbExecutor } from "../db/executor.js";
import { logJobsEvent } from "../lib/job-logger.js";
import { createLlmClient } from "./llm/client.js";
import { runSwarmPipeline } from "./pipeline/run.js";
import {
  anonymizeJobInput,
  fingerprintJobInput,
  JobQueue,
} from "./queue.js";
import { jobSubmitSchema, type JobSubmitRequest } from "./types.js";

export type JobRunnerOptions = {
  db: DbExecutor;
  env: AppEnv;
  forceVerifierFail?: boolean;
};

export type JobsCronBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  reclaimed: number;
  reclaimed_failed: number;
  skipped_time_budget: number;
  error?: string;
};

export type ProcessBatchOptions = {
  timeBudgetMs?: number;
  skipReclaim?: boolean;
};

export async function processJobById(
  options: JobRunnerOptions,
  jobId: string,
): Promise<void> {
  const queue = new JobQueue(options.db);
  const claimed = await queue.claimById(jobId);
  if (!claimed) return;
  const outcome = await executeJob(options, jobId);
  logJobsEvent("job_kick_finished", {
    job_id: jobId,
    outcome,
  });
}

export async function processQueuedBatch(
  options: JobRunnerOptions,
  maxJobs: number,
  batchOptions: ProcessBatchOptions = {},
): Promise<JobsCronBatchResult> {
  const queue = new JobQueue(options.db);
  const runStarted = Date.now();
  const timeBudgetMs = batchOptions.timeBudgetMs ?? Number.POSITIVE_INFINITY;

  let reclaimed = 0;
  let reclaimed_failed = 0;

  if (!batchOptions.skipReclaim) {
    const reclaim = await queue.reclaimStuckJobs({
      leaseMs: options.env.JOB_RUN_LEASE_MS,
      retryBackoffMs: options.env.JOB_RETRY_BACKOFF_MS,
    });
    reclaimed = reclaim.requeued;
    reclaimed_failed = reclaim.failed;
    if (reclaim.reclaimed_ids.length > 0) {
      logJobsEvent("jobs_reclaimed", {
        count: reclaim.reclaimed_ids.length,
        requeued: reclaim.requeued,
        failed: reclaim.failed,
      });
    }
  }

  const result: JobsCronBatchResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    reclaimed,
    reclaimed_failed,
    skipped_time_budget: 0,
  };

  for (let i = 0; i < maxJobs; i += 1) {
    if (Date.now() - runStarted >= timeBudgetMs) {
      result.skipped_time_budget = maxJobs - i;
      break;
    }

    const running = await queue.countRunning();
    if (running >= options.env.JOB_MAX_CONCURRENCY) break;

    const claimed = await queue.claimNext();
    if (!claimed) break;

    logJobsEvent("job_claimed", {
      job_id: claimed.id,
      attempt: claimed.attempt_count,
      max_attempts: claimed.max_attempts,
    });

    const outcome = await executeJob(options, claimed.id);
    result.processed += 1;
    if (outcome === "succeeded") {
      result.succeeded += 1;
    } else if (outcome === "failed") {
      result.failed += 1;
    }
  }

  return result;
}

export type JobExecutionOutcome = "succeeded" | "failed" | "requeued";

async function executeJob(
  options: JobRunnerOptions,
  jobId: string,
): Promise<JobExecutionOutcome> {
  const queue = new JobQueue(options.db);
  const job = await queue.getById(jobId);
  if (!job) return "failed";

  const parsedEnvelope = JSON.parse(job.input_json) as {
    type: string;
    depth: string;
    input: unknown;
    webhook_url?: string;
  };

  const request = jobSubmitSchema.parse({
    type: parsedEnvelope.type,
    depth: parsedEnvelope.depth,
    input: parsedEnvelope.input,
    webhook_url: parsedEnvelope.webhook_url,
  }) satisfies JobSubmitRequest;

  const llm = createLlmClient(options.env);
  const timeoutMs = Math.min(
    options.env.JOB_TIMEOUT_MS,
    options.env.VERCEL_MAX_DURATION_MS ?? options.env.JOB_TIMEOUT_MS,
  );

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("job_timeout")), timeoutMs);
  });

  try {
    const result = await Promise.race([
      runSwarmPipeline({
        db: options.db,
        env: options.env,
        request,
        llm,
        ...(options.forceVerifierFail ? { forceVerifierFail: true } : {}),
      }),
      timeout,
    ]);

    if (llm.tokensUsed > options.env.JOB_MAX_TOKENS) {
      await queue.updateJob(jobId, {
        status: "failed",
        error_message: "token_budget_exceeded",
        refund_eligible: 1,
        verifier_passed: 0,
        result_json: JSON.stringify({
          error: "token_budget_exceeded",
          tokens_used: llm.tokensUsed,
          token_budget: options.env.JOB_MAX_TOKENS,
        }),
        completed_at: new Date().toISOString(),
      });
      logJobsEvent("job_finished", { job_id: jobId, status: "failed", reason: "token_budget" });
      return "failed";
    }

    const status =
      result.status === "failed"
        ? "failed"
        : result.status === "partial"
          ? "partial"
          : "completed";

    await queue.updateJob(jobId, {
      status,
      result_json: JSON.stringify(result),
      error_message: result.error ?? null,
      refund_eligible: result.refund_eligible ? 1 : 0,
      verifier_passed: result.verifier_passed ? 1 : 0,
      tokens_used: llm.tokensUsed,
      completed_at: new Date().toISOString(),
    });

    await queue.recordFlywheel({
      jobType: request.type,
      fingerprint: fingerprintJobInput(request.type, request.depth, request.input),
      anonymizedInput: anonymizeJobInput(request.type, request.input),
      success: status === "completed" || status === "partial",
    });

    if (job.webhook_url) {
      await fetch(job.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, status, result }),
      }).catch(() => undefined);
    }

    const succeeded = status === "completed" || status === "partial";
    logJobsEvent("job_finished", {
      job_id: jobId,
      status,
      tokens_used: llm.tokensUsed,
    });
    return succeeded ? "succeeded" : "failed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const fresh = await queue.getById(jobId);
    const attempts = fresh?.attempt_count ?? job.attempt_count;
    const maxAttempts = fresh?.max_attempts ?? job.max_attempts;

    const isTimeout = message === "job_timeout";
    if (!isTimeout && attempts < maxAttempts) {
      const requeued = await queue.requeueForRetry(
        jobId,
        message,
        options.env.JOB_RETRY_BACKOFF_MS,
      );
      if (requeued) {
        logJobsEvent("job_requeued", {
          job_id: jobId,
          error: message,
          attempt: attempts,
          max_attempts: maxAttempts,
        });
        return "requeued";
      }
    }

    const status = message === "job_timeout" ? "timed_out" : "failed";
    await queue.updateJob(jobId, {
      status,
      error_message: message,
      refund_eligible: 1,
      verifier_passed: 0,
      completed_at: new Date().toISOString(),
    });
    logJobsEvent("job_finished", { job_id: jobId, status, error: message });
    return "failed";
  }
}
