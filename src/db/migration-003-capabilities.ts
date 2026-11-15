import type { DbExecutor } from "./executor.js";
import {
  isUndefinedColumnError,
  undefinedColumnName,
} from "./postgres-errors.js";

export const MIGRATION_003_ID = "003_job_queue_observability";

export const MIGRATION_003_CRON_COLUMNS = [
  "jobs_cron_last_run_at",
  "jobs_cron_last_ok",
  "jobs_cron_last_summary",
  "ingest_cron_last_run_at",
  "ingest_cron_last_ok",
  "ingest_cron_last_summary",
] as const;

export const MIGRATION_003_JOB_COLUMNS = [
  "attempt_count",
  "max_attempts",
  "next_run_at",
] as const;

export type Migration003Capabilities = {
  cronObservability: boolean;
  jobReliability: boolean;
};

let cachedCapabilities: Migration003Capabilities | null = null;

export function resetMigration003CapabilitiesCache(): void {
  cachedCapabilities = null;
}

function applyMissingColumnToCache(column: string | null): void {
  if (!column) return;
  const next = cachedCapabilities ?? {
    cronObservability: true,
    jobReliability: true,
  };
  if (
    (MIGRATION_003_CRON_COLUMNS as readonly string[]).includes(column)
  ) {
    next.cronObservability = false;
  }
  if ((MIGRATION_003_JOB_COLUMNS as readonly string[]).includes(column)) {
    next.jobReliability = false;
  }
  cachedCapabilities = next;
}

export function noteMigration003ColumnError(error: unknown): void {
  if (!isUndefinedColumnError(error)) return;
  applyMissingColumnToCache(undefinedColumnName(error));
}

export async function getMigration003Capabilities(
  db: DbExecutor,
): Promise<Migration003Capabilities> {
  if (cachedCapabilities) return cachedCapabilities;

  const rows = await db.queryRows<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (
         (table_name = 'ingest_metadata' AND column_name = 'jobs_cron_last_run_at')
         OR (table_name = 'jobs' AND column_name = 'attempt_count')
       )`,
  );
  const names = new Set(rows.map((row) => row.column_name));
  cachedCapabilities = {
    cronObservability: names.has("jobs_cron_last_run_at"),
    jobReliability: names.has("attempt_count"),
  };
  return cachedCapabilities;
}

export async function listPendingMigration003(
  db: DbExecutor,
): Promise<string[]> {
  const caps = await getMigration003Capabilities(db);
  if (caps.cronObservability && caps.jobReliability) return [];
  return [MIGRATION_003_ID];
}

export function emptyCronMetadata(): {
  jobs_cron_last_run_at: null;
  jobs_cron_last_ok: null;
  jobs_cron_last_summary: null;
  ingest_cron_last_run_at: null;
  ingest_cron_last_ok: null;
  ingest_cron_last_summary: null;
} {
  return {
    jobs_cron_last_run_at: null,
    jobs_cron_last_ok: null,
    jobs_cron_last_summary: null,
    ingest_cron_last_run_at: null,
    ingest_cron_last_ok: null,
    ingest_cron_last_summary: null,
  };
}