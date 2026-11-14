import type { DbExecutor } from "../db/executor.js";
import type { JobStatus } from "./types.js";

export type JobsQueueStats = {
  by_status: Partial<Record<JobStatus, number>>;
  queued_count: number;
  running_count: number;
  oldest_pending_age_seconds: number | null;
  stuck_running_count: number;
};

export type CronRunSummary = {
  duration_ms?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
  reclaimed?: number;
  error?: string;
  [key: string]: string | number | boolean | null | undefined;
};

export type CronMetadata = {
  jobs_cron_last_run_at: string | null;
  jobs_cron_last_ok: boolean | null;
  jobs_cron_last_summary: CronRunSummary | null;
  ingest_cron_last_run_at: string | null;
  ingest_cron_last_ok: boolean | null;
  ingest_cron_last_summary: CronRunSummary | null;
};

type StatusRow = { status: string; count: number };

export async function getJobsQueueStats(
  db: DbExecutor,
  stuckLeaseMs: number,
): Promise<JobsQueueStats> {
  const statusRows = await db.queryRows<StatusRow>(
    `SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status`,
  );
  const by_status: Partial<Record<JobStatus, number>> = {};
  for (const row of statusRows) {
    by_status[row.status as JobStatus] = row.count;
  }

  const queued_count = by_status.queued ?? 0;
  const running_count = by_status.running ?? 0;

  const oldest = await db.queryOne<{ age_seconds: number | null }>(
    `SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))::int AS age_seconds
     FROM jobs WHERE status = 'queued'`,
  );

  const stuck = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM jobs
     WHERE status = 'running'
       AND started_at IS NOT NULL
       AND started_at < now() - ($1::int * interval '1 millisecond')`,
    [stuckLeaseMs],
  );

  return {
    by_status,
    queued_count,
    running_count,
    oldest_pending_age_seconds: oldest?.age_seconds ?? null,
    stuck_running_count: stuck?.count ?? 0,
  };
}

export async function getCronMetadata(db: DbExecutor): Promise<CronMetadata | null> {
  return db.queryOne<CronMetadata & { jobs_cron_last_summary: unknown }>(
    `SELECT
       jobs_cron_last_run_at::text,
       jobs_cron_last_ok,
       jobs_cron_last_summary,
       ingest_cron_last_run_at::text,
       ingest_cron_last_ok,
       ingest_cron_last_summary
     FROM ingest_metadata WHERE id = 1`,
  ).then((row) => {
    if (!row) return null;
    return {
      jobs_cron_last_run_at: row.jobs_cron_last_run_at,
      jobs_cron_last_ok: row.jobs_cron_last_ok,
      jobs_cron_last_summary: parseSummary(row.jobs_cron_last_summary),
      ingest_cron_last_run_at: row.ingest_cron_last_run_at,
      ingest_cron_last_ok: row.ingest_cron_last_ok,
      ingest_cron_last_summary: parseSummary(row.ingest_cron_last_summary),
    };
  });
}

function parseSummary(raw: unknown): CronRunSummary | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw as CronRunSummary;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as CronRunSummary;
    } catch {
      return null;
    }
  }
  return null;
}

export async function recordJobsCronRun(
  db: DbExecutor,
  ok: boolean,
  summary: CronRunSummary,
): Promise<void> {
  await db.queryRows(
    `UPDATE ingest_metadata SET
       jobs_cron_last_run_at = now(),
       jobs_cron_last_ok = $1,
       jobs_cron_last_summary = $2::jsonb
     WHERE id = 1`,
    [ok, JSON.stringify(summary)],
  );
}

export async function recordIngestCronRun(
  db: DbExecutor,
  ok: boolean,
  summary: CronRunSummary,
): Promise<void> {
  await db.queryRows(
    `UPDATE ingest_metadata SET
       ingest_cron_last_run_at = now(),
       ingest_cron_last_ok = $1,
       ingest_cron_last_summary = $2::jsonb
     WHERE id = 1`,
    [ok, JSON.stringify(summary)],
  );
}