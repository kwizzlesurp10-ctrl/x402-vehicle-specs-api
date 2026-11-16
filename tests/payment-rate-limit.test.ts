import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createPaymentRateLimitMiddleware } from "../src/api/payment-rate-limit.js";

describe("payment rate limit", () => {
  it("returns 429 when exceeding the per-IP budget", async () => {
    const limiter = createPaymentRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 2,
    });
    const app = new Hono();
    app.use("*", limiter);
    app.get("/paid", (c) => c.json({ ok: true }));

    const url = "http://127.0.0.1/paid";
    expect((await app.request(url)).status).toBe(200);
    expect((await app.request(url)).status).toBe(200);
    expect((await app.request(url)).status).toBe(429);
  });
});