import type { AppEnv } from "../config/env.js";
import { getIngestMetadata } from "../db/client.js";
import type { DbExecutor } from "../db/executor.js";
import { getCronMetadata, getJobsQueueStats } from "../jobs/queue-stats.js";

export async function buildHealthPayload(
  db: DbExecutor,
  env: AppEnv,
): Promise<Record<string, unknown>> {
  const metadata = await getIngestMetadata(db);
  const queueStats = await getJobsQueueStats(db, env.JOB_RUN_LEASE_MS);
  const cronMeta = await getCronMetadata(db);

  return {
    status: "ok",
    database: env.DATABASE_URL ? "postgres" : "pglite",
    vehicles_indexed: metadata?.vehicle_row_count ?? 0,
    data_updated_at: metadata?.vehicles_retrieved_at ?? null,
    emissions_updated_at: metadata?.emissions_retrieved_at ?? null,
    jobs_queue: queueStats,
    cron: cronMeta
      ? {
          jobs_last_run_at: cronMeta.jobs_cron_last_run_at,
          jobs_last_ok: cronMeta.jobs_cron_last_ok,
          jobs_last_summary: cronMeta.jobs_cron_last_summary,
          ingest_last_run_at: cronMeta.ingest_cron_last_run_at,
          ingest_last_ok: cronMeta.ingest_cron_last_ok,
          ingest_last_summary: cronMeta.ingest_cron_last_summary,
        }
      : {
          jobs_last_run_at: null,
          jobs_last_ok: null,
          jobs_last_summary: null,
          ingest_last_run_at: null,
          ingest_last_ok: null,
          ingest_last_summary: null,
        },
    cron_auth:
      env.CRON_SECRET !== undefined && env.CRON_SECRET.length > 0
        ? "bearer_secret_required"
        : env.NODE_ENV === "production"
          ? "misconfigured"
          : "open_in_dev",
  };
}

export async function buildJobsHealthPayload(
  db: DbExecutor,
  env: AppEnv,
): Promise<Record<string, unknown>> {
  const queueStats = await getJobsQueueStats(db, env.JOB_RUN_LEASE_MS);
  const cronMeta = await getCronMetadata(db);
  return {
    status: "ok",
    jobs_queue: queueStats,
    jobs_cron_last_run_at: cronMeta?.jobs_cron_last_run_at ?? null,
    jobs_cron_last_ok: cronMeta?.jobs_cron_last_ok ?? null,
    jobs_cron_last_summary: cronMeta?.jobs_cron_last_summary ?? null,
  };
}