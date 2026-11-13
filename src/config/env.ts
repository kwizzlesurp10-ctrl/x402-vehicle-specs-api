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
  DATABASE_PATH: z.string().default("./data/vehicles.db"),
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
