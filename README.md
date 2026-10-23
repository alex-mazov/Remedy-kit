# Remedy Kit

Home medicine cabinet service (working name). Your AI agent — Claude or ChatGPT — connects to it over MCP to add packages from photos, find what you have and see what is about to expire. A lightweight mobile app (later) sends expiry reminders and adds packages by scanning the marking code.

The service only stores and returns data. It gives no medical advice.

## Status

Stage 0. Working:

- Postgres schema: users, cabinets, packages, categories, shared product directory, action log.
- Core operations: cabinets, add packages (with DataMatrix parsing), search, expiring list.
- MCP server (`/mcp`, stateless Streamable HTTP) with tools `list_cabinets`, `list_categories`, `search_items`, `list_expiring`, `create_cabinet`, `add_items`.
- Accounts and agent access on Better Auth: anonymous accounts with passkeys (no email, no phone), OAuth 2.1 per the MCP authorization profile 2026-07-28 (protected resource metadata, Client ID Metadata Documents, PKCE, tokens bound to `/mcp`, scopes `remedy:read` / `remedy:write`). Dynamic client registration stays on until CIMD-only is confirmed with Claude and ChatGPT.

Not yet: recovery key (losing all passkeys means losing the account), undo/move/discard tools, the mobile app.

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

Check that MCP answers (the dev token works only outside production and only when `DEV_BEARER_TOKEN` is set):

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

## Connect Claude

Claude connects to remote MCP servers from Anthropic's cloud, so the server needs a public HTTPS address. For a quick test, a Cloudflare quick tunnel works:

```bash
cloudflared tunnel --url http://localhost:8787   # prints https://<random>.trycloudflare.com
```

1. Put that address in `.env` as `PUBLIC_URL` (no trailing slash) and restart `pnpm dev`.
2. In Claude: **Settings → Connectors → Add custom connector**, URL `https://<random>.trycloudflare.com/mcp`.
3. Claude opens the sign-in page: choose **Создать новую аптечку**, create the passkey, then allow access.
4. Ask Claude: «создай аптечку Дом и добавь туда нурофен до мая 2027».

Passkeys are bound to the host name. A quick tunnel gets a new name on every start, so each new tunnel means a new account; use a named tunnel or a real domain to keep one.

## Tests

```bash
pnpm typecheck
pnpm test
```

Tests run against a real Postgres (`DATABASE_URL_TEST`, created by `docker compose`). The end-to-end OAuth test drives Chromium with a virtual passkey authenticator; install the browser once with `pnpm exec playwright-core install chromium`.

## Docs

See [CLAUDE.md](CLAUDE.md) for code rules and links to the product and technical specs.
