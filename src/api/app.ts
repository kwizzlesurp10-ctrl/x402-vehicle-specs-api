import { Hono } from "hono";
import type { AppEnv } from "../config/env.js";
import { getIngestMetadata } from "../db/client.js";
import type { DbExecutor } from "../db/executor.js";
import { withSource } from "../lib/attribution.js";
import { err, ok, type Result } from "../lib/result.js";
import { buildOpenApiDocument } from "./openapi.js";
import { VehicleRepository } from "./repository.js";
import { buildSourceMeta, serializeVehicle } from "./serializers.js";
import { JOB_BODY_KEY, createJobsPaymentMiddleware } from "./jobs-payment.js";
import { createPaymentLayer, type PaymentLayer } from "./x402-routes.js";
import { JobQueue } from "../jobs/queue.js";
import { resolveJobPriceUsd } from "../jobs/pricing.js";
import { jobSubmitSchema, type JobSubmitRequest } from "../jobs/types.js";
import { processJobById, processQueuedBatch } from "../jobs/worker-once.js";
import { ingestFromEpa } from "../ingest/run.js";

export type CreateAppOptions = {
  db: DbExecutor;
  env: AppEnv;
  enablePayments?: boolean;
  paymentLayer?: PaymentLayer;
  basePath?: string;
};

function parsePositiveInt(raw: string | undefined): Result<number, string> {
  if (raw === undefined) return err("missing");
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return err("invalid");
  return ok(n);
}

function isAuthorizedCron(c: import("hono").Context, env: AppEnv): boolean {
  if (!env.CRON_SECRET) return env.NODE_ENV !== "production";
  const auth = c.req.header("authorization");
  return auth === `Bearer ${env.CRON_SECRET}`;
}

async function kickJob(
  env: AppEnv,
  db: DbExecutor,
  jobId: string,
): Promise<void> {
  if (env.NODE_ENV === "test") return;
  const runner = { db, env };
  if (process.env.VERCEL === "1") {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(processJobById(runner, jobId));
    return;
  }
  void processJobById(runner, jobId);
}

export function createApp(options: CreateAppOptions): Hono {
  const { env, db } = options;
  const enablePayments = options.enablePayments ?? env.NODE_ENV !== "test";
  const repo = new VehicleRepository(db);
  const jobQueue = new JobQueue(db);
  const app = new Hono().basePath(options.basePath ?? env.API_BASE_PATH);

  app.get("/health", async (c) => {
    const metadata = await getIngestMetadata(db);
    return c.json({
      status: "ok",
      database: env.DATABASE_URL ? "postgres" : "pglite",
      vehicles_indexed: metadata?.vehicle_row_count ?? 0,
      data_updated_at: metadata?.vehicles_retrieved_at ?? null,
    });
  });

  app.get("/openapi.json", (c) => c.json(buildOpenApiDocument(env)));
  app.get("/.well-known/x402.json", (c) => c.json(buildOpenApiDocument(env)));

  app.get("/cron/ingest", async (c) => {
    if (!isAuthorizedCron(c, env)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const stats = await ingestFromEpa(env);
    return c.json({ ok: true, ...stats });
  });

  app.get("/cron/jobs", async (c) => {
    if (!isAuthorizedCron(c, env)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const processed = await processQueuedBatch(
      { db, env },
      env.JOB_MAX_CONCURRENCY,
    );
    return c.json({ ok: true, processed });
  });

  app.get("/v1/makes", async (c) => {
    const yearResult = parsePositiveInt(c.req.query("year"));
    if (!yearResult.ok) {
      return c.json({ error: "year query parameter is required" }, 400);
    }
    const makes = await repo.listMakes(yearResult.value);
    return c.json(
      withSource(
        { year: yearResult.value, makes, count: makes.length },
        buildSourceMeta(await getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/models", async (c) => {
    const yearResult = parsePositiveInt(c.req.query("year"));
    const make = c.req.query("make");
    if (!yearResult.ok || !make) {
      return c.json(
        { error: "year and make query parameters are required" },
        400,
      );
    }
    const models = await repo.listModels(yearResult.value, make);
    return c.json(
      withSource(
        {
          year: yearResult.value,
          make,
          models,
          count: models.length,
        },
        buildSourceMeta(await getIngestMetadata(db)),
      ),
    );
  });

  const postJob = async (c: import("hono").Context) => {
    const body = enablePayments
      ? (c.get(JOB_BODY_KEY) as JobSubmitRequest | undefined)
      : undefined;
    const json = body ?? (await c.req.json());
    const parsed = jobSubmitSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const paymentUsd = resolveJobPriceUsd(
      env,
      parsed.data.type,
      parsed.data.depth,
    );
    const record = await jobQueue.createJob({ request: parsed.data, paymentUsd });
    await kickJob(env, db, record.id);

    return c.json(
      {
        job_id: record.id,
        status: record.status,
        type: record.type,
        depth: record.depth,
        payment_usd: paymentUsd,
        poll_url: `/v1/jobs/${record.id}`,
        refund_policy:
          "If status=partial or failed with refund_eligible=true, contact the operator for manual USDC refund (on-chain hook TBD).",
      },
      202,
    );
  };

  if (enablePayments) {
    const payment = options.paymentLayer ?? createPaymentLayer(env);
    app.use("/v1/vehicles/*", payment.middleware);
    app.use("/v1/vehicles", payment.middleware);
    app.use("/v1/compare", payment.middleware);
    app.use("/v1/stats", payment.middleware);
    app.post(
      "/v1/jobs",
      createJobsPaymentMiddleware(payment.resourceServer, env),
      postJob,
    );
  } else {
    app.post("/v1/jobs", postJob);
  }

  app.get("/v1/jobs/:id", async (c) => {
    const job = await jobQueue.getById(c.req.param("id"));
    if (!job) return c.json({ error: "job not found" }, 404);
    return c.json({
      job_id: job.id,
      type: job.type,
      depth: job.depth,
      status: job.status,
      payment_usd: job.payment_usd,
      refund_eligible: job.refund_eligible === 1,
      verifier_passed: job.verifier_passed === 1,
      tokens_used: job.tokens_used,
      created_at: job.created_at,
      updated_at: job.updated_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      error_message: job.error_message,
      result: job.result_json ? JSON.parse(job.result_json) : null,
    });
  });

  app.get("/v1/vehicles/search", async (c) => {
    const yearParam = c.req.query("year");
    const make = c.req.query("make");
    const model = c.req.query("model");
    const limitRaw = c.req.query("limit") ?? "25";
    const limit = Math.min(
      Math.max(Number.parseInt(limitRaw, 10) || 25, 1),
      100,
    );

    const year = yearParam ? Number.parseInt(yearParam, 10) : undefined;
    if (yearParam && (!Number.isFinite(year) || (year ?? 0) < 1984)) {
      return c.json({ error: "invalid year" }, 400);
    }

    const rows = await repo.search({
      ...(year !== undefined ? { year } : {}),
      ...(make ? { make } : {}),
      ...(model ? { model } : {}),
      limit,
    });

    return c.json(
      withSource(
        {
          query: { year: year ?? null, make: make ?? null, model: model ?? null },
          count: rows.length,
          vehicles: rows.map(serializeVehicle),
        },
        buildSourceMeta(await getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/vehicles/:id", async (c) => {
    const idResult = parsePositiveInt(c.req.param("id"));
    if (!idResult.ok) return c.json({ error: "invalid vehicle id" }, 400);
    const row = await repo.getById(idResult.value);
    if (!row) return c.json({ error: "vehicle not found" }, 404);
    return c.json(
      withSource(
        { vehicle: serializeVehicle(row) },
        buildSourceMeta(await getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/vehicles/:id/emissions", async (c) => {
    const idResult = parsePositiveInt(c.req.param("id"));
    if (!idResult.ok) return c.json({ error: "invalid vehicle id" }, 400);
    const row = await repo.getById(idResult.value);
    if (!row) return c.json({ error: "vehicle not found" }, 404);
    const vehicle = serializeVehicle(row);
    return c.json(
      withSource(
        {
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          emissions: vehicle.emissions,
          missing_fields_notes: vehicle.missing_fields_notes,
        },
        buildSourceMeta(await getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/compare", async (c) => {
    const idsRaw = c.req.query("ids");
    if (!idsRaw) return c.json({ error: "ids query parameter is required" }, 400);
    const ids = idsRaw
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0 || ids.length > 5) {
      return c.json({ error: "provide 1-5 comma-separated vehicle ids" }, 400);
    }
    const rows = await repo.getMany(ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return c.json(
      withSource(
        {
          requested_ids: ids,
          found_count: rows.length,
          vehicles: ids.map((id) => {
            const row = byId.get(id);
            return row ? serializeVehicle(row) : { id, found: false };
          }),
        },
        buildSourceMeta(await getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/stats", async (c) => {
    const yearResult = parsePositiveInt(c.req.query("year"));
    const vehicleClass = c.req.query("class");
    if (!yearResult.ok || !vehicleClass) {
      return c.json(
        { error: "year and class query parameters are required" },
        400,
      );
    }
    const stats = await repo.statsByYearAndClass(yearResult.value, vehicleClass);
    return c.json(
      withSource(
        {
          year: yearResult.value,
          vehicle_class: vehicleClass,
          stats: {
            count: stats.count,
            avg_city_mpg: stats.avg_city_mpg,
            avg_highway_mpg: stats.avg_highway_mpg,
            avg_combined_mpg: stats.avg_combined_mpg,
            avg_displacement_l: stats.avg_displacement_l,
            engine_mix: stats.engine_mix,
          },
        },
        buildSourceMeta(await getIngestMetadata(db)),
      ),
    );
  });

  return app;
}
