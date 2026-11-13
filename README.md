# x402 Vehicle Specs API

Pay-per-call [x402](https://docs.x402.org/) API (USDC on Base) serving **EPA [FuelEconomy.gov](https://fueleconomy.gov/)** vehicle records from **1984–present**. Built for auto shops, technicians, and agent tools that need reproducible MPG, engine, drivetrain, transmission, fuel, and emissions fields.

## Features

- Bulk ingest from EPA `vehicles.csv.zip` + `emissions.csv.zip` into SQLite for fast lookups
- x402 v2 middleware via `@x402/hono` (default **Base Sepolia** testnet)
- Free discovery/menu routes + OpenAPI/x402 price manifest
- Agent swarm prompts under [`prompts/`](prompts/)
- Optional MCP stdio wrapper (`npm run mcp`)

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

## Quick start

```bash
cp .env.example .env
# Set PAY_TO_ADDRESS to your Base / Base-Sepolia USDC receive address

npm ci
npm run ingest        # downloads EPA zips (~50k vehicles) -> ./data/vehicles.db
npm run dev           # http://0.0.0.0:8787
npm test
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
| `PAY_TO_ADDRESS` | **Required.** EVM address receiving USDC |
| `X402_NETWORK` | `base-sepolia` (default) or `base` |
| `FACILITATOR_URL` | x402 facilitator (default `https://x402.org/facilitator`) |
| `DATABASE_PATH` | SQLite path (default `./data/vehicles.db`) |
| `PRICE_*` | Per-route USD amounts |
| `EPA_*_ZIP_URL` | Override EPA bulk URLs if needed |

## Agent swarm prompts

Per-agent instructions + JSON Schema I/O live in:

- [`prompts/`](prompts/) — Orchestrator, Scout, Fetcher, Normalizer, Analyst, Verifier, Reporter
- [`prompts/schemas/`](prompts/schemas/) — input/output schemas
- [`prompts/source-registry.json`](prompts/source-registry.json) — Scout registry seed

## Deploy notes

### Render

[`render.yaml`](render.yaml) runs the API with a persistent disk for SQLite. Run ingest on deploy or as a cron job:

```bash
npm run ingest
```

Bind is already `0.0.0.0:$PORT` via `@hono/node-server`.

### Vercel

Use Vercel for static docs only; this service needs long-lived SQLite + scheduled ingest—**Render (or similar) is recommended**.

## Development

```bash
npm run lint
npm test
npm run mcp
```

Tests cover EPA normalization/ingest and HTTP behavior (402 without payment; happy path with payments disabled for mocked settlement).

## License

Code: MIT. Vehicle data © EPA / FuelEconomy.gov — cite the agency and retrieval date in derivatives.
