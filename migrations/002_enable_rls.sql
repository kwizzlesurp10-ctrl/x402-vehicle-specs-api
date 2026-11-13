-- Shared Supabase project hardening: block PostgREST / Data API (anon, authenticated)
-- from reading or writing API tables. No policies are defined, so only roles that bypass
-- RLS (e.g. postgres, service_role) can access — the Vercel app uses the owner connection.

ALTER TABLE ingest_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_flywheel ENABLE ROW LEVEL SECURITY;
