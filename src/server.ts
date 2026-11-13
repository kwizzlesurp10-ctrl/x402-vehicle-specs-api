import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";
import { loadEnv } from "./config/env.js";
import { preparePaymentLayer } from "./api/x402-routes.js";
import { openDatabase } from "./db/client.js";
import { JobWorker } from "./jobs/worker.js";

const env = loadEnv();
const db = openDatabase(env.DATABASE_PATH);
const jobWorker = new JobWorker({ db, env });
const paymentLayer = await preparePaymentLayer(env);
const app = createApp({ env, paymentLayer, enablePayments: true, jobWorker });

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
    job_concurrency: env.JOB_MAX_CONCURRENCY,
  }),
);
