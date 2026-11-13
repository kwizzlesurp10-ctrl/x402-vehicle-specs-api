import { loadEnv } from "../src/config/env.js";
import { ingestFromEpa } from "../src/ingest/run.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const stats = await ingestFromEpa(env);
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...stats,
        database: env.DATABASE_PATH,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
