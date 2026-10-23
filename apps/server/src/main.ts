import { serve } from "@hono/node-server";
import { createDb } from "@remedy/db";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set (see .env.example)`);
    process.exit(1);
  }
  return value;
}

const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 8787);
const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const secret = required("BETTER_AUTH_SECRET");
if (secret.length < 32) {
  console.error("BETTER_AUTH_SECRET must be at least 32 characters");
  process.exit(1);
}
const devBearerToken = production ? undefined : process.env.DEV_BEARER_TOKEN || undefined;
if (production && process.env.DEV_BEARER_TOKEN) console.warn("DEV_BEARER_TOKEN is ignored in production");

const { db, close } = createDb(required("DATABASE_URL"));
const auth = createAuth({ db, publicUrl, secret });
const app = createApp({ db, auth, publicUrl, secret, devBearerToken });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Remedy Kit server on http://localhost:${info.port} (public URL ${publicUrl})`);
  console.log(`MCP endpoint: ${publicUrl}/mcp${devBearerToken ? " — dev bearer token enabled" : ""}`);
});

async function shutdown() {
  server.close();
  await close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
