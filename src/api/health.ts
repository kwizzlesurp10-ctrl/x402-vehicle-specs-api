import type { AppEnv } from "../config/env.js";
import { listPendingMigration003 } from "../db/migration-003-capabilities.js";
import { getIngestMetadata } from "../db/client.js";
import type { DbExecutor } from "../db/executor.js";
import { getCronMetadata, getJobsQueueStats } from "../jobs/queue-stats.js";

export async function buildHealthPayload(
  db: DbExecutor,
  env: AppEnv,
): Promise<Record<string, unknown>> {
  const metadata = await getIngestMetadata(db);
  const migrations_pending = await listPendingMigration003(db);

  const payload: Record<string, unknown> = {
    status: "ok",
    database: env.DATABASE_URL ? "postgres" : "pglite",
    vehicles_indexed: metadata?.vehicle_row_count ?? 0,
    data_updated_at: metadata?.vehicles_retrieved_at ?? null,
    emissions_updated_at: metadata?.emissions_retrieved_at ?? null,
    jobs_health: "/health/jobs",
  };

  if (migrations_pending.length > 0) {
    payload.migrations_pending = migrations_pending;
  }

  return payload;
}

export async function buildJobsHealthPayload(
  db: DbExecutor,
  env: AppEnv,
): Promise<Record<string, unknown>> {
  const queueStats = await getJobsQueueStats(db, env.JOB_RUN_LEASE_MS);
  const cronMeta = await getCronMetadata(db);
  const migrations_pending = await listPendingMigration003(db);

  const payload: Record<string, unknown> = {
    status: "ok",
    jobs_queue: queueStats,
    jobs_cron_last_run_at: cronMeta?.jobs_cron_last_run_at ?? null,
    jobs_cron_last_ok: cronMeta?.jobs_cron_last_ok ?? null,
    jobs_cron_last_summary: cronMeta?.jobs_cron_last_summary ?? null,
  };

  if (migrations_pending.length > 0) {
    payload.migrations_pending = migrations_pending;
  }

  return payload;
}