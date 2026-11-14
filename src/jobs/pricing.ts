import type { AppEnv } from "../config/env.js";
import type { JobDepth, JobType } from "./types.js";

export type JobPricingEnv = Pick<
  AppEnv,
  | "PRICE_JOB_FLEET_ANALYSIS"
  | "PRICE_JOB_COMPARISON_REPORT"
  | "PRICE_JOB_TREND_INSIGHTS"
  | "PRICE_JOB_CUSTOM_EXPORT"
  | "PRICE_JOB_STARTER_KIT"
  | "JOB_DEPTH_MULTIPLIER_DEEP"
>;

const BASE_PRICE_KEY: Record<JobType, keyof JobPricingEnv> = {
  fleet_analysis: "PRICE_JOB_FLEET_ANALYSIS",
  comparison_report: "PRICE_JOB_COMPARISON_REPORT",
  trend_insights: "PRICE_JOB_TREND_INSIGHTS",
  custom_export: "PRICE_JOB_CUSTOM_EXPORT",
  starter_kit: "PRICE_JOB_STARTER_KIT",
};

export function resolveJobPriceUsd(
  env: JobPricingEnv,
  type: JobType,
  depth: JobDepth,
): number {
  const base = env[BASE_PRICE_KEY[type]];
  if (depth === "deep") {
    return Math.round(base * env.JOB_DEPTH_MULTIPLIER_DEEP * 1000) / 1000;
  }
  return base;
}

export function jobPriceTable(env: JobPricingEnv): Record<string, string> {
  return {
    "POST /v1/jobs (fleet_analysis, standard)": `$${resolveJobPriceUsd(env, "fleet_analysis", "standard")}`,
    "POST /v1/jobs (fleet_analysis, deep)": `$${resolveJobPriceUsd(env, "fleet_analysis", "deep")}`,
    "POST /v1/jobs (comparison_report, standard)": `$${resolveJobPriceUsd(env, "comparison_report", "standard")}`,
    "POST /v1/jobs (comparison_report, deep)": `$${resolveJobPriceUsd(env, "comparison_report", "deep")}`,
    "POST /v1/jobs (trend_insights, standard)": `$${resolveJobPriceUsd(env, "trend_insights", "standard")}`,
    "POST /v1/jobs (trend_insights, deep)": `$${resolveJobPriceUsd(env, "trend_insights", "deep")}`,
    "POST /v1/jobs (custom_export, standard)": `$${resolveJobPriceUsd(env, "custom_export", "standard")}`,
    "POST /v1/jobs (custom_export, deep)": `$${resolveJobPriceUsd(env, "custom_export", "deep")}`,
    "POST /v1/jobs (starter_kit, standard)": `$${resolveJobPriceUsd(env, "starter_kit", "standard")}`,
    "POST /v1/jobs (starter_kit, deep)": `$${resolveJobPriceUsd(env, "starter_kit", "deep")}`,
  };
}
