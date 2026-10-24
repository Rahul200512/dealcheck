import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// database is optional: without DATABASE_URL the app still serves predictions, it just skips logging
const globalForDb = globalThis as typeof globalThis & {
  __dealcheckPool?: Pool;
  __dealcheckDb?: NodePgDatabase;
};

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** returns a shared drizzle client, or null when no database is configured */
export function getDb(): NodePgDatabase | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForDb.__dealcheckDb) {
    globalForDb.__dealcheckPool ??= new Pool({ connectionString: url });
    globalForDb.__dealcheckDb = drizzle(globalForDb.__dealcheckPool);
  }
  return globalForDb.__dealcheckDb;
}
