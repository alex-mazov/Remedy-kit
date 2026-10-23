import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { requireMcpAuth } from "@better-auth/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { eq, schema, type Db } from "@remedy/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mcpResource, SCOPES, type Auth } from "./auth.ts";
import { createMcpServer } from "./mcp.ts";
import { authScript, consentPage, errorPage, signInPage } from "./web.ts";

export interface AppConfig {
  db: Db;
  auth: Auth;
  publicUrl: string;
  secret: string;
  /**
   * Local development only: a fixed token mapped to the dev user, for curl,
   * MCP Inspector and Claude Code without going through OAuth. Never set in production.
   */
  devBearerToken?: string;
}

export const DEV_USER_ID = "dev-user";

/** Runs one MCP request for one user. Stateless: a fresh server and transport per request. */
async function handleMcp(request: Request, db: Db, userId: string, scopes: Set<string>, clientId?: string): Promise<Response> {
  const server = createMcpServer({ db, userId, actor: { kind: "agent", clientId } }, { canWrite: scopes.has(SCOPES.write) });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    void server.close();
  }
}

export function createApp(config: AppConfig): Hono {
  const { db, auth, publicUrl, secret } = config;
  const app = new Hono();

  // Agents' browser-based tools (e.g. MCP Inspector) read metadata and call /mcp cross-origin.
  const agentCors = cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id"],
    exposeHeaders: ["www-authenticate", "mcp-session-id"],
  });
  app.use("/mcp", agentCors);
  app.use("/.well-known/*", agentCors);

  app.get("/health", (c) => c.json({ ok: true }));

  // Better Auth: sessions, passkeys, OAuth endpoints (/api/auth/oauth2/*), JWKS.
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Discovery documents at the root, where MCP clients look for them.
  const authServerMetadata = oauthProviderAuthServerMetadata(auth);
  const openIdMetadata = oauthProviderOpenIdConfigMetadata(auth);
  app.get("/.well-known/oauth-authorization-server/api/auth", (c) => authServerMetadata(c.req.raw));
  app.get("/.well-known/oauth-authorization-server", (c) => authServerMetadata(c.req.raw));
  app.get("/.well-known/openid-configuration/api/auth", (c) => openIdMetadata(c.req.raw));
  // The MCP plugin answers RFC 9728 protected resource metadata for these exact paths.
  app.get("/.well-known/oauth-protected-resource", (c) => auth.handler(c.req.raw));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => auth.handler(c.req.raw));

  // Sign-in and consent pages for connecting an agent.
  app.get("/assets/auth.js", async (c) => c.body(await authScript(), 200, { "content-type": "text/javascript; charset=utf-8" }));
  app.get("/sign-in", (c) => c.html(signInPage()));
  app.get("/consent", async (c) => {
    const query = new URL(c.req.url).search.slice(1);
    if (!(await verifyOAuthQueryParams(query, secret))) {
      return c.html(errorPage("Ссылка устарела. Начните подключение заново из настроек агента."), 400);
    }
    const params = new URLSearchParams(query);
    const clientId = params.get("client_id") ?? "";
    const [client] = await db
      .select({ name: schema.oauthClient.name })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, clientId));
    const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
    return c.html(consentPage(client?.name ?? "Агент", scopes));
  });

  // MCP endpoint: OAuth access tokens bound to this resource, read scope at least.
  const oauthMcp = requireMcpAuth(
    auth,
    (request, claims) => {
      const scopes = new Set(String(claims.scope ?? "").split(" ").filter(Boolean));
      const clientId = typeof claims.azp === "string" ? claims.azp : typeof claims.client_id === "string" ? claims.client_id : undefined;
      return handleMcp(request, db, String(claims.sub), scopes, clientId);
    },
    { resource: mcpResource(publicUrl), requiredScopes: [SCOPES.read], challengeScopes: [SCOPES.read, SCOPES.write, "offline_access"] },
  );

  app.all("/mcp", (c) => {
    const header = c.req.header("authorization");
    if (config.devBearerToken && header === `Bearer ${config.devBearerToken}`) {
      return handleMcp(c.req.raw, db, DEV_USER_ID, new Set([SCOPES.read, SCOPES.write]), "dev");
    }
    return oauthMcp(c.req.raw);
  });

  return app;
}
