import { loadEnv } from "../src/config/env.js";
import { createDirectDbExecutor, loadMigrationSql } from "../src/db/client.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const db = await createDirectDbExecutor(env);
  await db.exec(loadMigrationSql());
  console.log(JSON.stringify({ ok: true, migrated: "001_init.sql" }));
  await db.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
