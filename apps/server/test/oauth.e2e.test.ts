/**
 * End to end: an agent connects the way Claude would.
 * Real browser (Chromium) with a virtual passkey authenticator, real OAuth 2.1
 * with PKCE and resource indicators, then MCP calls with the issued token.
 */
import { serve, type ServerType } from "@hono/node-server";
import { anonymousUser, createDb, product, sql, user, type Db } from "@remedy/db";
import { runMigrations } from "@remedy/db/migrate";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, DEV_USER_ID } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";

const DB_URL = process.env.DATABASE_URL_TEST ?? "postgres://remedy:remedy@localhost:5432/remedy_test";
const SECRET = "e2e-secret-e2e-secret-e2e-secret-0123";
const REDIRECT = "http://localhost:9999/callback";

let db: Db;
let closeDb: () => Promise<void>;
let server: ServerType;
let base: string;
let browser: Browser;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function registerClient(name: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/** A page with a virtual platform authenticator: passkeys "just work", like Face ID. */
async function pageWithPasskeys(): Promise<Page> {
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return page;
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
  scope: string;
}

/**
 * Runs the authorization code flow in `page`. `onSignIn` performs the sign-in
 * page step; consent is accepted when shown. Returns the token response.
 */
async function authorize(page: Page, clientId: string, scope: string, onSignIn: (p: Page) => Promise<void>): Promise<Tokens> {
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(`${base}/api/auth/oauth2/authorize`);
  const params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope,
    state: randomBytes(8).toString("hex"),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${base}/mcp`,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let code: string | null = null;
  await page.route("http://localhost:9999/**", async (route) => {
    code = new URL(route.request().url()).searchParams.get("code");
    await route.fulfill({ body: "ok" });
  });

  // Navigations here are redirect chains that end in an intercepted URL, so poll the state instead of awaiting "load".
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 150 && !done(); i++) await page.waitForTimeout(100);
  };
  const onConsent = () => new URL(page.url()).pathname === "/consent";

  await page.goto(url.toString()).catch(() => {});
  if (page.url().includes("/sign-in")) await onSignIn(page);
  await until(() => code !== null || onConsent());
  if (code === null && onConsent()) {
    await page.waitForSelector("#allow");
    await page.click("#allow");
    await until(() => code !== null);
  }
  expect(code).toBeTruthy();

  const res = await fetch(`${base}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${base}/mcp`,
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Tokens;
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return { status: res.status, body: (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } } };
}

beforeAll(async () => {
  await runMigrations(DB_URL);
  ({ db, close: closeDb } = createDb(DB_URL));
  await db.delete(user);
  await db.delete(product);
  await db.insert(user).values(anonymousUser(DEV_USER_ID));

  const port = await freePort();
  base = `http://localhost:${port}`;
  const auth = createAuth({ db, publicUrl: base, secret: SECRET });
  server = serve({ fetch: createApp({ db, auth, publicUrl: base, secret: SECRET }).fetch, port });
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  await closeDb();
});

describe("connecting an agent", () => {
  it("publishes discovery metadata and challenges unauthenticated calls", async () => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);

    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [`${base}/api/auth`] });

    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server/api/auth`)).json()) as Record<string, unknown>;
    expect(as).toMatchObject({ issuer: `${base}/api/auth`, client_id_metadata_document_supported: true, code_challenge_methods_supported: ["S256"] });
  });

  it("creates an anonymous account with a passkey, then the agent uses MCP", async () => {
    const page = await pageWithPasskeys();
    const clientId = await registerClient("Test Agent");
    const tokens = await authorize(page, clientId, "remedy:read remedy:write offline_access", (p) => p.click("#create"));
    expect(tokens.scope.split(" ")).toEqual(expect.arrayContaining(["remedy:read", "remedy:write"]));
    expect(tokens.refresh_token).toBeTruthy();

    const created = await callTool(tokens.access_token, "create_cabinet", { name: "Дом" });
    expect(created.body.result.isError).toBeFalsy();
    const added = await callTool(tokens.access_token, "add_items", { cabinet: "Дом", items: [{ name: "Нурофен", expiry: "2027-05" }] });
    expect(JSON.parse(added.body.result.content[0]!.text).added).toHaveLength(1);

    // The new account is anonymous, has a passkey, and its session stores no IP or user agent.
    const rows = await db.execute<{ is_anonymous: boolean; passkeys: number; tracked: number }>(
      sql`select u.is_anonymous,
              (select count(*)::int from passkey p where p.user_id = u.id) as passkeys,
              (select count(*)::int from session s where s.user_id = u.id and (s.ip_address is not null or s.user_agent is not null)) as tracked
         from "user" u where u.id <> ${DEV_USER_ID}`,
    );
    expect(rows.rows).toEqual([{ is_anonymous: true, passkeys: 1, tracked: 0 }]);

    // Signing in again with the same passkey (fresh cookies) reaches the same cabinets.
    await page.context().clearCookies();
    const again = await authorize(page, clientId, "remedy:read remedy:write", (p) => p.click("#sign-in"));
    const cabinets = await callTool(again.access_token, "list_cabinets");
    expect(JSON.parse(cabinets.body.result.content[0]!.text)).toMatchObject([{ name: "Дом", itemCount: 1 }]);
    await page.close();
  }, 60_000);

  it("enforces read-only access when only remedy:read is granted", async () => {
    const page = await pageWithPasskeys();
    const clientId = await registerClient("Read-only Agent");
    const tokens = await authorize(page, clientId, "remedy:read", (p) => p.click("#create"));
    expect((await callTool(tokens.access_token, "list_cabinets")).body.result.isError).toBeFalsy();
    const write = await callTool(tokens.access_token, "create_cabinet", { name: "Дача" });
    expect(write.body.result.isError).toBe(true);
    expect(write.body.result.content[0]!.text).toMatch(/read-only/);
    await page.close();
  }, 60_000);

  it("rejects an invalid token", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer not-a-real-token", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
