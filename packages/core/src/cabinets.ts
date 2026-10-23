import { randomUUID } from "node:crypto";
import { cabinet, item, type Cabinet } from "@remedy/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { CoreError, type Ctx } from "./context.ts";
import { addDays, todayIn } from "./dates.ts";
import { writeLog } from "./log.ts";
import { CreateCabinetInput } from "./schemas.ts";
import { getSettings } from "./user.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CabinetSummary {
  id: string;
  name: string;
  itemCount: number;
  expiringCount: number;
  expiredCount: number;
}

/** Active cabinets with counts of packages in stock. */
export async function listCabinets(ctx: Ctx): Promise<CabinetSummary[]> {
  const settings = await getSettings(ctx);
  const today = todayIn(settings.timezone, ctx.now);
  const cutoff = addDays(today, settings.notifyDays);

  const rows = await ctx.db
    .select({
      id: cabinet.id,
      name: cabinet.name,
      itemCount: sql<number>`count(${item.id})::int`,
      expiringCount: sql<number>`count(${item.id}) filter (where ${item.expiryDate} >= ${today} and ${item.expiryDate} <= ${cutoff})::int`,
      expiredCount: sql<number>`count(${item.id}) filter (where ${item.expiryDate} < ${today})::int`,
    })
    .from(cabinet)
    .leftJoin(item, and(eq(item.cabinetId, cabinet.id), eq(item.status, "in_stock")))
    .where(and(eq(cabinet.userId, ctx.userId), isNull(cabinet.archivedAt)))
    .groupBy(cabinet.id)
    .orderBy(asc(cabinet.sort), asc(cabinet.createdAt));
  return rows;
}

async function activeCabinets(ctx: Ctx): Promise<Cabinet[]> {
  return ctx.db
    .select()
    .from(cabinet)
    .where(and(eq(cabinet.userId, ctx.userId), isNull(cabinet.archivedAt)))
    .orderBy(asc(cabinet.sort), asc(cabinet.createdAt));
}

/**
 * Finds a cabinet by id or by name (case-insensitive).
 * Throws `not_found` with the list of existing cabinets so the agent can ask the user.
 */
export async function resolveCabinet(ctx: Ctx, ref: string): Promise<Cabinet> {
  const all = await activeCabinets(ctx);
  const needle = ref.trim().toLowerCase();
  const found = UUID.test(ref) ? all.find((c) => c.id === ref) : all.find((c) => c.name.toLowerCase() === needle);
  if (found) return found;
  throw new CoreError("not_found", `No cabinet named "${ref}".`, {
    cabinets: all.map((c) => c.name),
  });
}

export async function createCabinet(ctx: Ctx, input: CreateCabinetInput): Promise<Cabinet> {
  const { name } = CreateCabinetInput.parse(input);
  const existing = await activeCabinets(ctx);
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    throw new CoreError("conflict", `A cabinet named "${name}" already exists.`);
  }
  return ctx.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(cabinet)
      .values({ userId: ctx.userId, name, sort: existing.length })
      .returning();
    await writeLog(tx, ctx, randomUUID(), [
      { action: "create_cabinet", entity: "cabinet", entityId: created!.id, after: created },
    ]);
    return created!;
  });
}
