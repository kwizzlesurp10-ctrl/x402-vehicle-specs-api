import { loadEnv, type AppEnv } from "../src/config/env.js";
import {
  createDbExecutor,
  loadMigrationSqlExcluding,
} from "../src/db/client.js";
import { resetMigration003CapabilitiesCache } from "../src/db/migration-003-capabilities.js";
import type { DbExecutor } from "../src/db/executor.js";
import { createPgliteExecutor } from "../src/db/pglite.js";

export function testEnv(): AppEnv {
  return loadEnv({
    NODE_ENV: "test",
    LLM_PROVIDER: "mock",
    FACILITATOR_URL: "https://x402.org/facilitator",
    PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
  });
}

export async function createTestDb(): Promise<DbExecutor> {
  return createDbExecutor(testEnv());
}

export async function createTestDbBeforeMigration003(): Promise<DbExecutor> {
  resetMigration003CapabilitiesCache();
  return createPgliteExecutor(loadMigrationSqlExcluding("003_"));
}
