import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
} from "@x402/hono";
import type { x402ResourceServer } from "@x402/core/server";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../config/env.js";
import { CAIP2_BY_NETWORK, formatUsdPrice } from "../config/env.js";
import { maxJobPriceUsd, resolveJobPriceUsd } from "../jobs/pricing.js";
import { jobSubmitSchema, type JobSubmitRequest } from "../jobs/types.js";
import { bazaarPostJob } from "./bazaar-metadata.js";

export const JOB_BODY_KEY = "jobSubmitBody";

/** POST /v1/jobs settles on-chain before the handler runs (no job side effects if settle fails). */
export const JOB_POST_PAYMENT_FLOW = { paymentFlow: "upfront" } as const;

export function createJobsPaymentMiddleware(
  resourceServer: x402ResourceServer,
  env: AppEnv,
): MiddlewareHandler {
  return async (c, next) => {
    const raw = await c.req.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }

    const parsed =
      json !== null ? jobSubmitSchema.safeParse(json) : { success: false as const, error: null };

    if (parsed.success) {
      c.set(JOB_BODY_KEY, parsed.data satisfies JobSubmitRequest);
    }

    const price = parsed.success
      ? resolveJobPriceUsd(env, parsed.data.type, parsed.data.depth)
      : maxJobPriceUsd(env);

    const network = CAIP2_BY_NETWORK[env.X402_NETWORK];
    const httpServer = new x402HTTPResourceServer(resourceServer, {
      "POST /v1/jobs": {
        accepts: {
          scheme: "exact",
          price: formatUsdPrice(price),
          network,
          payTo: env.PAY_TO_ADDRESS,
          extra: JOB_POST_PAYMENT_FLOW,
        },
        description: parsed.success
          ? `Swarm job (${parsed.data.type}, ${parsed.data.depth})`
          : "Swarm job (tiered pricing)",
        mimeType: "application/json",
        serviceName: "vehicle-specs",
        tags: ["jobs", "swarm", "analysis"],
        extensions: bazaarPostJob,
        unpaidResponseBody: () => ({
          contentType: "application/json",
          body: { error: "payment_required" },
        }),
      },
    });

    const payMiddleware = paymentMiddlewareFromHTTPServer(
      httpServer,
      undefined,
      undefined,
      false,
    );

    return payMiddleware(c, async () => {
      if (!parsed.success) {
        c.res = c.json({ error: "invalid_job_body" }, 400);
        return;
      }
      await next();
    });
  };
}