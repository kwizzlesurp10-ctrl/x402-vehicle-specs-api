import { loadEnv } from "./config/env.js";
import { createDbExecutor } from "./db/client.js";
import { createApp } from "./api/app.js";
import { preparePaymentLayer } from "./api/x402-routes.js";

export async function buildVercelApp(basePath = "/api") {
  const env = loadEnv({ API_BASE_PATH: basePath });
  const db = await createDbExecutor(env);
  const paymentLayer = await preparePaymentLayer(env);
  return createApp({
    db,
    env,
    paymentLayer,
    enablePayments: true,
    basePath,
  });
}
