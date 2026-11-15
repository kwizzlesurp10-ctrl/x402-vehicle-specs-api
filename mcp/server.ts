import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createApp } from "../src/api/app.js";
import { loadEnv } from "../src/config/env.js";
import { createDbExecutor } from "../src/db/client.js";

const remoteApiBase = process.env.API_BASE_URL?.replace(/\/$/, "");

const env = loadEnv(
  process.env.PAY_TO_ADDRESS
    ? { PAY_TO_ADDRESS: process.env.PAY_TO_ADDRESS }
    : {
        PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001",
        LLM_PROVIDER: "mock",
      },
);

const localApp = remoteApiBase
  ? null
  : await (async () => {
      const db = await createDbExecutor(env);
      return createApp({ db, env, enablePayments: false });
    })();

async function requestApi(pathWithQuery: string): Promise<Response> {
  if (remoteApiBase) {
    return fetch(`${remoteApiBase}${pathWithQuery}`);
  }
  if (!localApp) {
    throw new Error("MCP server is not configured (set API_BASE_URL or local DB)");
  }
  return localApp.request(pathWithQuery);
}

const tools = [
  {
    name: "vehicle_search",
    description: remoteApiBase
      ? `Search EPA vehicles via ${remoteApiBase} (x402 paid on production; MCP does not settle).`
      : "Search EPA vehicles (MCP wrapper; no x402 settlement).",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "integer" },
        make: { type: "string" },
        model: { type: "string" },
      },
    },
  },
  {
    name: "vehicle_get",
    description: remoteApiBase
      ? `Get vehicle specs by EPA id from ${remoteApiBase}`
      : "Get full vehicle specs by EPA id",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "integer" } },
    },
  },
] as const;

async function main(): Promise<void> {
  const server = new Server(
    { name: "x402-vehicle-specs", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "vehicle_search") {
      const year = args?.year as number | undefined;
      const make = args?.make as string | undefined;
      const model = args?.model as string | undefined;
      const qs = new URLSearchParams();
      if (year) qs.set("year", String(year));
      if (make) qs.set("make", make);
      if (model) qs.set("model", model);
      const res = await requestApi(`/v1/vehicles/search?${qs.toString()}`);
      return {
        content: [{ type: "text", text: await res.text() }],
      };
    }
    if (name === "vehicle_get") {
      const id = args?.id as number;
      const res = await requestApi(`/v1/vehicles/${id}`);
      return {
        content: [{ type: "text", text: await res.text() }],
      };
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});