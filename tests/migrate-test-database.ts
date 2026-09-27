import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

// Test-only connections. Reusing a disposable PostgreSQL database across suites
// must apply the deployment migrations once, not introspect/push partial schemas.
export async function migrateTestDatabase(pool: Pool | null, client: PGlite | null) {
  const config = { migrationsFolder: "./drizzle" };
  if (pool) await migratePg(pgDrizzle(pool), config);
  else if (client) await migratePglite(pgliteDrizzle(client), config);
  else throw new Error("A test database connection is required");
}
