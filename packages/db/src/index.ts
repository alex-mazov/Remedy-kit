import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export { schema };
export * from "./schema.ts";

export type Db = NodePgDatabase<typeof schema>;

/** Opens a connection pool. Call `close()` on shutdown and at the end of tests. */
export function createDb(connectionString: string): { db: Db; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}
