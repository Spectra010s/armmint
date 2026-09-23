// Offline-capable wallet re-encryption for key rotation.
// Runbook: set ARMINT_PREVIOUS_ENCRYPTION_KEY to the old key, set
// ARMINT_ENCRYPTION_KEY to the new key, run this script, verify every row
// decrypts with the current key alone, then unset the previous key.
// Usage: node --env-file-if-exists=.env --import ./lib/server/register.ts scripts/rotate-wallet-keys.ts
import { db } from "../lib/db/index.ts";
import { rotateWalletKeys } from "../lib/server/wallet-key-rotation.ts";

try {
  console.log(JSON.stringify(await rotateWalletKeys(db)));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Wallet rotation failed",
  );
  process.exit(1);
}

await db.$client.end();
