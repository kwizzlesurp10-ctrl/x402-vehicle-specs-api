import { handle } from "hono/vercel";
import { buildVercelApp } from "../src/vercel-app.js";

const app = await buildVercelApp("/api");
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;