/**
 * Contract test: a real MCP client (official SDK) talks to the server over HTTP,
 * the way Claude or ChatGPT would.
 */
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCabinet } from "@remedy/core";
import { anonymousUser, createDb, product, user, type Db } from "@remedy/db";
import { runMigrations } from "@remedy/db/migrate";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp, DEV_USER_ID } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";

const DB_URL = process.env.DATABASE_URL_TEST ?? "postgres://remedy:remedy@localhost:5432/remedy_test";
const TOKEN = "test-token";

let db: Db;
let closeDb: () => Promise<void>;
let server: ServerType;
let baseUrl: string;

async function connect(token = TOKEN): Promise<Client> {
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

function json(result: Awaited<ReturnType<Client["callTool"]>>): any {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first!.text);
}

beforeAll(async () => {
  await runMigrations(DB_URL);
  ({ db, close: closeDb } = createDb(DB_URL));
  const publicUrl = "http://localhost:8787";
  const secret = "test-secret-test-secret-test-secret-123";
  const auth = createAuth({ db, publicUrl, secret });
  server = serve({ fetch: createApp({ db, auth, publicUrl, secret, devBearerToken: TOKEN }).fetch, port: 0 });
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await closeDb();
});

beforeEach(async () => {
  await db.delete(user);
  await db.delete(product);
  await db.insert(user).values(anonymousUser(DEV_USER_ID));
  await createCabinet({ db, userId: DEV_USER_ID, actor: { kind: "app" } }, { name: "Дом" });
});

describe("MCP server", () => {
  it("rejects requests without a valid token", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer resource_metadata=/);
  });

  it("exposes the stage 0 tools with read-only hints on readers", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["add_items", "create_cabinet", "list_cabinets", "list_categories", "list_expiring", "search_items"].sort(),
    );
    expect(tools.find((t) => t.name === "search_items")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "add_items")?.annotations?.readOnlyHint).toBe(false);
    await client.close();
  });

  it("adds packages and finds them again", async () => {
    const client = await connect();
    const added = json(
      await client.callTool({
        name: "add_items",
        arguments: { cabinet: "дом", items: [{ name: "Нурофен", substance: "ибупрофен", expiry: "2027-04" }] },
      }),
    );
    expect(added.added[0]).toMatchObject({ name: "Нурофен", cabinet: "Дом", expiry: "2027-04-30" });

    const found = json(await client.callTool({ name: "search_items", arguments: { query: "ибупрофен" } }));
    expect(found.map((i: { name: string }) => i.name)).toEqual(["Нурофен"]);

    const cabinets = json(await client.callTool({ name: "list_cabinets", arguments: {} }));
    expect(cabinets[0]).toMatchObject({ name: "Дом", itemCount: 1 });
    await client.close();
  });

  it("returns readable errors the agent can act on", async () => {
    const client = await connect();
    const missing = await client.callTool({ name: "add_items", arguments: { cabinet: "Дача", items: [{ name: "Бинт" }] } });
    expect(missing.isError).toBe(true);
    expect((missing.content as { text: string }[])[0]!.text).toContain('"cabinets":["Дом"]');

    const invalid = await client.callTool({ name: "add_items", arguments: { cabinet: "Дом", items: [{ name: "x", expiry: "2027-13" }] } });
    expect(invalid.isError).toBe(true);
    await client.close();
  });
});
