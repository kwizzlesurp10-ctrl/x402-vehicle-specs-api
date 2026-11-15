import { handle } from "hono/vercel";
import { buildVercelApp } from "../src/vercel-app.js";
import { rewriteRequestForApiMount } from "../src/vercel-request-path.js";

const API_MOUNT = "/api";
const app = await buildVercelApp(API_MOUNT);
const vercelHandler = handle(app);

type VercelHandler = (
  request: Request,
  context?: unknown,
) => Response | Promise<Response>;

function withApiPathRewrite(handler: VercelHandler): VercelHandler {
  return (request, context) =>
    handler(rewriteRequestForApiMount(request, API_MOUNT), context);
}

const handler = withApiPathRewrite(vercelHandler);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;