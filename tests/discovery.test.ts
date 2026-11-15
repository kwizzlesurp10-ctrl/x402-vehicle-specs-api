import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildOpenApiDocument } from "../src/api/openapi.js";
import {
  bazaarCompare,
  bazaarStats,
  bazaarVehicleById,
  bazaarVehicleEmissions,
  bazaarVehicleSearch,
} from "../src/api/bazaar-metadata.js";
import { resolvePublicBaseUrl } from "../src/lib/public-base-url.js";
import { loadEnv } from "../src/config/env.js";
import { createApp } from "../src/api/app.js";
import { preparePaymentLayer } from "../src/api/x402-routes.js";
import { createTestDb } from "./test-db.js";
import {
  normalizeVercelRequestPath,
  rewriteRequestForApiMount,
} from "../src/vercel-request-path.js";

describe("agent discovery", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    LLM_PROVIDER: "mock",
    FACILITATOR_URL: "https://x402.org/facilitator",
    PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
    API_BASE_PATH: "/api",
  });

  it("resolves OpenAPI server URL with /api prefix on Vercel-style hosts", () => {
    const base = resolvePublicBaseUrl({
      requestUrl: "https://x402-vehicle-specs-api.vercel.app/api/health",
      apiBasePath: "/api",
    });
    expect(base).toBe("https://x402-vehicle-specs-api.vercel.app/api");
    const doc = buildOpenApiDocument(env, base) as {
      servers: Array<{ url: string }>;
    };
    expect(doc.servers[0]?.url).toBe(base);
  });

  it("declares Bazaar extensions on paid route metadata", () => {
    for (const ext of [
      bazaarVehicleSearch,
      bazaarVehicleById,
      bazaarVehicleEmissions,
      bazaarCompare,
      bazaarStats,
    ]) {
      expect(ext.bazaar).toBeDefined();
      expect(ext.bazaar?.info?.input).toBeDefined();
    }
  });

  it("normalizes rewritten Vercel paths onto the /api mount", () => {
    expect(normalizeVercelRequestPath("/llms.txt", "/api")).toBe(
      "/api/llms.txt",
    );
    expect(normalizeVercelRequestPath("/health", "/api")).toBe("/api/health");
    expect(
      normalizeVercelRequestPath("/.well-known/x402.json", "/api"),
    ).toBe("/api/.well-known/x402.json");
    expect(normalizeVercelRequestPath("/", "/api")).toBe("/api");
    expect(normalizeVercelRequestPath("/api/v1/makes", "/api")).toBe(
      "/api/v1/makes",
    );
    expect(normalizeVercelRequestPath("/v1/makes", "/api")).toBe(
      "/api/v1/makes",
    );
  });

  it("vercel.json rewrites root discovery paths to /api", () => {
    const vercelPath = path.join(import.meta.dirname, "..", "vercel.json");
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const bySource = new Map(
      vercelConfig.rewrites.map((r) => [r.source, r.destination]),
    );
    expect(bySource.get("/.well-known/x402.json")).toBe(
      "/api/.well-known/x402.json",
    );
    expect(bySource.get("/openapi.json")).toBe("/api/openapi.json");
    expect(bySource.get("/llms.txt")).toBe("/api/llms.txt");
    expect(bySource.get("/health")).toBe("/api/health");
  });
});

describe("discovery routes", () => {
  it("serves llms.txt and landing JSON", async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LLM_PROVIDER: "mock",
      FACILITATOR_URL: "https://x402.org/facilitator",
      PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
      API_BASE_PATH: "/api",
    });
    const db = await createTestDb();
    const app = createApp({ db, env, enablePayments: false, basePath: "/api" });

    const llms = await app.request(
      "https://x402-vehicle-specs-api.vercel.app/api/llms.txt",
    );
    expect(llms.status).toBe(200);
    const llmsBody = await llms.text();
    expect(llmsBody).toContain("x402 Vehicle Specs API");
    expect(llmsBody).toContain("fueleconomy.gov");

    const root = await app.request(
      "https://x402-vehicle-specs-api.vercel.app/api",
    );
    expect(root.status).toBe(200);
    const landing = (await root.json()) as { discovery: { openapi: string } };
    expect(landing.discovery.openapi).toBe(
      "https://x402-vehicle-specs-api.vercel.app/api/openapi.json",
    );

    await db.close();
  });

  it("serves discovery routes when the incoming path omits /api (Vercel rewrite)", async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LLM_PROVIDER: "mock",
      FACILITATOR_URL: "https://x402.org/facilitator",
      PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
      API_BASE_PATH: "/api",
    });
    const db = await createTestDb();
    const app = createApp({ db, env, enablePayments: false, basePath: "/api" });

    const rewritten = rewriteRequestForApiMount(
      new Request("https://x402-vehicle-specs-api.vercel.app/llms.txt"),
      "/api",
    );
    expect(rewritten.url).toContain("/api/llms.txt");
    const llms = await app.fetch(rewritten);
    expect(llms.status).toBe(200);

    const health = await app.fetch(
      rewriteRequestForApiMount(
        new Request("https://x402-vehicle-specs-api.vercel.app/health"),
        "/api",
      ),
    );
    expect(health.status).toBe(200);

    const paymentLayer = await preparePaymentLayer(env);
    const paidApp = createApp({
      db,
      env,
      enablePayments: true,
      paymentLayer,
      basePath: "/api",
    });
    const unpaid = await paidApp.fetch(
      rewriteRequestForApiMount(
        new Request("https://x402-vehicle-specs-api.vercel.app/v1/vehicles/25262"),
        "/api",
      ),
    );
    expect(unpaid.status).toBe(402);
    const paymentHeader =
      unpaid.headers.get("payment-required") ??
      unpaid.headers.get("PAYMENT-REQUIRED");
    expect(paymentHeader).toBeTruthy();

    await db.close();
  });
});