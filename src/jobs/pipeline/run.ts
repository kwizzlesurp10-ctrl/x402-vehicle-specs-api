import type { AppEnv } from "../../config/env.js";
import { buildSourceMeta } from "../../api/serializers.js";
import { getIngestMetadata } from "../../db/client.js";
import type { DbExecutor } from "../../db/executor.js";
import { queryOne, queryRows } from "../../db/sql-helpers.js";
import { SOURCE_NAME, type SourceMeta } from "../../lib/attribution.js";
import type { LlmClient } from "../llm/client.js";
import type { JobSubmitRequest } from "../types.js";
import { decodeVin } from "../vin/nhtsa.js";
import { verifyVehicleFacts } from "./verifier.js";

export type PipelineResult = {
  status: "completed" | "partial" | "failed";
  refund_eligible: boolean;
  verifier_passed: boolean;
  data: Record<string, unknown>;
  reporter: {
    short_answer: string;
    confidence: "high" | "medium" | "low";
    gaps: string[];
  };
  source_meta: SourceMeta;
  error?: string;
};

function annualFuelGallons(combinedMpg: number | null, miles: number): number | null {
  if (!combinedMpg || combinedMpg <= 0) return null;
  return miles / combinedMpg;
}

function annualFuelCost(gallons: number | null, price: number): number | null {
  if (gallons === null) return null;
  return Math.round(gallons * price * 100) / 100;
}

type FoundVehicleRow = {
  id: number;
  combined_mpg: number | null;
  co2_g_per_mi: number | null;
  co2_tailpipe_g_per_mi: number | null;
  year: number;
  make: string;
  model: string;
};

export async function runSwarmPipeline(params: {
  db: DbExecutor;
  env: AppEnv;
  request: JobSubmitRequest;
  llm: LlmClient;
  forceVerifierFail?: boolean | undefined;
}): Promise<PipelineResult> {
  const sourceMeta = buildSourceMeta(await getIngestMetadata(params.db));

  const orchestrator = await params.llm.complete(
    [
      {
        role: "system",
        content:
          "You are the Orchestrator agent. Return JSON with plan steps only. orchestrator",
      },
      {
        role: "user",
        content: `orchestrator job type=${params.request.type} depth=${params.request.depth}`,
      },
    ],
    256,
  );

  if (!orchestrator.ok) {
    return {
      status: "failed",
      refund_eligible: true,
      verifier_passed: false,
      data: {},
      reporter: {
        short_answer: "Job failed during orchestration.",
        confidence: "low",
        gaps: [orchestrator.error],
      },
      source_meta: sourceMeta,
      error: orchestrator.error,
    };
  }

  const data: Record<string, unknown> = {
    orchestrator_plan: JSON.parse(orchestrator.value),
    agent_pipeline: ["normalizer", "analyst", "verifier", "reporter"],
  };

  try {
    switch (params.request.type) {
      case "fleet_analysis": {
        const fuelPrice =
          params.request.input.fuel_price_per_gallon ??
          params.env.DEFAULT_FUEL_PRICE_PER_GALLON;
        const defaultMiles = params.env.DEFAULT_ANNUAL_MILES;
        const entries: Array<Record<string, unknown>> = [];

        for (const ref of params.request.input.vehicles ?? []) {
          const year = ref.year;
          const make = ref.make;
          const model = ref.model;
          const miles = ref.annual_miles ?? defaultMiles;

          const found = ref.vehicle_id
            ? await queryOne<FoundVehicleRow>(
                params.db,
                `SELECT id, combined_mpg, co2_g_per_mi, co2_tailpipe_g_per_mi, year, make, model
                   FROM vehicles WHERE id = ?`,
                [ref.vehicle_id],
              )
            : await queryOne<FoundVehicleRow>(
                params.db,
                `SELECT id, combined_mpg, co2_g_per_mi, co2_tailpipe_g_per_mi, year, make, model
                   FROM vehicles
                   WHERE year = ? AND search_make = ? AND search_model LIKE ?
                   ORDER BY combined_mpg DESC LIMIT 1`,
                [year, make.toLowerCase(), `%${model.toLowerCase()}%`],
              );

          const gallons = annualFuelGallons(found?.combined_mpg ?? null, miles);
          entries.push({
            scope: found
              ? {
                  vehicle_id: found.id,
                  year: found.year,
                  make: found.make,
                  model: found.model,
                }
              : { year, make, model, vehicle_id: null },
            mpg: { combined: found?.combined_mpg ?? null },
            emissions: {
              co2_g_per_mi:
                found?.co2_g_per_mi ?? found?.co2_tailpipe_g_per_mi ?? null,
            },
            annual_miles: miles,
            annual_fuel_gallons: gallons,
            annual_fuel_cost_usd: annualFuelCost(gallons, fuelPrice),
          });
        }

        for (const vin of params.request.input.vins ?? []) {
          const decoded = await decodeVin(vin);
          if (!decoded.ok) {
            entries.push({ vin, decode_error: decoded.error });
            continue;
          }
          const d = decoded.value;
          if (!d.year || !d.make || !d.model) {
            entries.push({ vin, decode: d, note: "incomplete_vin_decode" });
            continue;
          }
          const found = await queryOne<FoundVehicleRow>(
            params.db,
            `SELECT id, combined_mpg, co2_g_per_mi, co2_tailpipe_g_per_mi, year, make, model
               FROM vehicles
               WHERE year = ? AND search_make = ? AND search_model LIKE ?
               ORDER BY combined_mpg DESC LIMIT 1`,
            [d.year, d.make.toLowerCase(), `%${d.model.toLowerCase()}%`],
          );

          const miles = defaultMiles;
          const gallons = annualFuelGallons(found?.combined_mpg ?? null, miles);
          entries.push({
            vin,
            decode: { year: d.year, make: d.make, model: d.model },
            scope: found
              ? {
                  vehicle_id: found.id,
                  year: found.year,
                  make: found.make,
                  model: found.model,
                }
              : null,
            mpg: { combined: found?.combined_mpg ?? null },
            emissions: {
              co2_g_per_mi:
                found?.co2_g_per_mi ?? found?.co2_tailpipe_g_per_mi ?? null,
            },
            annual_miles: miles,
            annual_fuel_gallons: gallons,
            annual_fuel_cost_usd: annualFuelCost(gallons, fuelPrice),
            replacement_suggestions: found
              ? await queryRows<{
                  id: number;
                  year: number;
                  make: string;
                  model: string;
                  combined_mpg: number | null;
                }>(
                  params.db,
                  `SELECT id, year, make, model, combined_mpg
                     FROM vehicles
                     WHERE v_class = (SELECT v_class FROM vehicles WHERE id = ?)
                       AND year >= ?
                       AND combined_mpg > ?
                     ORDER BY combined_mpg DESC LIMIT 3`,
                  [found.id, found.year, found.combined_mpg ?? 0],
                )
              : [],
          });
        }

        data.fleet_entries = entries;
        break;
      }
      case "comparison_report": {
        let filter = { ...params.request.input };
        if (params.request.input.query) {
          const parsed = await params.llm.complete(
            [
              {
                role: "system",
                content:
                  "Parse comparison filter as JSON with vehicle_class, year_min, year_max, min_displacement_l, max_displacement_l. comparison filter",
              },
              { role: "user", content: params.request.input.query },
            ],
            200,
          );
          if (parsed.ok) {
            const llmFilter = JSON.parse(parsed.value) as Record<string, unknown>;
            filter = { ...filter, ...llmFilter };
          }
        }

        const clauses: string[] = ["combined_mpg IS NOT NULL"];
        const args: Array<string | number> = [];

        if (filter.year_min !== undefined) {
          clauses.push("year >= ?");
          args.push(filter.year_min);
        }
        if (filter.year_max !== undefined) {
          clauses.push("year <= ?");
          args.push(filter.year_max);
        }
        if (filter.vehicle_class) {
          clauses.push("v_class = ?");
          args.push(filter.vehicle_class);
        }
        if (filter.min_displacement_l !== undefined) {
          clauses.push("displ >= ?");
          args.push(filter.min_displacement_l);
        }
        if (filter.max_displacement_l !== undefined) {
          clauses.push("displ <= ?");
          args.push(filter.max_displacement_l);
        }

        const sql = `SELECT id, year, make, model, combined_mpg, displ, v_class, fuel_type1
          FROM vehicles WHERE ${clauses.join(" AND ")}
          ORDER BY combined_mpg DESC LIMIT ?`;
        args.push(filter.limit ?? 10);

        data.comparison = {
          filter,
          ranked: await queryRows<Record<string, unknown>>(params.db, sql, args),
        };
        break;
      }
      case "trend_insights": {
        const { year_start, year_end } = params.request.input;
        const yearClause = params.request.input.vehicle_class
          ? "AND v_class = ?"
          : "";
        const args: Array<string | number> = [year_start, year_end];
        if (params.request.input.vehicle_class) {
          args.push(params.request.input.vehicle_class);
        }

        const mpgTrend = await queryRows<Record<string, unknown>>(
          params.db,
          `SELECT year,
              AVG(combined_mpg) AS avg_combined_mpg,
              AVG(displ) AS avg_displacement_l,
              COUNT(*)::int AS n
             FROM vehicles
             WHERE year BETWEEN ? AND ? ${yearClause}
               AND combined_mpg IS NOT NULL
             GROUP BY year
             ORDER BY year`,
          args,
        );

        const fuelMix = await queryRows<Record<string, unknown>>(
          params.db,
          `SELECT fuel_type1, COUNT(*)::int AS n
             FROM vehicles
             WHERE year BETWEEN ? AND ? ${yearClause}
             GROUP BY fuel_type1
             ORDER BY n DESC
             LIMIT 12`,
          args,
        );

        const transMix = await queryRows<Record<string, unknown>>(
          params.db,
          `SELECT trany, COUNT(*)::int AS n
             FROM vehicles
             WHERE year BETWEEN ? AND ? ${yearClause}
             GROUP BY trany
             ORDER BY n DESC
             LIMIT 12`,
          args,
        );

        data.trends = { mpg_by_year: mpgTrend, fuel_type_mix: fuelMix, transmission_mix: transMix };
        break;
      }
      case "custom_export": {
        const input = params.request.input;
        const clauses: string[] = [];
        const args: Array<string | number> = [];
        if (input.year !== undefined) {
          clauses.push("year = ?");
          args.push(input.year);
        }
        if (input.make) {
          clauses.push("search_make = ?");
          args.push(input.make.toLowerCase());
        }
        if (input.model) {
          clauses.push("search_model LIKE ?");
          args.push(`%${input.model.toLowerCase()}%`);
        }
        if (input.vehicle_class) {
          clauses.push("v_class = ?");
          args.push(input.vehicle_class);
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const rows = await queryRows<Record<string, unknown>>(
          params.db,
          `SELECT id, year, make, model, v_class, combined_mpg, displ, cylinders,
                    drive, trany, fuel_type1, co2_g_per_mi, co2_tailpipe_g_per_mi
             FROM vehicles ${where}
             ORDER BY year DESC, make, model
             LIMIT ?`,
          [...args, input.limit],
        );

        if (input.format === "csv") {
          const header = Object.keys(
            (rows[0] as Record<string, unknown> | undefined) ?? {
              id: 0,
              year: 0,
              make: "",
            },
          );
          const lines = [
            header.join(","),
            ...rows.map((row) =>
              header
                .map((key) => JSON.stringify((row as Record<string, unknown>)[key] ?? ""))
                .join(","),
            ),
          ];
          data.export = { format: "csv", content: lines.join("\n"), row_count: rows.length };
        } else {
          data.export = { format: "json", rows, row_count: rows.length };
        }
        break;
      }
      case "starter_kit": {
        const lang = params.request.input?.language ?? "typescript";
        data.starter_kit = {
          language: lang,
          openapi: "/openapi.json",
          sample_paid_search: "GET /v1/vehicles/search?year=2009&make=Volkswagen&model=Jetta",
          sample_job: "POST /v1/jobs",
          postgres_note:
            "Primary store is Supabase Postgres (DATABASE_URL pooled). Jobs claimed with FOR UPDATE SKIP LOCKED.",
          schema_url: "prompts/schemas/",
        };
        break;
      }
      default: {
        const _exhaustive: never = params.request;
        throw new Error(`Unhandled job type: ${String(_exhaustive)}`);
      }
    }
  } catch (error) {
    return {
      status: "failed",
      refund_eligible: true,
      verifier_passed: false,
      data,
      reporter: {
        short_answer: "Pipeline failed while querying EPA data.",
        confidence: "low",
        gaps: [error instanceof Error ? error.message : "unknown_error"],
      },
      source_meta: sourceMeta,
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }

  const claims: Array<{
    vehicle_id: number;
    combined_mpg?: number | null;
    co2_g_per_mi?: number | null;
  }> = [];

  if (Array.isArray(data.fleet_entries)) {
    for (const entry of data.fleet_entries as Array<Record<string, unknown>>) {
      const scope = entry.scope as { vehicle_id?: number } | null | undefined;
      if (scope?.vehicle_id) {
        const mpg = entry.mpg as { combined?: number | null } | undefined;
        const emissions = entry.emissions as { co2_g_per_mi?: number | null } | undefined;
        claims.push({
          vehicle_id: scope.vehicle_id,
          combined_mpg: mpg?.combined ?? null,
          co2_g_per_mi: emissions?.co2_g_per_mi ?? null,
        });
      }
    }
  }

  if (params.forceVerifierFail && claims.length > 0) {
    const first = claims[0];
    if (first) {
      claims[0] = {
        vehicle_id: first.vehicle_id,
        combined_mpg: -1,
        ...(first.co2_g_per_mi !== undefined ? { co2_g_per_mi: first.co2_g_per_mi } : {}),
      };
    }
  }

  const verifier =
    claims.length > 0
      ? await verifyVehicleFacts(params.db, claims)
      : { verified: true, fields: [] as [] };

  data.verifier = verifier;

  const reporter = await params.llm.complete(
    [
      {
        role: "system",
        content: `Reporter agent for ${SOURCE_NAME}. Write a short shop-facing summary. Do not invent numbers.`,
      },
      { role: "user", content: JSON.stringify({ type: params.request.type, highlights: data }) },
    ],
    400,
  );

  const shortAnswer = reporter.ok
    ? reporter.value
    : "Verified EPA data is attached; narrative generation was unavailable.";

  const status = verifier.verified ? "completed" : "partial";
  const refundEligible = !verifier.verified;

  return {
    status,
    refund_eligible: refundEligible,
    verifier_passed: verifier.verified,
    data,
    reporter: {
      short_answer: shortAnswer,
      confidence: verifier.verified ? "high" : "medium",
      gaps: verifier.verified
        ? []
        : verifier.fields.filter((f) => !f.ok).map((f) => `unverified:${f.field}`),
    },
    source_meta: sourceMeta,
    ...(refundEligible
      ? {
          error:
            "Verifier could not reproduce all numeric fields. Result is partial; refund_eligible=true (manual on-chain refund hook).",
        }
      : {}),
  };
}
