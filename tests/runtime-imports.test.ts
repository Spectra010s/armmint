import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { test } from "node:test";

// This test runs in its own Node test process, without mocked runtime services.
test("server modules and every API route import without runtime configuration", async () => {
  for (const name of Object.keys(process.env)) {
    if (/^(DATABASE_|BETTER_AUTH_|GOOGLE_|TELEGRAM_|BASE_|ARC_|INK_|LEGACY_|ARMINT_)/.test(name))
      delete process.env[name];
  }
  process.env = { ...process.env, NODE_ENV: "production" };
  for (const directory of ["lib", "app/api"]) {
    const files = await readdir(new URL(`../${directory}/`, import.meta.url), { recursive: true });
    for (const file of files.sort()) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file === "server/register.ts") continue;
      await import(new URL(`../${directory}/${file}`, import.meta.url).href);
    }
  }
  const { getAuth } = await import("../lib/auth.ts");
  const { db } = await import("../lib/db/index.ts");
  const { getServerConfig, getWalletEncryptionKey } = await import("../lib/server/config.ts");
  // Deferral must not turn missing configuration into working defaults.
  assert.throws(() => getAuth(), /Missing required server environment variable/);
  assert.throws(() => getAuth(), /Missing required server environment variable/);
  assert.throws(() => db.$client.query("SELECT 1"), /DATABASE_URL/);
  assert.throws(() => getServerConfig(), /DATABASE_URL/);
  assert.throws(() => getWalletEncryptionKey(), /ARMINT_ENCRYPTION_KEY/);
});
