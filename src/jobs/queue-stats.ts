import {
  emptyCronMetadata,
  getMigration003Capabilities,
  noteMigration003ColumnError,
} from "../db/migration-003-capabilities.js";
import type { DbExecutor } from "../db/executor.js";
import {
  isUndefinedColumnError,
  undefinedColumnName,
} from "../db/postgres-errors.js";
import { logJobsEvent } from "../lib/job-logger.js";
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

  const caps = await getMigration003Capabilities(db);
  let stuck_running_count = 0;
  if (caps.jobReliability) {
    const stuck = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM jobs
       WHERE status = 'running'
         AND started_at IS NOT NULL
         AND started_at < now() - ($1::int * interval '1 millisecond')`,
      [stuckLeaseMs],
    );
    stuck_running_count = stuck?.count ?? 0;
  }

  return {
    by_status,
    queued_count,
    running_count,
    oldest_pending_age_seconds: oldest?.age_seconds ?? null,
    stuck_running_count,
  };
}

export async function getCronMetadata(db: DbExecutor): Promise<CronMetadata | null> {
  const caps = await getMigration003Capabilities(db);
  if (!caps.cronObservability) return null;

  try {
    const row = await db.queryOne<CronMetadata & { jobs_cron_last_summary: unknown }>(
      `SELECT
         jobs_cron_last_run_at::text,
         jobs_cron_last_ok,
         jobs_cron_last_summary,
         ingest_cron_last_run_at::text,
         ingest_cron_last_ok,
         ingest_cron_last_summary
       FROM ingest_metadata WHERE id = 1`,
    );
    if (!row) return null;
    return {
      jobs_cron_last_run_at: row.jobs_cron_last_run_at,
      jobs_cron_last_ok: row.jobs_cron_last_ok,
      jobs_cron_last_summary: parseSummary(row.jobs_cron_last_summary),
      ingest_cron_last_run_at: row.ingest_cron_last_run_at,
      ingest_cron_last_ok: row.ingest_cron_last_ok,
      ingest_cron_last_summary: parseSummary(row.ingest_cron_last_summary),
    };
  } catch (error) {
    if (isUndefinedColumnError(error)) {
      noteMigration003ColumnError(error);
      return null;
    }
    throw error;
  }
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

async function writeCronMetadata(
  db: DbExecutor,
  cronKind: "jobs" | "ingest",
  ok: boolean,
  summary: CronRunSummary,
): Promise<void> {
  const caps = await getMigration003Capabilities(db);
  if (!caps.cronObservability) return;

  const sql =
    cronKind === "jobs"
      ? `UPDATE ingest_metadata SET
           jobs_cron_last_run_at = now(),
           jobs_cron_last_ok = $1,
           jobs_cron_last_summary = $2::jsonb
         WHERE id = 1`
      : `UPDATE ingest_metadata SET
           ingest_cron_last_run_at = now(),
           ingest_cron_last_ok = $1,
           ingest_cron_last_summary = $2::jsonb
         WHERE id = 1`;

  try {
    await db.queryRows(sql, [ok, JSON.stringify(summary)]);
  } catch (error) {
    if (isUndefinedColumnError(error)) {
      noteMigration003ColumnError(error);
      logJobsEvent("cron_metadata_write_skipped", {
        cron: cronKind,
        reason: "migration_003_columns_missing",
        column: undefinedColumnName(error) ?? "unknown",
      });
      return;
    }
    throw error;
  }
}

export async function recordJobsCronRun(
  db: DbExecutor,
  ok: boolean,
  summary: CronRunSummary,
): Promise<void> {
  await writeCronMetadata(db, "jobs", ok, summary);
}

export async function recordIngestCronRun(
  db: DbExecutor,
  ok: boolean,
  summary: CronRunSummary,
): Promise<void> {
  await writeCronMetadata(db, "ingest", ok, summary);
}

export function nullCronHealthFields(): Record<string, null> {
  const empty = emptyCronMetadata();
  return {
    jobs_last_run_at: empty.jobs_cron_last_run_at,
    jobs_last_ok: empty.jobs_cron_last_ok,
    jobs_last_summary: empty.jobs_cron_last_summary,
    ingest_last_run_at: empty.ingest_cron_last_run_at,
    ingest_last_ok: empty.ingest_cron_last_ok,
    ingest_last_summary: empty.ingest_cron_last_summary,
  };
}