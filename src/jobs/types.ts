import { z } from "zod";

export const jobTypeSchema = z.enum([
  "fleet_analysis",
  "comparison_report",
  "trend_insights",
  "custom_export",
  "starter_kit",
]);

export type JobType = z.infer<typeof jobTypeSchema>;

export const jobDepthSchema = z.enum(["standard", "deep"]);
export type JobDepth = z.infer<typeof jobDepthSchema>;

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "timed_out",
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;

const vehicleRefSchema = z.object({
  year: z.number().int().min(1984).max(2035),
  make: z.string().min(1),
  model: z.string().min(1),
  annual_miles: z.number().positive().optional(),
  vehicle_id: z.number().int().positive().optional(),
});

const fleetInputSchema = z.object({
  vins: z.array(z.string().min(11).max(17)).optional(),
  vehicles: z.array(vehicleRefSchema).optional(),
  fuel_price_per_gallon: z.number().positive().optional(),
});

const comparisonInputSchema = z.object({
  query: z.string().min(3),
  year_min: z.number().int().optional(),
  year_max: z.number().int().optional(),
  vehicle_class: z.string().optional(),
  min_displacement_l: z.number().positive().optional(),
  max_displacement_l: z.number().positive().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const trendInputSchema = z.object({
  year_start: z.number().int().min(1984),
  year_end: z.number().int().min(1984),
  vehicle_class: z.string().optional(),
});

const customExportInputSchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  year: z.number().int().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  vehicle_class: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

const starterKitInputSchema = z.object({
  language: z.enum(["typescript", "python", "curl"]).default("typescript"),
});

export const jobSubmitSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fleet_analysis"),
    depth: jobDepthSchema.default("standard"),
    webhook_url: z.string().url().optional(),
    input: fleetInputSchema,
  }),
  z.object({
    type: z.literal("comparison_report"),
    depth: jobDepthSchema.default("standard"),
    webhook_url: z.string().url().optional(),
    input: comparisonInputSchema,
  }),
  z.object({
    type: z.literal("trend_insights"),
    depth: jobDepthSchema.default("standard"),
    webhook_url: z.string().url().optional(),
    input: trendInputSchema,
  }),
  z.object({
    type: z.literal("custom_export"),
    depth: jobDepthSchema.default("standard"),
    webhook_url: z.string().url().optional(),
    input: customExportInputSchema,
  }),
  z.object({
    type: z.literal("starter_kit"),
    depth: jobDepthSchema.default("standard"),
    webhook_url: z.string().url().optional(),
    input: starterKitInputSchema.optional().default({ language: "typescript" }),
  }),
]);

export type JobSubmitRequest = z.infer<typeof jobSubmitSchema>;

export type JobRecord = {
  id: string;
  type: JobType;
  depth: JobDepth;
  status: JobStatus;
  input_json: string;
  result_json: string | null;
  error_message: string | null;
  webhook_url: string | null;
  payment_usd: number;
  refund_eligible: number;
  verifier_passed: number | null;
  tokens_used: number;
  attempt_count: number;
  max_attempts: number;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};
