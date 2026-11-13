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
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
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
          id, type, depth, status, input_json, payment_usd, webhook_url
        ) VALUES ($1, $2, $3, 'queued', $4::jsonb, $5, $6)
        RETURNING *`,
      [
        id,
        params.request.type,
        params.request.depth,
        JSON.stringify(inputPayload),
        params.paymentUsd,
        params.request.webhook_url ?? null,
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
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE jobs j
       SET status = 'running', started_at = now(), updated_at = now()
       FROM picked
       WHERE j.id = picked.id
       RETURNING j.*`,
    );
    return row ? mapJob(row) : null;
  }

  async claimById(jobId: string): Promise<JobRecord | null> {
    const row = await this.db.queryOne<JobRowDb>(
      `UPDATE jobs
       SET status = 'running', started_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'queued'
       RETURNING *`,
      [jobId],
    );
    return row ? mapJob(row) : null;
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
