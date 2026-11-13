import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { JobDepth, JobRecord, JobStatus, JobSubmitRequest, JobType } from "./types.js";

export class JobQueue {
  constructor(private readonly db: Database.Database) {}

  createJob(params: {
    request: JobSubmitRequest;
    paymentUsd: number;
  }): JobRecord {
    const now = new Date().toISOString();
    const record: JobRecord = {
      id: randomUUID(),
      type: params.request.type,
      depth: params.request.depth,
      status: "queued",
      input_json: JSON.stringify({
        type: params.request.type,
        depth: params.request.depth,
        input: "input" in params.request ? params.request.input : {},
        webhook_url: params.request.webhook_url,
      }),
      result_json: null,
      error_message: null,
      webhook_url: params.request.webhook_url ?? null,
      payment_usd: params.paymentUsd,
      refund_eligible: 0,
      verifier_passed: null,
      tokens_used: 0,
      created_at: now,
      updated_at: now,
      started_at: null,
      completed_at: null,
    };

    this.db
      .prepare(
        `INSERT INTO jobs (
          id, type, depth, status, input_json, payment_usd, webhook_url,
          created_at, updated_at
        ) VALUES (
          @id, @type, @depth, @status, @input_json, @payment_usd, @webhook_url,
          @created_at, @updated_at
        )`,
      )
      .run(record);

    return record;
  }

  getById(id: string): JobRecord | null {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
      | JobRecord
      | undefined;
    return row ?? null;
  }

  claimNext(): JobRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
      )
      .get() as JobRecord | undefined;
    if (!row) return null;

    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE jobs SET status = 'running', started_at = @now, updated_at = @now
         WHERE id = @id AND status = 'queued'`,
      )
      .run({ id: row.id, now });

    if (result.changes === 0) return null;
    return { ...row, status: "running", started_at: now, updated_at: now };
  }

  countRunning(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'running'`)
      .get() as { count: number };
    return row.count;
  }

  updateJob(
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
  ): void {
    const existing = this.getById(id);
    if (!existing) return;
    const updated: JobRecord = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE jobs SET
          status = @status,
          result_json = @result_json,
          error_message = @error_message,
          refund_eligible = @refund_eligible,
          verifier_passed = @verifier_passed,
          tokens_used = @tokens_used,
          completed_at = @completed_at,
          updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(updated);
  }

  recordFlywheel(params: {
    jobType: JobType;
    fingerprint: string;
    anonymizedInput: Record<string, unknown>;
    success: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO job_flywheel (job_type, query_fingerprint, anonymized_input_json, success, created_at)
         VALUES (@job_type, @query_fingerprint, @anonymized_input_json, @success, @created_at)`,
      )
      .run({
        job_type: params.jobType,
        query_fingerprint: params.fingerprint,
        anonymized_input_json: JSON.stringify(params.anonymizedInput),
        success: params.success ? 1 : 0,
        created_at: new Date().toISOString(),
      });
  }
}

export function fingerprintJobInput(type: JobType, depth: JobDepth, input: unknown): string {
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
