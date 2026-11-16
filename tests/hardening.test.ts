import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { buildHealthPayload } from "../src/api/health.js";
import {
  cdpFacilitatorConfigured,
  resolveFacilitatorClientAsync,
  resolveFacilitatorMode,
  resolveFacilitatorPublicUrl,
} from "../src/api/facilitator.js";
import { JOB_POST_PAYMENT_FLOW } from "../src/api/jobs-payment.js";
import { preparePaymentLayer } from "../src/api/x402-routes.js";
import { loadEnv } from "../src/config/env.js";
import { assertPublicHttpsWebhookUrl, SsrfBlockedError } from "../src/lib/ssrf-guard.js";
import { createTestDb, testEnv } from "./test-db.js";
import type { DbExecutor } from "../src/db/executor.js";

describe("pre-mainnet hardening", () => {
  it("uses upfront settlement for POST /v1/jobs", () => {
    expect(JOB_POST_PAYMENT_FLOW.paymentFlow).toBe("upfront");
  });

  it("trims PAY_TO_ADDRESS whitespace", () => {
    const env = loadEnv({
      PAY_TO_ADDRESS: "  0x0000000000000000000000000000000000000001  \n",
    });
    expect(env.PAY_TO_ADDRESS).toBe("0x0000000000000000000000000000000000000001");
  });

  it("selects CDP facilitator when API keys are set", async () => {
    const without = testEnv();
    expect(cdpFacilitatorConfigured(without)).toBe(false);
    expect(resolveFacilitatorMode(without)).toBe("http");
    expect(resolveFacilitatorPublicUrl(without)).toBe(without.FACILITATOR_URL);

    const withCdp = loadEnv({
      ...without,
      CDP_API_KEY_ID: "key-id",
      CDP_API_KEY_SECRET: "key-secret",
    });
    expect(cdpFacilitatorConfigured(withCdp)).toBe(true);
    expect(resolveFacilitatorMode(withCdp)).toBe("cdp");
    expect(resolveFacilitatorPublicUrl(withCdp)).toBe(
      "https://api.cdp.coinbase.com/platform/v2/x402",
    );
    await expect(resolveFacilitatorClientAsync(withCdp)).resolves.toBeDefined();
  });

  it("blocks private and non-https webhook URLs", async () => {
    await expect(
      assertPublicHttpsWebhookUrl("http://example.com/hook"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      assertPublicHttpsWebhookUrl("https://127.0.0.1/hook"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      assertPublicHttpsWebhookUrl("https://localhost/hook"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  describe("health surface", () => {
    let db: DbExecutor;

    beforeAll(async () => {
      db = await createTestDb();
    });

    afterAll(async () => {
      await db.close();
    });

    it("keeps /health lightweight and points to /health/jobs", async () => {
      const env = testEnv();
      const payload = await buildHealthPayload(db, env);
      expect(payload.jobs_health).toBe("/health/jobs");
      expect(payload).not.toHaveProperty("jobs_queue");
      expect(payload).not.toHaveProperty("cron");
    });
  });

  describe("job poll token", () => {
    let db: DbExecutor;

    beforeAll(async () => {
      db = await createTestDb();
    });

    afterAll(async () => {
      await db.close();
    });

    it("requires poll_token on GET /v1/jobs/:id", async () => {
      const env = testEnv();
      const app = createApp({ db, env, enablePayments: false });
      const create = await app.request("http://127.0.0.1/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "starter_kit",
          depth: "standard",
          input: { language: "typescript" },
        }),
      });
      expect(create.status).toBe(202);
      const body = (await create.json()) as {
        job_id: string;
        poll_token: string;
      };
      expect(body.poll_token.length).toBeGreaterThan(20);

      const denied = await app.request(`http://127.0.0.1/v1/jobs/${body.job_id}`);
      expect(denied.status).toBe(401);

      const ok = await app.request(
        `http://127.0.0.1/v1/jobs/${body.job_id}?poll_token=${encodeURIComponent(body.poll_token)}`,
      );
      expect(ok.status).toBe(200);
    });

    it("returns generic 402 for invalid job body without payment", async () => {
      const paymentLayer = await preparePaymentLayer(testEnv());
      const app = createApp({
        db,
        env: testEnv(),
        enablePayments: true,
        paymentLayer,
      });
      const res = await app.request("http://127.0.0.1/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "not_a_job", input: {} }),
      });
      expect(res.status).toBe(402);
      const json = (await res.json()) as { error?: string; details?: unknown };
      expect(json.error).toBe("payment_required");
      expect(json.details).toBeUndefined();
    });
  });
});