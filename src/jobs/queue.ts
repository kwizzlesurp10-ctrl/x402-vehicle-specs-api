import { randomUUID } from "node:crypto";
import type { DbExecutor } from "../db/executor.js";
import type { JobDepth, JobRecord, JobSubmitRequest, JobType } from "./types.js";

type JobRowDb = {
  id: string;
  type: JobType;
  depth: JobDepth;
  status: JobRecord["status"];
  input_json: unknown;
  result_json: unknown | null;
  error_message: string | null;
  webhook_url: string | null;
  payment_usd: number;
  refund_eligible: boolean;
  verifier_passed: boolean | null;
  tokens_used: number;
  attempt_count: number;
  max_attempts: number;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type ReclaimStuckResult = {
  requeued: number;
  failed: number;
  reclaimed_ids: string[];
};

function mapJob(row: JobRowDb): JobRecord {
  return {
    id: row.id,
    type: row.type,
    depth: row.depth,
    status: row.status,
    input_json:
      typeof row.input_json === "string"
        ? row.input_json
        : JSON.stringify(row.input_json),
    result_json:
      row.result_json === null
        ? null
        : typeof row.result_json === "string"
          ? row.result_json
          : JSON.stringify(row.result_json),
    error_message: row.error_message,
    webhook_url: row.webhook_url,
    payment_usd: row.payment_usd,
    refund_eligible: row.refund_eligible ? 1 : 0,
    verifier_passed:
      row.verifier_passed === null ? null : row.verifier_passed ? 1 : 0,
    tokens_used: row.tokens_used,
    attempt_count: row.attempt_count ?? 0,
    max_attempts: row.max_attempts ?? 3,
    next_run_at: row.next_run_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };
}

export class JobQueue {
  constructor(private readonly db: DbExecutor) {}

  async createJob(params: {
    request: JobSubmitRequest;
    paymentUsd: number;
    maxAttempts: number;
  }): Promise<JobRecord> {
    const id = randomUUID();
    const inputPayload = {
      type: params.request.type,
      depth: params.request.depth,
      input: "input" in params.request ? params.request.input : {},
      ...(params.request.webhook_url
        ? { webhook_url: params.request.webhook_url }
        : {}),
    };

    const row = await this.db.queryOne<JobRowDb>(
      `INSERT INTO jobs (
          id, type, depth, status, input_json, payment_usd, webhook_url, max_attempts
        ) VALUES ($1, $2, $3, 'queued', $4::jsonb, $5, $6, $7)
        RETURNING *`,
      [
        id,
        params.request.type,
        params.request.depth,
        JSON.stringify(inputPayload),
        params.paymentUsd,
        params.request.webhook_url ?? null,
        params.maxAttempts,
      ],
    );

    if (!row) throw new Error("failed to create job");
    return mapJob(row);
  }

  async getById(id: string): Promise<JobRecord | null> {
    const row = await this.db.queryOne<JobRowDb>(`SELECT * FROM jobs WHERE id = $1`, [
      id,
    ]);
    return row ? mapJob(row) : null;
  }

  async claimNext(): Promise<JobRecord | null> {
    const row = await this.db.queryOne<JobRowDb>(
      `WITH picked AS (
         SELECT id FROM jobs
         WHERE status = 'queued'
           AND (next_run_at IS NULL OR next_run_at <= now())
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE jobs j
       SET status = 'running',
           started_at = now(),
           updated_at = now(),
           attempt_count = j.attempt_count + 1,
           next_run_at = NULL
       FROM picked
       WHERE j.id = picked.id
       RETURNING j.*`,
    );
    return row ? mapJob(row) : null;
  }

  async claimById(jobId: string): Promise<JobRecord | null> {
    const row = await this.db.queryOne<JobRowDb>(
      `UPDATE jobs
       SET status = 'running',
           started_at = now(),
           updated_at = now(),
           attempt_count = attempt_count + 1,
           next_run_at = NULL
       WHERE id = $1
         AND status = 'queued'
         AND (next_run_at IS NULL OR next_run_at <= now())
       RETURNING *`,
      [jobId],
    );
    return row ? mapJob(row) : null;
  }

  async reclaimStuckJobs(params: {
    leaseMs: number;
    retryBackoffMs: number;
  }): Promise<ReclaimStuckResult> {
    const stuck = await this.db.queryRows<{ id: string; attempt_count: number; max_attempts: number }>(
      `SELECT id, attempt_count, max_attempts FROM jobs
       WHERE status = 'running'
         AND started_at IS NOT NULL
         AND started_at < now() - ($1::int * interval '1 millisecond')
       FOR UPDATE SKIP LOCKED`,
      [params.leaseMs],
    );

    let requeued = 0;
    let failed = 0;
    const reclaimed_ids: string[] = [];

    for (const row of stuck) {
      reclaimed_ids.push(row.id);
      if (row.attempt_count < row.max_attempts) {
        await this.db.queryRows(
          `UPDATE jobs SET
             status = 'queued',
             started_at = NULL,
             updated_at = now(),
             error_message = 'stuck_running_reclaimed',
             next_run_at = now() + ($2::int * interval '1 millisecond')
           WHERE id = $1`,
          [row.id, params.retryBackoffMs],
        );
        requeued += 1;
      } else {
        await this.db.queryRows(
          `UPDATE jobs SET
             status = 'failed',
             error_message = 'stuck_running_max_attempts',
             refund_eligible = TRUE,
             verifier_passed = FALSE,
             completed_at = now(),
             updated_at = now()
           WHERE id = $1`,
          [row.id],
        );
        failed += 1;
      }
    }

    return { requeued, failed, reclaimed_ids };
  }

  async requeueForRetry(
    jobId: string,
    errorMessage: string,
    backoffMs: number,
  ): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      `UPDATE jobs SET
          status = 'queued',
          started_at = NULL,
          error_message = $2,
          next_run_at = now() + ($3::int * interval '1 millisecond'),
          updated_at = now()
       WHERE id = $1 AND status = 'running'
       RETURNING id`,
      [jobId, errorMessage, backoffMs],
    );
    return Boolean(row);
  }

  async countRunning(): Promise<number> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM jobs WHERE status = 'running'`,
    );
    return row?.count ?? 0;
  }

  async updateJob(
    id: string,
    patch: Partial<
      Pick<
        JobRecord,
        | "status"
        | "result_json"
        | "error_message"
        | "refund_eligible"
        | "verifier_passed"
        | "tokens_used"
        | "completed_at"
      >
    >,
  ): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) return;
    const updated = { ...existing, ...patch };
    await this.db.queryRows(
      `UPDATE jobs SET
          status = $2,
          result_json = $3::jsonb,
          error_message = $4,
          refund_eligible = $5,
          verifier_passed = $6,
          tokens_used = $7,
          completed_at = $8::timestamptz,
          updated_at = now()
         WHERE id = $1`,
      [
        id,
        updated.status,
        updated.result_json,
        updated.error_message,
        updated.refund_eligible === 1,
        updated.verifier_passed === null ? null : updated.verifier_passed === 1,
        updated.tokens_used,
        updated.completed_at,
      ],
    );
  }

  async recordFlywheel(params: {
    jobType: JobType;
    fingerprint: string;
    anonymizedInput: Record<string, unknown>;
    success: boolean;
  }): Promise<void> {
    await this.db.queryRows(
      `INSERT INTO job_flywheel (job_type, query_fingerprint, anonymized_input_json, success)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        params.jobType,
        params.fingerprint,
        JSON.stringify(params.anonymizedInput),
        params.success,
      ],
    );
  }
}

export function fingerprintJobInput(
  type: JobType,
  depth: JobDepth,
  input: unknown,
): string {
  return `${type}:${depth}:${JSON.stringify(input)}`.slice(0, 512);
}

export function anonymizeJobInput(
  type: JobType,
  input: unknown,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    return { type };
  }
  const clone = { ...(input as Record<string, unknown>) };
  if (Array.isArray(clone.vins)) {
    clone.vins = clone.vins.map((v) => String(v).replace(/.(?=.{4})/g, "*"));
  }
  return { type, ...clone };
}
