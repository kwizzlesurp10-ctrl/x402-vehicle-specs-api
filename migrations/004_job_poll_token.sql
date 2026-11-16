-- Job poll token (payer-bound status polling)

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS poll_token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_poll_token_hash
  ON jobs (poll_token_hash)
  WHERE poll_token_hash IS NOT NULL;

-- DOWN (rollback — run manually)
-- DROP INDEX IF EXISTS idx_jobs_poll_token_hash;
-- ALTER TABLE jobs DROP COLUMN IF EXISTS poll_token_hash;