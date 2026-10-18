import type { Db } from "@remedy/db";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { createMcpServer } from "./mcp.ts";

export interface AppConfig {
  db: Db;
  /**
   * Stage 0 only: a fixed token mapped to the dev user, so MCP can be tried
   * before OAuth exists. Must be unset in production.
   */
  devBearerToken?: string;
  devUserId?: string;
}

export const DEV_USER_ID = "dev-user";

/** Resolves the caller from the Authorization header. Replaced by OAuth (Better Auth) in the next step. */
function authenticate(config: AppConfig, header: string | undefined): string | null {
  if (!config.devBearerToken || !header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length) === config.devBearerToken ? (config.devUserId ?? DEV_USER_ID) : null;
}

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.all("/mcp", async (c) => {
    const userId = authenticate(config, c.req.header("authorization"));
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="remedy-kit"' });
    }

    // Stateless: a fresh server and transport per request, so any instance can serve any request.
    const server = createMcpServer({ db: config.db, userId, actor: { kind: "agent" } });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // The JSON response is fully built at this point.
      void server.close();
    }
  });

  return app;
}
