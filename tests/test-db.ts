import { loadEnv, type AppEnv } from "../src/config/env.js";
import { createDbExecutor } from "../src/db/client.js";
import type { DbExecutor } from "../src/db/executor.js";

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
