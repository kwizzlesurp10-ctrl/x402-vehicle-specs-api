import type { AppEnv } from "../config/env.js";
import { CAIP2_BY_NETWORK, formatUsdPrice } from "../config/env.js";
import { jobPriceTable } from "../jobs/pricing.js";

export function buildOpenApiDocument(env: AppEnv): Record<string, unknown> {
  const network = CAIP2_BY_NETWORK[env.X402_NETWORK];
  return {
    openapi: "3.1.0",
    info: {
      title: "x402 Vehicle Specs API",
      version: "0.2.0",
      description:
        "EPA fueleconomy.gov vehicle specifications with x402 (USDC on Base) micropayments and paid swarm analysis jobs.",
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
        ...jobPriceTable(env),
      },
      free_endpoints: [
        "GET /health",
        "GET /v1/makes",
        "GET /v1/models",
        "GET /v1/jobs/:id",
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
      "/v1/jobs": {
        post: {
          summary: "Enqueue paid swarm analysis job (x402, tiered pricing)",
          description:
            "Returns 202 + job_id immediately. Poll GET /v1/jobs/:id (free). Optional webhook_url for completion callback.",
        },
      },
      "/v1/jobs/{id}": {
        get: { summary: "Job status/result (free)" },
      },
    },
    "x-swarm-jobs": {
      types: [
        "fleet_analysis",
        "comparison_report",
        "trend_insights",
        "custom_export",
        "starter_kit",
      ],
      schemas: "prompts/schemas/jobs/",
      safeguards: {
        token_cap: env.JOB_MAX_TOKENS,
        timeout_ms: env.JOB_TIMEOUT_MS,
        concurrency: env.JOB_MAX_CONCURRENCY,
        refund_eligible_on: ["partial", "failed", "timed_out"],
      },
    },
  };
}
