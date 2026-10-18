import { randomUUID } from "node:crypto";
import { cabinet, category, item, product, type Cabinet, type Item } from "@remedy/db";
import { parseBarcode } from "@remedy/gs1";
import { and, asc, eq, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { resolveCabinet } from "./cabinets.ts";
import { CoreError, type Ctx } from "./context.ts";
import { addDays, endOfMonth, expiryStatus, todayIn, type ExpiryStatus } from "./dates.ts";
import { writeLog, type LogEntry } from "./log.ts";
import { AddItemsInput, ListExpiringInput, SearchItemsInput, type ItemInput } from "./schemas.ts";
import { getSettings } from "./user.ts";

/** What adapters return for one package. Empty fields are omitted to keep agent responses short. */
export interface ItemView {
  id: string;
  name: string;
  cabinet: string;
  substance?: string;
  form?: string;
  dosage?: string;
  category?: string;
  expiry?: string;
  expiryPrecision?: "month";
  expiryStatus: ExpiryStatus;
  quantity?: number;
  unit?: string;
  status: Item["status"];
  notes?: string;
  gtin?: string;
}

function toView(row: Item, cabinetName: string, categoryKey: string | null, today: string, notifyDays: number): ItemView {
  const view: ItemView = {
    id: row.id,
    name: row.name,
    cabinet: cabinetName,
    expiryStatus: expiryStatus(row.expiryDate, today, notifyDays),
    status: row.status,
  };
  if (row.substance) view.substance = row.substance;
  if (row.form) view.form = row.form;
  if (row.dosage) view.dosage = row.dosage;
  if (categoryKey) view.category = categoryKey;
  if (row.expiryDate) view.expiry = row.expiryDate;
  if (row.expiryDate && row.expiryPrecision === "month") view.expiryPrecision = "month";
  if (row.quantity != null) view.quantity = row.quantity;
  if (row.unit) view.unit = row.unit;
  if (row.notes) view.notes = row.notes;
  if (row.gtin) view.gtin = row.gtin;
  return view;
}

export interface CategoryView {
  key: string;
  name: string;
}

/** Default categories plus the user's own. */
export async function listCategories(ctx: Ctx): Promise<CategoryView[]> {
  const rows = await ctx.db
    .select({ key: category.key, nameRu: category.nameRu, nameKk: category.nameKk, sort: category.sort })
    .from(category)
    .where(or(isNull(category.userId), eq(category.userId, ctx.userId)))
    .orderBy(asc(category.sort), asc(category.nameRu));
  const { locale } = await getSettings(ctx);
  return rows.map((r) => ({ key: r.key, name: locale === "kk" && r.nameKk ? r.nameKk : r.nameRu }));
}

async function categoryIds(ctx: Ctx): Promise<Map<string, string>> {
  const rows = await ctx.db
    .select({ id: category.id, key: category.key })
    .from(category)
    .where(or(isNull(category.userId), eq(category.userId, ctx.userId)));
  return new Map(rows.map((r) => [r.key, r.id]));
}

export interface AddItemsResult {
  added: ItemView[];
  skipped: { index: number; name?: string; reason: string }[];
  warnings: string[];
  /** Pass to undo (stage 1) to remove everything this call added. */
  batchId: string;
}

/** Resolves one input item into column values, or a reason to skip it. */
async function prepareItem(
  ctx: Ctx,
  input: ItemInput,
  index: number,
  categories: Map<string, string>,
  warnings: string[],
): Promise<{ values: Omit<typeof item.$inferInsert, "userId" | "cabinetId"> } | { skip: string }> {
  let gtin: string | undefined;
  let serial: string | undefined;
  let batch: string | undefined;
  let expiryDate: string | undefined;
  let precision: "day" | "month" = "day";

  if (input.dataMatrix) {
    const code = parseBarcode(input.dataMatrix);
    if (code) {
      gtin = code.gtin;
      serial = code.serial;
      batch = code.batch;
      if (code.expiry) {
        expiryDate = code.expiry.date;
        precision = code.expiry.precision;
      }
    } else {
      warnings.push(`Item ${index + 1}: could not read the code, used the other fields.`);
    }
  }

  if (input.expiry) {
    const fromInput =
      input.expiry.length === 7
        ? { date: endOfMonth(input.expiry), precision: "month" as const }
        : { date: input.expiry, precision: "day" as const };
    if (expiryDate && expiryDate !== fromInput.date) {
      warnings.push(`Item ${index + 1}: expiry ${input.expiry} differs from the code; kept ${expiryDate} from the code.`);
    } else if (!expiryDate) {
      expiryDate = fromInput.date;
      precision = fromInput.precision;
    }
  }

  let name = input.name;
  let known: typeof product.$inferSelect | undefined;
  if (gtin) {
    [known] = await ctx.db.select().from(product).where(eq(product.gtin, gtin));
    name ??= known?.name;
  }
  if (!name) return { skip: "Name is unknown: the code is not in the product directory. Ask the user for the name." };

  let categoryId: string | null = null;
  if (input.category) {
    categoryId = categories.get(input.category) ?? null;
    if (!categoryId) warnings.push(`Item ${index + 1}: unknown category "${input.category}", left empty.`);
  }

  return {
    values: {
      name,
      substance: input.substance ?? known?.substance ?? null,
      form: input.form ?? known?.form ?? null,
      dosage: input.dosage ?? known?.dosage ?? null,
      gtin: gtin ?? null,
      serial: serial ?? null,
      batch: batch ?? null,
      expiryDate: expiryDate ?? null,
      expiryPrecision: precision,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      categoryId,
      notes: input.notes ?? null,
      createdVia: ctx.actor.kind === "agent" ? "agent" : input.dataMatrix ? "scan" : "app",
    },
  };
}

/**
 * Adds up to 20 packages to one cabinet in a single transaction.
 * Packages already present (same GTIN and serial) are skipped, not duplicated.
 */
export async function addItems(ctx: Ctx, rawInput: AddItemsInput): Promise<AddItemsResult> {
  const input = AddItemsInput.parse(rawInput);
  const settings = await getSettings(ctx);
  const today = todayIn(settings.timezone, ctx.now);

  let target: Cabinet | undefined;
  try {
    target = await resolveCabinet(ctx, input.cabinet);
  } catch (e) {
    if (!(e instanceof CoreError && e.code === "not_found" && input.createCabinetIfMissing)) throw e;
  }

  const categories = await categoryIds(ctx);
  const warnings: string[] = [];
  const skipped: AddItemsResult["skipped"] = [];
  const prepared: { index: number; values: Omit<typeof item.$inferInsert, "userId" | "cabinetId"> }[] = [];
  for (const [index, it] of input.items.entries()) {
    const result = await prepareItem(ctx, it, index, categories, warnings);
    if ("skip" in result) skipped.push({ index, name: it.name, reason: result.skip });
    else prepared.push({ index, values: result.values });
  }

  const batchId = randomUUID();
  const added = await ctx.db.transaction(async (tx) => {
    const log: LogEntry[] = [];
    if (!target) {
      [target] = await tx.insert(cabinet).values({ userId: ctx.userId, name: input.cabinet }).returning();
      log.push({ action: "create_cabinet", entity: "cabinet", entityId: target!.id, after: target });
    }

    const rows: Item[] = [];
    for (const p of prepared) {
      const [row] = await tx
        .insert(item)
        .values({ ...p.values, userId: ctx.userId, cabinetId: target!.id })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        skipped.push({ index: p.index, name: p.values.name, reason: "Already in the cabinets (same package code)." });
        continue;
      }
      rows.push(row);
      log.push({ action: "add_item", entity: "item", entityId: row.id, after: row });

      // Only names confirmed in the app feed the shared product directory, never agent guesses.
      if (ctx.actor.kind === "app" && row.gtin) {
        await tx
          .insert(product)
          .values({ gtin: row.gtin, name: row.name, substance: row.substance, form: row.form, dosage: row.dosage })
          .onConflictDoUpdate({ target: product.gtin, set: { confirmations: sql`${product.confirmations} + 1` } });
      }
    }
    await writeLog(tx, ctx, batchId, log);
    return rows;
  });

  const keyById = new Map([...categories].map(([k, id]) => [id, k]));
  return {
    added: added.map((r) => toView(r, target!.name, r.categoryId ? keyById.get(r.categoryId) ?? null : null, today, settings.notifyDays)),
    skipped: skipped.sort((a, b) => a.index - b.index),
    warnings,
    batchId,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Finds packages by text, cabinet, category, status and expiry. Sorted by expiry, soonest first. */
export async function searchItems(ctx: Ctx, rawInput: SearchItemsInput = {}): Promise<ItemView[]> {
  const input = SearchItemsInput.parse(rawInput);
  const settings = await getSettings(ctx);
  const today = todayIn(settings.timezone, ctx.now);

  const where: (SQL | undefined)[] = [eq(item.userId, ctx.userId)];
  if (input.status !== "any") where.push(eq(item.status, input.status));
  if (input.query) {
    const q = `%${escapeLike(input.query)}%`;
    where.push(or(ilike(item.name, q), ilike(item.substance, q)));
  }
  if (input.cabinet) where.push(eq(item.cabinetId, (await resolveCabinet(ctx, input.cabinet)).id));
  if (input.category) where.push(eq(category.key, input.category));
  if (input.expiringWithinDays !== undefined) where.push(lte(item.expiryDate, addDays(today, input.expiringWithinDays)));

  const rows = await ctx.db
    .select({ item, cabinetName: cabinet.name, categoryKey: category.key })
    .from(item)
    .innerJoin(cabinet, eq(cabinet.id, item.cabinetId))
    .leftJoin(category, eq(category.id, item.categoryId))
    .where(and(...where))
    .orderBy(sql`${item.expiryDate} asc nulls last`, asc(item.name))
    .limit(input.limit);

  return rows.map((r) => toView(r.item, r.cabinetName, r.categoryKey, today, settings.notifyDays));
}

export interface ExpiringResult {
  today: string;
  withinDays: number;
  expired: ItemView[];
  expiring: ItemView[];
}

/** Packages in stock that are already expired or expire within N days, across all cabinets. */
export async function listExpiring(ctx: Ctx, rawInput: ListExpiringInput = {}): Promise<ExpiringResult> {
  const input = ListExpiringInput.parse(rawInput);
  const settings = await getSettings(ctx);
  const withinDays = input.withinDays ?? settings.notifyDays;
  const today = todayIn(settings.timezone, ctx.now);
  const items = await searchItems(ctx, { expiringWithinDays: withinDays, limit: 200 });
  return {
    today,
    withinDays,
    expired: items.filter((i) => i.expiryStatus === "expired"),
    expiring: items.filter((i) => i.expiryStatus !== "expired"),
  };
}
