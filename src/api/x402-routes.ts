import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../config/env.js";
import {
  CAIP2_BY_NETWORK,
  formatUsdPrice,
  type Caip2Network,
} from "../config/env.js";
import type { FacilitatorClient } from "@x402/core/server";
import {
  resolveFacilitatorClient,
  resolveFacilitatorClientAsync,
  resolveFacilitatorPublicUrl,
} from "./facilitator.js";
import { createPaymentRateLimitMiddleware } from "./payment-rate-limit.js";
import { logJobsEvent } from "../lib/job-logger.js";
import {
  bazaarCompare,
  bazaarStats,
  bazaarVehicleById,
  bazaarVehicleEmissions,
  bazaarVehicleSearch,
} from "./bazaar-metadata.js";

export type PaymentLayer = {
  rateLimitMiddleware: MiddlewareHandler;
  settleMiddleware: MiddlewareHandler;
  network: Caip2Network;
  resourceServer: x402ResourceServer;
};

export function createPaymentLayer(
  env: AppEnv,
  facilitatorClient?: FacilitatorClient,
): PaymentLayer {
  const network = CAIP2_BY_NETWORK[env.X402_NETWORK];
  const facilitator =
    facilitatorClient ?? resolveFacilitatorClient(env);
  const resourceServer = new x402ResourceServer(facilitator)
    .register("eip155:*", new ExactEvmScheme())
    .register(network, new ExactEvmScheme())
    .onSettleFailure(async (context) => {
      const transport = context.transportContext as
        | { request?: { path?: string; method?: string } }
        | undefined;
      logJobsEvent("x402_settle_failure", {
        facilitator: resolveFacilitatorPublicUrl(env),
        path: transport?.request?.path ?? null,
        method: transport?.request?.method ?? null,
        phase: context.phase,
        error: context.error.message,
      });
    });

  const acceptsBase = {
    scheme: "exact" as const,
    network,
    payTo: env.PAY_TO_ADDRESS,
  };

  const paidRateLimit = createPaymentRateLimitMiddleware({
    windowMs: 60_000,
    maxRequests: 120,
  });

  const settleMiddleware = paymentMiddleware(
    {
      "GET /v1/vehicles/search": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_SEARCH),
        },
        description: "Search EPA vehicle records",
        mimeType: "application/json",
        serviceName: "vehicle-specs",
        tags: ["vehicles", "search", "epa"],
        extensions: bazaarVehicleSearch,
      },
      "GET /v1/vehicles/:id": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_VEHICLE),
        },
        description: "Vehicle specifications by EPA ID",
        mimeType: "application/json",
        serviceName: "vehicle-specs",
        tags: ["vehicles", "epa"],
        extensions: bazaarVehicleById,
      },
      "GET /v1/vehicles/:id/emissions": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_EMISSIONS),
        },
        description: "Emissions details by EPA ID",
        mimeType: "application/json",
        serviceName: "vehicle-specs",
        tags: ["vehicles", "emissions", "epa"],
        extensions: bazaarVehicleEmissions,
      },
      "GET /v1/compare": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_COMPARE),
        },
        description: "Compare multiple EPA vehicle IDs",
        mimeType: "application/json",
        serviceName: "vehicle-specs",
        tags: ["vehicles", "compare", "epa"],
        extensions: bazaarCompare,
      },
      "GET /v1/stats": {
        accepts: {
          ...acceptsBase,
          price: formatUsdPrice(env.PRICE_STATS),
        },
        description: "Aggregate stats by model year and EPA vehicle class",
        mimeType: "application/json",
        serviceName: "vehicle-specs",
        tags: ["vehicles", "stats", "epa"],
        extensions: bazaarStats,
      },
    },
    resourceServer,
    undefined,
    undefined,
    false,
  );

  return {
    rateLimitMiddleware: paidRateLimit,
    settleMiddleware,
    network,
    resourceServer,
  };
}

export async function preparePaymentLayer(env: AppEnv): Promise<PaymentLayer> {
  const facilitatorClient = await resolveFacilitatorClientAsync(env);
  const layer = createPaymentLayer(env, facilitatorClient);
  await layer.resourceServer.initialize();
  return layer;
}
