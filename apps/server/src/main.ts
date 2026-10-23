import { serve } from "@hono/node-server";
import { createDb } from "@remedy/db";
import { createApp } from "./app.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const production = process.env.NODE_ENV === "production";
const devBearerToken = production ? undefined : process.env.DEV_BEARER_TOKEN;
if (production && process.env.DEV_BEARER_TOKEN) {
  console.warn("DEV_BEARER_TOKEN is ignored in production");
}

const { db, close } = createDb(databaseUrl);
const app = createApp({ db, devBearerToken });
const port = Number(process.env.PORT ?? 8787);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Remedy Kit server on http://localhost:${info.port}`);
  console.log(`MCP endpoint: http://localhost:${info.port}/mcp${devBearerToken ? " (dev bearer token)" : ""}`);
});

async function shutdown() {
  server.close();
  await close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
