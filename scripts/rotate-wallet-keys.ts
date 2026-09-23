// Offline-capable wallet re-encryption for key rotation.
// Runbook: set ARMINT_PREVIOUS_ENCRYPTION_KEY to the old key, set
// ARMINT_ENCRYPTION_KEY to the new key, run this script, verify every row
// decrypts with the current key alone, then unset the previous key.
// Usage: node --env-file-if-exists=.env --import ./lib/server/register.ts scripts/rotate-wallet-keys.ts
import { and, eq } from "drizzle-orm";

import { db } from "../lib/db/index.ts";
import { wallets } from "../lib/db/schema.ts";
import {
  getPreviousWalletEncryptionKey,
  getWalletEncryptionKey,
} from "../lib/server/config.ts";
import {
  decryptPrivateKey,
  encryptPrivateKey,
} from "../lib/server/wallet-crypto.ts";

const currentKey = getWalletEncryptionKey();
const previousKey = getPreviousWalletEncryptionKey();
if (!previousKey) {
  console.error(
    "ARMINT_PREVIOUS_ENCRYPTION_KEY is required to rotate wallet keys",
  );
  process.exit(1);
}

let rotated = 0;
let alreadyCurrent = 0;
for (;;) {
  const batch = await db.select().from(wallets).limit(100);
  if (batch.length === 0) break;
  let progressed = false;
  for (const row of batch) {
    const encrypted = {
      encryptedPrivateKey: row.encryptedPrivateKey,
      encryptionIv: row.encryptionIv,
      encryptionAuthTag: row.encryptionAuthTag,
      encryptionKeyVersion: row.encryptionKeyVersion,
    };
    // Skip rows already encrypted under the current key.
    try {
      decryptPrivateKey(encrypted, currentKey);
      alreadyCurrent++;
      continue;
    } catch {
      // Fall through to previous-key decryption.
    }
    const privateKey = decryptPrivateKey(encrypted, previousKey);
    const next = encryptPrivateKey(privateKey, currentKey);
    const updated = await db
      .update(wallets)
      .set({ ...next, updatedAt: new Date() })
      .where(
        and(
          eq(wallets.id, row.id),
          eq(wallets.encryptedPrivateKey, row.encryptedPrivateKey),
        ),
      )
      .returning({ id: wallets.id });
    if (updated.length > 0) {
      rotated++;
      progressed = true;
    }
  }
  if (!progressed) break;
}

currentKey.fill(0);
previousKey.fill(0);
console.log(
  JSON.stringify({ rotated, alreadyCurrent }),
);

await db.$client.end();
