import type { AppEnv } from "../config/env.js";
import type { DbExecutor } from "../db/executor.js";
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

export async function processJobById(
  options: JobRunnerOptions,
  jobId: string,
): Promise<void> {
  const queue = new JobQueue(options.db);
  const claimed = await queue.claimById(jobId);
  if (!claimed) return;
  await executeJob(options, jobId);
}

export async function processQueuedBatch(
  options: JobRunnerOptions,
  maxJobs: number,
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxJobs; i += 1) {
    const running = await new JobQueue(options.db).countRunning();
    if (running >= options.env.JOB_MAX_CONCURRENCY) break;

    const claimed = await new JobQueue(options.db).claimNext();
    if (!claimed) break;

    await executeJob(options, claimed.id);
    processed += 1;
  }
  return processed;
}

async function executeJob(
  options: JobRunnerOptions,
  jobId: string,
): Promise<void> {
  const queue = new JobQueue(options.db);
  const job = await queue.getById(jobId);
  if (!job) return;

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
      return;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "job_timeout" ? "timed_out" : "failed";
    await queue.updateJob(jobId, {
      status,
      error_message: message,
      refund_eligible: 1,
      verifier_passed: 0,
      completed_at: new Date().toISOString(),
    });
  }
}
