-- Job queue reliability + cron observability (additive)

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_queued_next_run
  ON jobs (status, next_run_at, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_jobs_running_started
  ON jobs (started_at)
  WHERE status = 'running';

ALTER TABLE ingest_metadata
  ADD COLUMN IF NOT EXISTS jobs_cron_last_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS jobs_cron_last_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS jobs_cron_last_summary JSONB,
  ADD COLUMN IF NOT EXISTS ingest_cron_last_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingest_cron_last_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS ingest_cron_last_summary JSONB;

-- DOWN (rollback — run manually)
-- DROP INDEX IF EXISTS idx_jobs_running_started;
-- DROP INDEX IF EXISTS idx_jobs_queued_next_run;
-- ALTER TABLE jobs
--   DROP COLUMN IF EXISTS next_run_at,
--   DROP COLUMN IF EXISTS max_attempts,
--   DROP COLUMN IF EXISTS attempt_count;
-- ALTER TABLE ingest_metadata
--   DROP COLUMN IF EXISTS ingest_cron_last_summary,
--   DROP COLUMN IF EXISTS ingest_cron_last_ok,
--   DROP COLUMN IF EXISTS ingest_cron_last_run_at,
--   DROP COLUMN IF EXISTS jobs_cron_last_summary,
--   DROP COLUMN IF EXISTS jobs_cron_last_ok,
--   DROP COLUMN IF EXISTS jobs_cron_last_run_at;