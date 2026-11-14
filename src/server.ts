import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";
import { loadEnv } from "./config/env.js";
import { createDbExecutor } from "./db/client.js";
import { preparePaymentLayer } from "./api/x402-routes.js";

const env = loadEnv({
  API_BASE_PATH: "",
  LLM_PROVIDER:
    (process.env.LLM_PROVIDER as "mock" | "openai" | "xai" | undefined) ?? "mock",
});
const db = await createDbExecutor(env);
const paymentLayer = await preparePaymentLayer(env);
const app = createApp({ db, env, paymentLayer, enablePayments: true, basePath: "" });

serve({
  fetch: app.fetch,
  hostname: "0.0.0.0",
  port: env.PORT,
});

console.log(
  JSON.stringify({
    message: "x402 vehicle specs API listening",
    port: env.PORT,
    network: env.X402_NETWORK,
    database: env.DATABASE_URL ? "postgres" : "pglite",
  }),
);
