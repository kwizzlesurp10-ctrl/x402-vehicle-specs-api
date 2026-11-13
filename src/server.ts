import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";
import { loadEnv } from "./config/env.js";
import { preparePaymentLayer } from "./api/x402-routes.js";

const env = loadEnv();
const paymentLayer = await preparePaymentLayer(env);
const app = createApp({ env, paymentLayer, enablePayments: true });

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
  }),
);
