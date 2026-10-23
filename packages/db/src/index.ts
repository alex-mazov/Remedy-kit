import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as authSchema from "./auth-schema.ts";
import * as appSchema from "./schema.ts";

export const schema = { ...appSchema, ...authSchema };
export * from "./schema.ts";
// Re-exported so apps use the same drizzle-orm instance as the schema (pnpm may install peer variants).
export { and, eq, sql } from "drizzle-orm";

export type Db = NodePgDatabase<typeof schema>;

/** Opens a connection pool. Call `close()` on shutdown and at the end of tests. */
export function createDb(connectionString: string): { db: Db; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

/** Test and seed helper: a user row with the placeholder fields Better Auth requires. */
export function anonymousUser(id: string) {
  return { id, name: "Аптечка", email: `${id}@anon.invalid`, isAnonymous: true };
}
