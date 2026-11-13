import type Database from "better-sqlite3";
import type { AppEnv } from "../config/env.js";
import { createLlmClient } from "./llm/client.js";
import { runSwarmPipeline } from "./pipeline/run.js";
import {
  anonymizeJobInput,
  fingerprintJobInput,
  JobQueue,
} from "./queue.js";
import { jobSubmitSchema, type JobSubmitRequest } from "./types.js";

export type JobWorkerOptions = {
  db: Database.Database;
  env: AppEnv;
  pollIntervalMs?: number;
  forceVerifierFail?: boolean;
};

export class JobWorker {
  private readonly queue: JobQueue;
  private readonly timer: ReturnType<typeof setInterval> | null;
  private running = 0;

  constructor(private readonly options: JobWorkerOptions) {
    this.queue = new JobQueue(options.db);
    if (options.env.NODE_ENV !== "test") {
      this.timer = setInterval(() => {
        void this.tick();
      }, options.pollIntervalMs ?? 500);
    } else {
      this.timer = null;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processJobById(jobId: string): Promise<void> {
    const now = new Date().toISOString();
    const claimed = this.options.db
      .prepare(
        `UPDATE jobs SET status = 'running', started_at = @now, updated_at = @now
         WHERE id = @id AND status = 'queued'`,
      )
      .run({ id: jobId, now });
    if (claimed.changes === 0) return;
    await this.execute(jobId);
  }

  async tick(): Promise<void> {
    while (this.running < this.options.env.JOB_MAX_CONCURRENCY) {
      const next = this.queue.claimNext();
      if (!next) break;
      this.running += 1;
      void this.execute(next.id).finally(() => {
        this.running -= 1;
      });
    }
  }

  private async execute(jobId: string): Promise<void> {
    const job = this.queue.getById(jobId);
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

    const llm = createLlmClient(this.options.env);
    const timeoutMs = this.options.env.JOB_TIMEOUT_MS;
    const tokenBudget = this.options.env.JOB_MAX_TOKENS;

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("job_timeout")), timeoutMs);
    });

    try {
      const result = await Promise.race([
        runSwarmPipeline({
          db: this.options.db,
          env: this.options.env,
          request,
          llm,
          ...(this.options.forceVerifierFail
            ? { forceVerifierFail: true }
            : {}),
        }),
        timeout,
      ]);

      if (llm.tokensUsed > tokenBudget) {
        this.queue.updateJob(jobId, {
          status: "failed",
          error_message: "token_budget_exceeded",
          refund_eligible: 1,
          verifier_passed: 0,
          result_json: JSON.stringify({
            error: "token_budget_exceeded",
            tokens_used: llm.tokensUsed,
            token_budget: tokenBudget,
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

      this.queue.updateJob(jobId, {
        status,
        result_json: JSON.stringify(result),
        error_message: result.error ?? null,
        refund_eligible: result.refund_eligible ? 1 : 0,
        verifier_passed: result.verifier_passed ? 1 : 0,
        tokens_used: llm.tokensUsed,
        completed_at: new Date().toISOString(),
      });

      this.queue.recordFlywheel({
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
      this.queue.updateJob(jobId, {
        status,
        error_message: message,
        refund_eligible: 1,
        verifier_passed: 0,
        completed_at: new Date().toISOString(),
      });
    }
  }
}
