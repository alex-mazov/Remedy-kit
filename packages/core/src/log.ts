import { actionLog, type Db } from "@remedy/db";
import type { Ctx } from "./context.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface LogEntry {
  action: string;
  entity: "item" | "cabinet";
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Writes action-log rows for one call. All rows share `batchId`, so the call can be undone as a whole. */
export async function writeLog(tx: Tx | Db, ctx: Ctx, batchId: string, entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(actionLog).values(
    entries.map((e) => ({
      batchId,
      userId: ctx.userId,
      actor: ctx.actor.kind,
      oauthClientId: ctx.actor.clientId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      before: e.before ?? null,
      after: e.after ?? null,
    })),
  );
}
