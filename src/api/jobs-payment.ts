import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
} from "@x402/hono";
import type { x402ResourceServer } from "@x402/core/server";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../config/env.js";
import { CAIP2_BY_NETWORK, formatUsdPrice } from "../config/env.js";
import { resolveJobPriceUsd } from "../jobs/pricing.js";
import { jobSubmitSchema, type JobSubmitRequest } from "../jobs/types.js";

export const JOB_BODY_KEY = "jobSubmitBody";

export function createJobsPaymentMiddleware(
  resourceServer: x402ResourceServer,
  env: AppEnv,
): MiddlewareHandler {
  return async (c, next) => {
    const raw = await c.req.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const parsed = jobSubmitSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const price = resolveJobPriceUsd(env, parsed.data.type, parsed.data.depth);
    c.set(JOB_BODY_KEY, parsed.data satisfies JobSubmitRequest);

    const network = CAIP2_BY_NETWORK[env.X402_NETWORK];
    const httpServer = new x402HTTPResourceServer(resourceServer, {
      "POST /v1/jobs": {
        accepts: {
          scheme: "exact",
          price: formatUsdPrice(price),
          network,
          payTo: env.PAY_TO_ADDRESS,
        },
        description: `Swarm job (${parsed.data.type}, ${parsed.data.depth})`,
        mimeType: "application/json",
      },
    });

    const payMiddleware = paymentMiddlewareFromHTTPServer(
      httpServer,
      undefined,
      undefined,
      false,
    );

    return payMiddleware(c, next);
  };
}
