import { createDb, product, user, type Db } from "@remedy/db";
import { runMigrations } from "@remedy/db/migrate";
import type { Ctx } from "../src/index.ts";

export const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? "postgres://remedy:remedy@localhost:5432/remedy_test";

let migrated = false;

/** A clean database with one user; returns contexts for the app and for an agent. */
export async function setupTestDb(): Promise<{ db: Db; close: () => Promise<void>; app: Ctx; agent: Ctx; userId: string }> {
  if (!migrated) {
    await runMigrations(TEST_DB_URL);
    migrated = true;
  }
  const { db, close } = createDb(TEST_DB_URL);
  // DELETE (not TRUNCATE ... CASCADE) keeps the default categories, which have no user.
  await db.delete(user);
  await db.delete(product);
  const userId = "test-user";
  await db.insert(user).values({ id: userId, timezone: "Asia/Almaty", notifyDays: 30 });
  // Fixed "now": 2026-10-19 10:00 in Almaty.
  const now = new Date("2026-10-19T05:00:00Z");
  return {
    db,
    close,
    userId,
    app: { db, userId, actor: { kind: "app" }, now },
    agent: { db, userId, actor: { kind: "agent", clientId: "claude-test" }, now },
  };
}
