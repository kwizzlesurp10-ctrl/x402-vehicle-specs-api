import type { AppEnv } from "../config/env.js";
import { CAIP2_BY_NETWORK, formatUsdPrice } from "../config/env.js";

export function buildOpenApiDocument(env: AppEnv): Record<string, unknown> {
  const network = CAIP2_BY_NETWORK[env.X402_NETWORK];
  return {
    openapi: "3.1.0",
    info: {
      title: "x402 Vehicle Specs API",
      version: "0.1.0",
      description:
        "EPA fueleconomy.gov vehicle specifications with x402 (USDC on Base) micropayments.",
    },
    servers: [{ url: "/" }],
    "x-x402": {
      protocol: "x402",
      network,
      facilitator: env.FACILITATOR_URL,
      pay_to: env.PAY_TO_ADDRESS,
      currency: "USDC",
      pricing: {
        "GET /v1/vehicles/search": formatUsdPrice(env.PRICE_SEARCH),
        "GET /v1/vehicles/:id": formatUsdPrice(env.PRICE_VEHICLE),
        "GET /v1/vehicles/:id/emissions": formatUsdPrice(env.PRICE_EMISSIONS),
        "GET /v1/compare": formatUsdPrice(env.PRICE_COMPARE),
        "GET /v1/stats": formatUsdPrice(env.PRICE_STATS),
      },
      free_endpoints: [
        "GET /health",
        "GET /v1/makes",
        "GET /v1/models",
        "GET /openapi.json",
        "GET /.well-known/x402.json",
      ],
    },
    paths: {
      "/health": { get: { summary: "Health check (free)" } },
      "/v1/makes": { get: { summary: "Year menu — makes (free)" } },
      "/v1/models": { get: { summary: "Year/make menu — models (free)" } },
      "/v1/vehicles/search": {
        get: { summary: "Search vehicles by year/make/model (paid)" },
      },
      "/v1/vehicles/{id}": { get: { summary: "Full vehicle record (paid)" } },
      "/v1/vehicles/{id}/emissions": {
        get: { summary: "Emissions-focused view (paid)" },
      },
      "/v1/compare": { get: { summary: "Compare up to 5 vehicle IDs (paid)" } },
      "/v1/stats": {
        get: { summary: "Aggregate MPG/engine mix by year & class (paid)" },
      },
    },
  };
}
