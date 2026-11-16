import type { AppEnv } from "../config/env.js";
import { CAIP2_BY_NETWORK, formatUsdPrice } from "../config/env.js";
import { jobPriceTable } from "../jobs/pricing.js";
import { resolvePublicBaseUrl } from "../lib/public-base-url.js";
import { resolveFacilitatorPublicUrl } from "./facilitator.js";

export function buildLlmsTxt(
  env: AppEnv,
  publicBaseUrl: string,
): string {
  const network = CAIP2_BY_NETWORK[env.X402_NETWORK];
  const jobs = jobPriceTable(env);
  const lines = [
    "# x402 Vehicle Specs API",
    "",
    `Public base URL: ${publicBaseUrl}`,
    "",
    "EPA FuelEconomy.gov vehicle specifications (1984–present). Data attribution:",
    "- https://fueleconomy.gov/",
    "- https://fueleconomy.gov/ws/rest/vehicle/{id}",
    "",
    "## Discovery (free)",
    `- GET ${publicBaseUrl}/health`,
    `- GET ${publicBaseUrl}/openapi.json`,
    `- GET ${publicBaseUrl}/.well-known/x402.json`,
    `- GET ${publicBaseUrl}/llms.txt`,
    "",
    "## x402 payment",
    `- Network (CAIP-2): ${network}`,
    `- Facilitator: ${resolveFacilitatorPublicUrl(env)}`,
    `- Asset: USDC (exact scheme)`,
    `- Unsigned paid request → HTTP 402 with PAYMENT-REQUIRED header (v2)`,
    `- Retry with PAYMENT-SIGNATURE (or x-payment) after signing USDC transfer`,
    "",
    "## Pricing (USD per call)",
    `- GET /v1/vehicles/search — ${formatUsdPrice(env.PRICE_SEARCH)}`,
    `- GET /v1/vehicles/:id — ${formatUsdPrice(env.PRICE_VEHICLE)}`,
    `- GET /v1/vehicles/:id/emissions — ${formatUsdPrice(env.PRICE_EMISSIONS)}`,
    `- GET /v1/compare?ids= — ${formatUsdPrice(env.PRICE_COMPARE)}`,
    `- GET /v1/stats?year&class= — ${formatUsdPrice(env.PRICE_STATS)}`,
    ...Object.entries(jobs).map(
      ([route, price]) => `- ${route} — ${price} (tiered by job type/depth)`,
    ),
    "",
    "## Free routes",
    "- GET /v1/makes?year=",
    "- GET /v1/models?year=&make=",
    "- GET /v1/jobs/:id?poll_token=... (poll swarm jobs; token from POST /v1/jobs)",
    "",
    "## Example (expect 402 without wallet)",
    "```bash",
    `curl -i "${publicBaseUrl}/v1/vehicles/25262"`,
    "```",
    "",
    "OpenAPI and x402 manifest: same JSON at /openapi.json and /.well-known/x402.json.",
    "Bazaar discovery: paid routes declare @x402/extensions/bazaar metadata for CDP Bazaar indexing.",
    "",
  ];
  return lines.join("\n");
}

export function buildLandingJson(
  env: AppEnv,
  publicBaseUrl: string,
): Record<string, unknown> {
  return {
    name: "x402 Vehicle Specs API",
    description:
      "Pay-per-call vehicle specifications from EPA FuelEconomy.gov (USDC on Base via x402 v2).",
    production: publicBaseUrl,
    attribution: {
      agency: "U.S. EPA",
      source: "FuelEconomy.gov",
      urls: [
        "https://fueleconomy.gov/",
        "https://fueleconomy.gov/ws/rest/vehicle/{id}",
      ],
    },
    discovery: {
      health: `${publicBaseUrl}/health`,
      openapi: `${publicBaseUrl}/openapi.json`,
      x402: `${publicBaseUrl}/.well-known/x402.json`,
      llms_txt: `${publicBaseUrl}/llms.txt`,
    },
    x402: {
      network: CAIP2_BY_NETWORK[env.X402_NETWORK],
      facilitator: resolveFacilitatorPublicUrl(env),
      currency: "USDC",
    },
    docs: "See GET /llms.txt and GET /openapi.json for machine-readable pricing and schemas.",
  };
}

export function buildPublicUrls(env: AppEnv, requestUrl?: string) {
  const publicBaseUrl = resolvePublicBaseUrl({
    apiBasePath: env.API_BASE_PATH,
    ...(requestUrl !== undefined ? { requestUrl } : {}),
    ...(env.PUBLIC_BASE_URL !== undefined
      ? { publicBaseUrl: env.PUBLIC_BASE_URL }
      : {}),
  });
  return { publicBaseUrl };
}