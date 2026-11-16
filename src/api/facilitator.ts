import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import type { AppEnv } from "../config/env.js";

export type FacilitatorMode = "cdp" | "http";

export function cdpFacilitatorConfigured(env: AppEnv): boolean {
  return Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);
}

export function resolveFacilitatorClient(env: AppEnv): FacilitatorClient {
  if (cdpFacilitatorConfigured(env)) {
    throw new Error(
      "CDP facilitator requires preparePaymentLayer (async client bootstrap)",
    );
  }
  return new HTTPFacilitatorClient({
    url: env.FACILITATOR_URL,
  });
}

export async function resolveFacilitatorClientAsync(
  env: AppEnv,
): Promise<FacilitatorClient> {
  if (cdpFacilitatorConfigured(env)) {
    const { createCdpFacilitatorClient } = await import("@coinbase/cdp-sdk/x402");
    return createCdpFacilitatorClient({
      apiKeyId: env.CDP_API_KEY_ID!,
      apiKeySecret: env.CDP_API_KEY_SECRET!,
    }) as FacilitatorClient;
  }
  return new HTTPFacilitatorClient({
    url: env.FACILITATOR_URL,
  });
}

export function resolveFacilitatorPublicUrl(env: AppEnv): string {
  return cdpFacilitatorConfigured(env)
    ? "https://api.cdp.coinbase.com/platform/v2/x402"
    : env.FACILITATOR_URL;
}

export function resolveFacilitatorMode(env: AppEnv): FacilitatorMode {
  return cdpFacilitatorConfigured(env) ? "cdp" : "http";
}