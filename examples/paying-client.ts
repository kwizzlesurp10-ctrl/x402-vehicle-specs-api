/**
 * Example x402 buyer using @x402/fetch (v2) for raw lookups and swarm jobs.
 *
 * Requires optional deps:
 *   npm install @x402/fetch @x402/evm @x402/core viem
 */
import { config as loadDotenv } from "dotenv";

loadDotenv();

const apiBase = process.env.API_BASE_URL ?? "http://127.0.0.1:8787";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const search = await fetchWithPayment(
    `${apiBase}/v1/vehicles/search?year=2009&make=Volkswagen&model=Jetta`,
  );
  console.log("search", search.status);
  console.log(await search.text());

  const jobCreate = await fetchWithPayment(`${apiBase}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "trend_insights",
      depth: "standard",
      input: { year_start: 2005, year_end: 2012, vehicle_class: "Compact Cars" },
    }),
  });
  console.log("job create", jobCreate.status);
  const created = (await jobCreate.json()) as { job_id: string; poll_url: string };
  console.log("job", created);

  for (let i = 0; i < 30; i += 1) {
    const poll = await fetch(`${apiBase}${created.poll_url}`);
    const job = (await poll.json()) as { status: string };
    console.log("poll", job.status);
    if (["completed", "partial", "failed", "timed_out"].includes(job.status)) {
      console.log(await poll.text());
      break;
    }
    await sleep(1000);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
