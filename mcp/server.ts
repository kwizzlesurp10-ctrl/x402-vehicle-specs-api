import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createApp } from "../src/api/app.js";
import { loadEnv } from "../src/config/env.js";

const env = loadEnv(
  process.env.PAY_TO_ADDRESS
    ? { PAY_TO_ADDRESS: process.env.PAY_TO_ADDRESS }
    : { PAY_TO_ADDRESS: "0x0000000000000000000000000000000000000001" },
);
const app = createApp({ env, enablePayments: false });

const tools = [
  {
    name: "vehicle_search",
    description:
      "Search EPA vehicles (paid at the API layer; MCP wrapper returns data without settlement in local dev).",
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
    description: "Get full vehicle specs by EPA id",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "integer" } },
    },
  },
] as const;

async function main(): Promise<void> {
  const server = new Server(
    { name: "x402-vehicle-specs", version: "0.1.0" },
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
      const res = await app.request(`/v1/vehicles/search?${qs.toString()}`);
      return {
        content: [{ type: "text", text: await res.text() }],
      };
    }
    if (name === "vehicle_get") {
      const id = args?.id as number;
      const res = await app.request(`/v1/vehicles/${id}`);
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
