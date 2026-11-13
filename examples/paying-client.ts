/**
 * Example x402 buyer using @x402/fetch (v2).
 *
 * Requires:
 *   npm install @x402/fetch @x402/evm @x402/core viem
 *   EVM_PRIVATE_KEY and API_BASE_URL in environment
 */
import { config as loadDotenv } from "dotenv";

loadDotenv();

const apiBase = process.env.API_BASE_URL ?? "http://127.0.0.1:8787";

async function main(): Promise<void> {
  const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm/exact/client");
  const { privateKeyToAccount } = await import("viem/accounts");

  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Set EVM_PRIVATE_KEY for the paying client example");
  }

  const signer = privateKeyToAccount(privateKey as `0x${string}`);
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(signer));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const response = await fetchWithPayment(
    `${apiBase}/v1/vehicles/search?year=2009&make=Volkswagen&model=Jetta`,
  );

  console.log("status", response.status);
  console.log(await response.text());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
