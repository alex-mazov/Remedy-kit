/**
 * Database schema. One Postgres database per region; nothing here links
 * a medicine to a real person, only to a random user id.
 *
 * The `user` table is minimal for now: Better Auth (stage 0, part 2) will
 * add its own columns and tables for sessions, passkeys and OAuth.
 */
import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  region: text("region").notNull().default("default"),
  /** Warn this many days before an expiry date. */
  notifyDays: integer("notify_days").notNull().default(30),
  locale: text("locale").notNull().default("ru"),
  timezone: text("timezone").notNull().default("Asia/Almaty"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A physical place where medicines are kept: home, dacha, car. */
export const cabinet = pgTable(
  "cabinet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("cabinet_user_name_uq")
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/** Default categories have no user_id; users may add their own. */
export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    nameRu: text("name_ru").notNull(),
    nameKk: text("name_kk"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex("category_user_key_uq").on(sql`coalesce(${t.userId}, '')`, t.key)],
);

export const itemStatus = pgEnum("item_status", ["in_stock", "discarded", "used_up"]);
export const itemSource = pgEnum("item_source", ["app", "scan", "agent"]);
export const expiryPrecision = pgEnum("expiry_precision", ["day", "month"]);

/** One package of a medicine in one cabinet. */
export const item = pgTable(
  "item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cabinetId: uuid("cabinet_id")
      .notNull()
      .references(() => cabinet.id, { onDelete: "restrict" }),
    gtin: text("gtin"),
    name: text("name").notNull(),
    substance: text("substance"),
    form: text("form"),
    dosage: text("dosage"),
    /** Null when the package shows no date or nobody entered it yet. */
    expiryDate: date("expiry_date", { mode: "string" }),
    expiryPrecision: expiryPrecision("expiry_precision").notNull().default("day"),
    batch: text("batch"),
    serial: text("serial"),
    quantity: integer("quantity"),
    unit: text("unit"),
    categoryId: uuid("category_id").references(() => category.id, { onDelete: "set null" }),
    status: itemStatus("status").notNull().default("in_stock"),
    notes: text("notes"),
    createdVia: itemSource("created_via").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("item_user_status_expiry_idx").on(t.userId, t.status, t.expiryDate),
    index("item_cabinet_idx").on(t.cabinetId),
    // The same physical package (marking serial) cannot be added twice.
    uniqueIndex("item_user_serial_uq")
      .on(t.userId, t.gtin, t.serial)
      .where(sql`${t.serial} is not null`),
    index("item_name_trgm_idx").using("gin", sql`lower(${t.name}) gin_trgm_ops`),
  ],
);

/** Shared product reference by GTIN. Holds no link to the users who confirmed it. */
export const product = pgTable("product", {
  gtin: text("gtin").primaryKey(),
  name: text("name").notNull(),
  substance: text("substance"),
  form: text("form"),
  dosage: text("dosage"),
  confirmations: integer("confirmations").notNull().default(1),
  updatedAt: updatedAt(),
});

export const actor = pgEnum("actor", ["app", "agent"]);

/**
 * Every change made through the core. `batch_id` groups the rows written by
 * one call (e.g. one `add_items` with 12 packages) so it can be undone at once.
 */
export const actionLog = pgTable(
  "action_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actor: actor("actor").notNull(),
    oauthClientId: text("oauth_client_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("action_log_user_created_idx").on(t.userId, t.createdAt), index("action_log_batch_idx").on(t.batchId)],
);

export type User = typeof user.$inferSelect;
export type Cabinet = typeof cabinet.$inferSelect;
export type Category = typeof category.$inferSelect;
export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;
export type Product = typeof product.$inferSelect;
export type ActionLog = typeof actionLog.$inferSelect;
