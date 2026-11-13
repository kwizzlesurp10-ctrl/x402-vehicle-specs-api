import { Hono } from "hono";
import type { AppEnv } from "../config/env.js";
import { openDatabase, getIngestMetadata } from "../db/client.js";
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
import type { JobWorker } from "../jobs/worker.js";

export type CreateAppOptions = {
  env: AppEnv;
  enablePayments?: boolean;
  paymentLayer?: PaymentLayer;
  jobWorker?: JobWorker;
};

function parsePositiveInt(raw: string | undefined): Result<number, string> {
  if (raw === undefined) return err("missing");
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return err("invalid");
  return ok(n);
}

export function createApp(options: CreateAppOptions): Hono {
  const { env } = options;
  const enablePayments = options.enablePayments ?? env.NODE_ENV !== "test";

  const db = openDatabase(env.DATABASE_PATH);
  const repo = new VehicleRepository(db);
  const jobQueue = new JobQueue(db);
  const app = new Hono();

  app.get("/health", (c) => {
    const metadata = getIngestMetadata(db);
    return c.json({
      status: "ok",
      database: env.DATABASE_PATH,
      vehicles_indexed: metadata?.vehicle_row_count ?? 0,
      data_updated_at: metadata?.vehicles_retrieved_at ?? null,
    });
  });

  app.get("/openapi.json", (c) => c.json(buildOpenApiDocument(env)));
  app.get("/.well-known/x402.json", (c) => c.json(buildOpenApiDocument(env)));

  app.get("/v1/makes", (c) => {
    const yearResult = parsePositiveInt(c.req.query("year"));
    if (!yearResult.ok) {
      return c.json({ error: "year query parameter is required" }, 400);
    }
    const makes = repo.listMakes(yearResult.value);
    return c.json(
      withSource(
        { year: yearResult.value, makes, count: makes.length },
        buildSourceMeta(getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/models", (c) => {
    const yearResult = parsePositiveInt(c.req.query("year"));
    const make = c.req.query("make");
    if (!yearResult.ok || !make) {
      return c.json(
        { error: "year and make query parameters are required" },
        400,
      );
    }
    const models = repo.listModels(yearResult.value, make);
    return c.json(
      withSource(
        {
          year: yearResult.value,
          make,
          models,
          count: models.length,
        },
        buildSourceMeta(getIngestMetadata(db)),
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
    const record = jobQueue.createJob({ request: parsed.data, paymentUsd });
    void options.jobWorker?.processJobById(record.id);

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

  app.get("/v1/jobs/:id", (c) => {
    const job = jobQueue.getById(c.req.param("id"));
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

  app.get("/v1/vehicles/search", (c) => {
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

    const rows = repo.search({
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
        buildSourceMeta(getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/vehicles/:id", (c) => {
    const idResult = parsePositiveInt(c.req.param("id"));
    if (!idResult.ok) return c.json({ error: "invalid vehicle id" }, 400);
    const row = repo.getById(idResult.value);
    if (!row) return c.json({ error: "vehicle not found" }, 404);
    return c.json(
      withSource(
        { vehicle: serializeVehicle(row) },
        buildSourceMeta(getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/vehicles/:id/emissions", (c) => {
    const idResult = parsePositiveInt(c.req.param("id"));
    if (!idResult.ok) return c.json({ error: "invalid vehicle id" }, 400);
    const row = repo.getById(idResult.value);
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
        buildSourceMeta(getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/compare", (c) => {
    const idsRaw = c.req.query("ids");
    if (!idsRaw) return c.json({ error: "ids query parameter is required" }, 400);
    const ids = idsRaw
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0 || ids.length > 5) {
      return c.json({ error: "provide 1-5 comma-separated vehicle ids" }, 400);
    }
    const rows = repo.getMany(ids);
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
        buildSourceMeta(getIngestMetadata(db)),
      ),
    );
  });

  app.get("/v1/stats", (c) => {
    const yearResult = parsePositiveInt(c.req.query("year"));
    const vehicleClass = c.req.query("class");
    if (!yearResult.ok || !vehicleClass) {
      return c.json(
        { error: "year and class query parameters are required" },
        400,
      );
    }
    const stats = repo.statsByYearAndClass(yearResult.value, vehicleClass);
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
        buildSourceMeta(getIngestMetadata(db)),
      ),
    );
  });

  return app;
}
