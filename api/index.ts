import { handle } from "hono/vercel";
import { buildVercelApp } from "../src/vercel-app.js";

const app = await buildVercelApp("/api");
export default handle(app);
