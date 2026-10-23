import type { Db } from "@remedy/db";

/** Who is calling the core: the mobile app or an agent connected over MCP. */
export interface Actor {
  kind: "app" | "agent";
  /** OAuth client id of the agent (e.g. Claude), when known. */
  clientId?: string;
}

/**
 * Everything an operation needs. Every query in the core is scoped to
 * `userId`: an operation never sees another user's data.
 */
export interface Ctx {
  db: Db;
  userId: string;
  actor: Actor;
  /** Overrides "now" in tests. */
  now?: Date;
}

/** Errors the adapters (REST, MCP) turn into readable messages. */
export class CoreError extends Error {
  override name = "CoreError";
  constructor(
    public readonly code: "not_found" | "ambiguous" | "validation" | "conflict",
    message: string,
    /** Extra data for the caller, e.g. the list of cabinets to choose from. */
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
