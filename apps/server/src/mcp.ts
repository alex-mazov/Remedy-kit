/**
 * MCP adapter: turns core operations into tools for the user's agent.
 * No business logic here — validation, scoping and logging live in the core.
 */
import {
  AddItemsInput,
  addItems,
  CoreError,
  CreateCabinetInput,
  createCabinet,
  type Ctx,
  ListExpiringInput,
  listCabinets,
  listCategories,
  listExpiring,
  SearchItemsInput,
  searchItems,
} from "@remedy/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError } from "zod";

const INSTRUCTIONS = `Remedy Kit stores the user's home medicine cabinets: which packages they have, where, and until when.
It only stores and returns data. It gives no medical advice; any advice is yours and your provider's responsibility.
When adding packages from a photo, read name, active substance, form, dosage and expiry from the package,
then show the user what you are about to add (or what you added) so they can correct mistakes.
If the marking DataMatrix content is available, pass it as dataMatrix: it is more reliable than reading the date.
Dates: YYYY-MM-DD, or YYYY-MM when only month and year are printed.`;

function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: (Array.isArray(data) ? { items: data } : data) as Record<string, unknown>,
  };
}

function fail(error: unknown): CallToolResult {
  if (error instanceof CoreError) {
    const details = error.details ? ` ${JSON.stringify(error.details)}` : "";
    return { isError: true, content: [{ type: "text", text: `${error.message}${details}` }] };
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { isError: true, content: [{ type: "text", text: `Invalid input: ${issues}` }] };
  }
  console.error("MCP tool failed", error);
  return { isError: true, content: [{ type: "text", text: "Internal error. Try again later." }] };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

const READ_ONLY: CallToolResult = {
  isError: true,
  content: [{ type: "text", text: "The user granted read-only access. Ask them to reconnect with permission to make changes." }],
};

/** Builds an MCP server bound to one user. Created per request (stateless transport). */
export function createMcpServer(ctx: Ctx, access: { canWrite: boolean }): McpServer {
  const write = (fn: () => Promise<unknown>) => (access.canWrite ? run(fn) : Promise.resolve(READ_ONLY));
  const server = new McpServer({ name: "remedy-kit", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_cabinets",
    {
      title: "List cabinets",
      description: "List the user's medicine cabinets (home, car, dacha...) with counts of packages, expiring and expired ones.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(() => listCabinets(ctx)),
  );

  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description: "List category keys usable in add_items and search_items.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(() => listCategories(ctx)),
  );

  server.registerTool(
    "search_items",
    {
      title: "Search packages",
      description:
        "Find packages by name or active substance, cabinet, category, status or expiry. " +
        "Use it to answer 'what do I have for X' (search by substance) or 'where is Y'. Results are sorted by expiry, soonest first.",
      inputSchema: SearchItemsInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => run(() => searchItems(ctx, args)),
  );

  server.registerTool(
    "list_expiring",
    {
      title: "Expired and expiring",
      description: "Packages in stock across all cabinets that have expired or will expire within N days (default: the user's setting, 30 days).",
      inputSchema: ListExpiringInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => run(() => listExpiring(ctx, args)),
  );

  server.registerTool(
    "create_cabinet",
    {
      title: "Create cabinet",
      description: "Create a new cabinet. Ask the user before creating one.",
      inputSchema: CreateCabinetInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => write(() => createCabinet(ctx, args)),
  );

  server.registerTool(
    "add_items",
    {
      title: "Add packages",
      description:
        "Add 1–20 packages to one cabinet. Read fields from photos of the packages; pass the DataMatrix content when you have it. " +
        "Always show the user the list you added, with expiry dates, so they can spot mistakes. " +
        "If the cabinet is not found, the error lists existing cabinets: ask the user which one to use.",
      inputSchema: AddItemsInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => write(() => addItems(ctx, args)),
  );

  return server;
}
