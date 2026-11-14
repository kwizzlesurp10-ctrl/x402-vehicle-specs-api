import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../config/env.js";
import {
  CAIP2_BY_NETWORK,
  formatUsdPrice,
  type Caip2Network,
} from "../config/env.js";

export type PaymentLayer = {
  middleware: MiddlewareHandler;
  network: Caip2Network;
  resourceServer: x402ResourceServer;
};

export function createPaymentLayer(env: AppEnv): PaymentLayer {
  const network = CAIP2_BY_NETWORK[env.X402_NETWORK];
  const facilitatorClient = new HTTPFacilitatorClient({
    url: env.FACILITATOR_URL,
  });
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register("eip155:*", new ExactEvmScheme())
    .register(network, new ExactEvmScheme());

  const acceptsBase = {
    scheme: "exact" as const,
    network,
    payTo: env.PAY_TO_ADDRESS,
  };

  const middleware = paymentMiddleware(
    {
      "GET /v1/vehicles/search": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_SEARCH),
        },
        description: "Search EPA vehicle records",
        mimeType: "application/json",
      },
      "GET /v1/vehicles/:id": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_VEHICLE),
        },
        description: "Vehicle specifications by EPA ID",
        mimeType: "application/json",
      },
      "GET /v1/vehicles/:id/emissions": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_EMISSIONS),
        },
        description: "Emissions details by EPA ID",
        mimeType: "application/json",
      },
      "GET /v1/compare": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_COMPARE),
        },
        description: "Compare multiple EPA vehicle IDs",
        mimeType: "application/json",
      },
      "GET /v1/stats": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_STATS),
        },
        description: "Aggregate stats by model year and EPA vehicle class",
        mimeType: "application/json",
      },
    },
    resourceServer,
    undefined,
    undefined,
    false,
  );

  return { middleware, network, resourceServer };
}

export async function preparePaymentLayer(env: AppEnv): Promise<PaymentLayer> {
  const layer = createPaymentLayer(env);
  await layer.resourceServer.initialize();
  return layer;
}
