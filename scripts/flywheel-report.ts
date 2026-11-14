import { loadEnv } from "../src/config/env.js";
import { createDbExecutor } from "../src/db/client.js";

const env = loadEnv();
const db = await createDbExecutor(env);

const topQueries = await db.queryRows<{
  job_type: string;
  query_fingerprint: string;
  n: number;
  success_rate: number;
}>(
  `SELECT job_type, query_fingerprint, COUNT(*)::int AS n, AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) AS success_rate
     FROM job_flywheel
     GROUP BY job_type, query_fingerprint
     ORDER BY n DESC
     LIMIT 25`,
);

const report = {
  generated_at: new Date().toISOString(),
  recommendation:
    "Promote repeated fingerprints to new cheap cached GET endpoints; feed Scout with job_type demand counts.",
  top_queries: topQueries,
  scout_signal: topQueries.map((row) => ({
    job_type: row.job_type,
    demand_count: row.n,
    candidate_cached_endpoint: `/v1/cache/${row.job_type}`,
  })),
};

console.log(JSON.stringify(report, null, 2));
await db.close();
