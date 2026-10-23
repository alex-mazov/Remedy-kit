# Remedy Kit

Home medicine cabinet service (working name). Your AI agent — Claude or ChatGPT — connects to it over MCP to add packages from photos, find what you have and see what is about to expire. A lightweight mobile app (later) sends expiry reminders and adds packages by scanning the marking code.

The service only stores and returns data. It gives no medical advice.

## Status

Stage 0 — skeleton. Working:

- Postgres schema: users, cabinets, packages, categories, shared product directory, action log.
- Core operations: cabinets, add packages (with DataMatrix parsing), search, expiring list.
- MCP server (`/mcp`, stateless Streamable HTTP) with tools `list_cabinets`, `list_categories`, `search_items`, `list_expiring`, `create_cabinet`, `add_items`.
- Temporary auth: a fixed dev bearer token. **Real OAuth (Better Auth) is the next step**; until then the server must not be exposed publicly.

## Run locally

Requirements: Node 22+, pnpm 10, Docker (or a local Postgres 16+).

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Check that MCP answers:

```bash
curl -s http://localhost:8787/mcp \
  -H "authorization: Bearer dev-token-change-me" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_expiring","arguments":{}}}'
```

Or open [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (`npx @modelcontextprotocol/inspector`), choose *Streamable HTTP*, URL `http://localhost:8787/mcp`, and add the header `Authorization: Bearer dev-token-change-me`.

Claude Code can use it directly:

```bash
claude mcp add --transport http remedy-kit http://localhost:8787/mcp \
  --header "Authorization: Bearer dev-token-change-me"
```

## Tests

```bash
pnpm typecheck
pnpm test
```

Tests run against a real Postgres (`DATABASE_URL_TEST`, created by `docker compose`).

## Docs

See [CLAUDE.md](CLAUDE.md) for code rules and links to the product and technical specs.
