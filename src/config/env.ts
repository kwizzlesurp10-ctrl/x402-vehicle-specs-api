import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const networkSchema = z.enum(["base-sepolia", "base"]);
type X402NetworkName = z.infer<typeof networkSchema>;

export type Caip2Network = `eip155:${number}`;

export const CAIP2_BY_NETWORK: Record<X402NetworkName, Caip2Network> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_BASE_PATH: z.string().default(""),
  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),
  CRON_SECRET: z.string().optional(),
  PAY_TO_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "PAY_TO_ADDRESS must be a valid EVM address"),
  X402_NETWORK: networkSchema.default("base-sepolia"),
  FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  PRICE_SEARCH: z.coerce.number().positive().default(0.001),
  PRICE_VEHICLE: z.coerce.number().positive().default(0.002),
  PRICE_EMISSIONS: z.coerce.number().positive().default(0.002),
  PRICE_COMPARE: z.coerce.number().positive().default(0.005),
  PRICE_STATS: z.coerce.number().positive().default(0.01),
  EPA_VEHICLES_ZIP_URL: z
    .string()
    .url()
    .default("https://fueleconomy.gov/feg/epadata/vehicles.csv.zip"),
  EPA_EMISSIONS_ZIP_URL: z
    .string()
    .url()
    .default("https://fueleconomy.gov/feg/epadata/emissions.csv.zip"),
  PRICE_JOB_FLEET_ANALYSIS: z.coerce.number().positive().default(0.75),
  PRICE_JOB_COMPARISON_REPORT: z.coerce.number().positive().default(0.5),
  PRICE_JOB_TREND_INSIGHTS: z.coerce.number().positive().default(0.35),
  PRICE_JOB_CUSTOM_EXPORT: z.coerce.number().positive().default(0.4),
  PRICE_JOB_STARTER_KIT: z.coerce.number().positive().default(0.25),
  JOB_DEPTH_MULTIPLIER_DEEP: z.coerce.number().positive().default(2),
  JOB_MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOB_RUN_LEASE_MS: z.coerce.number().int().positive().default(180_000),
  JOB_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(60_000),
  JOB_CRON_TIME_BUDGET_MS: z.coerce.number().int().positive().default(240_000),
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  JOB_MAX_TOKENS: z.coerce.number().int().positive().default(8_000),
  VERCEL_MAX_DURATION_MS: z.coerce.number().int().positive().optional(),
  LLM_PROVIDER: z.enum(["mock", "openai", "xai"]).default("xai"),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().default("https://api.x.ai/v1"),
  LLM_MODEL: z.string().default("grok-3-mini"),
  DEFAULT_FUEL_PRICE_PER_GALLON: z.coerce.number().positive().default(3.5),
  DEFAULT_ANNUAL_MILES: z.coerce.number().positive().default(12_000),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(overrides?: Partial<AppEnv>): AppEnv {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function formatUsdPrice(amount: number): string {
  return `$${amount}`;
}
