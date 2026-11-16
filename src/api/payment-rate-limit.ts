import type { MiddlewareHandler } from "hono";

type Bucket = {
  count: number;
  resetAtMs: number;
};

const buckets = new Map<string, Bucket>();

export type PaymentRateLimitOptions = {
  windowMs: number;
  maxRequests: number;
};

function clientIp(c: Parameters<MiddlewareHandler>[0]): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    c.req.header("x-real-ip") ??
    c.req.header("cf-connecting-ip") ??
    "unknown"
  );
}

function payerKey(c: Parameters<MiddlewareHandler>[0]): string | null {
  const payment =
    c.req.header("payment-signature") ?? c.req.header("x-payment");
  if (!payment) return null;
  return payment.slice(0, 64);
}

export function createPaymentRateLimitMiddleware(
  options: PaymentRateLimitOptions,
): MiddlewareHandler {
  const { windowMs, maxRequests } = options;
  return async (c, next) => {
    const now = Date.now();
    const key = payerKey(c) ?? `ip:${clientIp(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAtMs <= now) {
      bucket = { count: 0, resetAtMs: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      return c.json({ error: "rate_limited" }, 429);
    }
    return await next();
  };
}