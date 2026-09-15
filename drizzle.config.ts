import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("Missing required server environment variable: DATABASE_URL");
}

if (!URL.canParse(databaseUrl)) {
  throw new Error("Invalid URL in server environment variable: DATABASE_URL");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
