import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  armMintDbPool?: Pool;
};

function getPool(): Pool {
  if (globalForDb.armMintDbPool) return globalForDb.armMintDbPool;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("Missing required server environment variable: DATABASE_URL");
  }

  if (!URL.canParse(connectionString)) {
    throw new Error("Invalid URL in server environment variable: DATABASE_URL");
  }

  const pool = new Pool({ connectionString });
  globalForDb.armMintDbPool = pool;
  return pool;
}

// Drizzle's node-postgres adapter accepts a client-like object. Proxy the Pool so
// importing this module during `next build` does not read runtime-only config or
// create a database pool; the real Pool is created on first database operation.
const lazyPool = new Proxy({} as Pool, {
  get(_target, property) {
    const pool = getPool();
    const value = Reflect.get(pool, property, pool);
    return typeof value === "function" ? value.bind(pool) : value;
  },
});

export const db = drizzle({ client: lazyPool });
