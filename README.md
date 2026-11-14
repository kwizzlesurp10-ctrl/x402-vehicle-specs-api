# x402 Vehicle Specs API

Pay-per-call [x402](https://docs.x402.org/) API (USDC on Base) serving **EPA [FuelEconomy.gov](https://fueleconomy.gov/)** vehicle records from **1984–present**. Built for auto shops, technicians, and agent tools that need reproducible MPG, engine, drivetrain, transmission, fuel, and emissions fields.

## Features

- Bulk ingest from EPA `vehicles.csv.zip` + `emissions.csv.zip` into **Postgres** (Supabase) with batched upserts
- x402 v2 middleware via `@x402/hono` (default **Base Sepolia** testnet)
- **Cheap paid lookups** (search/id/emissions/compare/stats)
- **Higher-tier paid swarm jobs** (`POST /v1/jobs`) orchestrate `/prompts` agents over Postgres (Verifier-gated numbers)
- Free discovery/menu routes + OpenAPI/x402 price manifest
- Agent swarm prompts under [`prompts/`](prompts/)
- Optional MCP stdio wrapper (`npm run mcp`)
- **Deploy primary:** [Vercel](https://vercel.com) serverless + [Supabase](https://supabase.com) Postgres

## Data source & attribution

| Resource | URL |
| --- | --- |
| Vehicles bulk CSV (zipped) | https://fueleconomy.gov/feg/epadata/vehicles.csv.zip |
| Emissions bulk CSV (zipped) | https://fueleconomy.gov/feg/epadata/emissions.csv.zip |
| REST (spot checks) | https://fueleconomy.gov/ws/rest/vehicle/{id} |

Every JSON response includes `meta.source`, `meta.source_urls`, and `meta.updated_at` from the last ingest. Missing EPA values are returned as `null` with `missing_fields_notes` (no fabricated numbers).

## Pricing (configurable)

| Endpoint | Default price | Payment |
| --- | --- | --- |
| `GET /v1/vehicles/search` | $0.001 | x402 |
| `GET /v1/vehicles/:id` | $0.002 | x402 |
| `GET /v1/vehicles/:id/emissions` | $0.002 | x402 |
| `GET /v1/compare?ids=` | $0.005 | x402 |
| `GET /v1/stats?year&class` | $0.01 | x402 |
| `GET /health` | free | — |
| `GET /v1/makes?year` | free | — |
| `GET /v1/models?year&make` | free | — |
| `GET /openapi.json`, `GET /.well-known/x402.json` | free | — |

Set `PRICE_*` and `PAY_TO_ADDRESS` in `.env` (see `.env.example`).

### Swarm job pricing (configurable)

| Job type | Default (standard) | Deep (`JOB_DEPTH_MULTIPLIER_DEEP`) |
| --- | --- | --- |
| `fleet_analysis` | $0.75 | 2× |
| `comparison_report` | $0.50 | 2× |
| `trend_insights` | $0.35 | 2× |
| `custom_export` | $0.40 | 2× |
| `starter_kit` | $0.25 | 2× |

`POST /v1/jobs` is x402-paid (tier resolved from JSON `type` + `depth`). `GET /v1/jobs/:id` is **free** for polling. Optional `webhook_url` receives the completed payload.

**Refund policy:** if the Verifier cannot reproduce numeric fields, the job finishes as `partial` with `refund_eligible=true` (manual USDC refund hook; on-chain automation TBD). `failed` / `timed_out` jobs may also set `refund_eligible`.

**Safeguards:** `JOB_MAX_TOKENS`, `JOB_TIMEOUT_MS` (capped by `VERCEL_MAX_DURATION_MS` on Vercel), `JOB_MAX_CONCURRENCY`. SQL computes aggregates; the LLM only plans/parses filters and writes prose.

**Default LLM:** xAI Grok via OpenAI-compatible API (`LLM_PROVIDER=xai`, `LLM_BASE_URL=https://api.x.ai/v1`, `LLM_MODEL=grok-3-mini`, `LLM_API_KEY`). Tests use `LLM_PROVIDER=mock`.

**Flywheel:** anonymized job fingerprints land in `job_flywheel`. Run `npm run flywheel` for Scout/demand signals and cheap-endpoint candidates.

## Quick start (local)

```bash
cp .env.example .env
# Supabase: set DATABASE_URL (pooler :6543) and DIRECT_URL (:5432) for migrations/ingest
# Set PAY_TO_ADDRESS to your Base / Base-Sepolia USDC receive address

npm ci
npm run migrate       # apply migrations/001_init.sql via DIRECT_URL
npm run ingest        # downloads EPA zips (~50k vehicles) into Postgres
npm run dev           # http://0.0.0.0:8787 (no /api prefix locally)
npm test              # PGlite in-memory Postgres
```

### x402 flow (buyer)

1. `GET /openapi.json` to read `x-x402.pricing` and network (`eip155:84532` on testnet).
2. Call a paid route without payment → **402 Payment Required** with x402 instructions.
3. Sign USDC payment (exact scheme) and retry with the v2 `PAYMENT-SIGNATURE` header.
4. Facilitator verifies/settles against `FACILITATOR_URL`.

Example client: [`examples/paying-client.ts`](examples/paying-client.ts) (requires optional `@x402/fetch`, `@x402/evm`, `viem`).

```bash
npm install @x402/fetch @x402/evm viem
export EVM_PRIVATE_KEY=0x...
export API_BASE_URL=http://127.0.0.1:8787
npm run client:example
```

## Swarm job flow

```bash
# 1) Pay + enqueue (402 without wallet)
curl -i -X POST http://127.0.0.1:8787/v1/jobs \
  -H 'Content-Type: application/json' \
  -d '{"type":"starter_kit","depth":"standard","input":{"language":"typescript"}}'

# 2) Poll (free)
curl http://127.0.0.1:8787/v1/jobs/<job_id>
```

Job input/output JSON schemas: [`prompts/schemas/jobs/`](prompts/schemas/jobs/).

**Serverless workers:** there is no long-lived worker process. On Vercel, `POST /v1/jobs` enqueues in Postgres and uses `waitUntil` to run the job in the same invocation when possible; `/api/cron/jobs` (every 2 minutes) claims queued rows with `FOR UPDATE SKIP LOCKED`.

## Deploy: Vercel + Supabase (recommended)

1. Create or reuse a Supabase project and copy **connection strings**:
   - **DATABASE_URL** — Transaction pooler (port **6543**, `?pgbouncer=true`) for the Vercel function
   - **DIRECT_URL** — Session/direct (port **5432**) for `npm run migrate` and `npm run ingest`
   - If the project is **shared** with other apps, run `npm run migrate` so `002_enable_rls.sql` turns on **Row Level Security** (no policies) on `ingest_metadata`, `vehicles`, `jobs`, and `job_flywheel`. That blocks Supabase **Data API** / PostgREST for `anon` and `authenticated`; the API server uses the **postgres** (owner) connection and is unaffected.
2. Import this repo in Vercel. API traffic goes to [`api/index.ts`](api/index.ts) (Hono via `hono/vercel`); an empty [`public/`](public/) satisfies Vercel when the project runs `npm run build`. [`vercel.json`](vercel.json) sets `outputDirectory: public`, `maxDuration: 300`, and crons:
   - `GET /api/cron/ingest` — weekly EPA refresh (Sunday 06:00 UTC)
   - `GET /api/cron/jobs` — job drain every 2 minutes
3. Set Vercel environment variables from `.env.example` (including `CRON_SECRET`, `PAY_TO_ADDRESS`, `LLM_API_KEY`).
4. Run migrations + initial ingest locally or via [`.github/workflows/ingest-weekly.yml`](.github/workflows/ingest-weekly.yml) (`workflow_dispatch` + weekly schedule using `DIRECT_URL` secret).
5. Protect cron routes: `Authorization: Bearer <CRON_SECRET>`.

Production URLs are under `/api` (e.g. `/api/health`, `/api/v1/vehicles/search`).

## Optional: Render

[`render.yaml`](render.yaml) can run the long-lived `src/server.ts` against the same Supabase `DATABASE_URL` if you prefer a always-on Node process instead of serverless.

## API examples

```bash
# Free menus (same data as EPA /ws/rest/vehicle/menu/*)
curl "http://127.0.0.1:8787/v1/makes?year=2009"
curl "http://127.0.0.1:8787/v1/models?year=2009&make=Volkswagen"

# Paid (402 without wallet)
curl -i "http://127.0.0.1:8787/v1/vehicles/25262"
```

## Environment variables

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres pooler URL (Supabase :6543) — required in production |
| `DIRECT_URL` | Direct Postgres URL for migrations/ingest (:5432) |
| `CRON_SECRET` | Bearer token for `/cron/*` on Vercel |
| `API_BASE_PATH` | `/api` on Vercel; `/` locally |
| `PAY_TO_ADDRESS` | **Required.** EVM address receiving USDC |
| `X402_NETWORK` | `base-sepolia` (default) or `base` |
| `FACILITATOR_URL` | x402 facilitator (default `https://x402.org/facilitator`) |
| `LLM_PROVIDER` | `xai` (default), `openai`, or `mock` |
| `LLM_BASE_URL` | Default `https://api.x.ai/v1` |
| `LLM_MODEL` | Default `grok-3-mini` |
| `LLM_API_KEY` | API key for xAI/OpenAI |
| `PRICE_*` | Per-route USD amounts |
| `EPA_*_ZIP_URL` | Override EPA bulk URLs if needed |

## Agent swarm prompts

Per-agent instructions + JSON Schema I/O live in:

- [`prompts/`](prompts/) — Orchestrator, Scout, Fetcher, Normalizer, Analyst, Verifier, Reporter
- [`prompts/schemas/`](prompts/schemas/) — input/output schemas
- [`prompts/source-registry.json`](prompts/source-registry.json) — Scout registry seed

## Development

```bash
npm run lint
npm test
npm run mcp
```

Tests use **PGlite** (in-memory Postgres) with `migrations/001_init.sql`. EPA normalization/ingest and HTTP behavior (402 without payment; job lifecycle with mock LLM).

## License

Code: MIT. Vehicle data © EPA / FuelEconomy.gov — cite the agency and retrieval date in derivatives.
