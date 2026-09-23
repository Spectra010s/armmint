import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getServerConfig } from "@/lib/server/config";

const { DATABASE_URL } = getServerConfig();

const globalForDb = globalThis as typeof globalThis & {
  armMintDbPool?: Pool;
};

const pool =
  globalForDb.armMintDbPool ??
  new Pool({
    connectionString: DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.armMintDbPool = pool;
}

export const db = drizzle({ client: pool });
