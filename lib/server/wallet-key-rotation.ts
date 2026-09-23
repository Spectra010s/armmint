import "server-only";

import { and, asc, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db";
import { wallets } from "@/lib/db/schema";
import {
  getPreviousWalletEncryptionKey,
  getWalletEncryptionKey,
} from "@/lib/server/config";
import {
  decryptPrivateKey,
  encryptPrivateKey,
} from "@/lib/server/wallet-crypto";

export type WalletRotationResult = {
  rotated: number;
  alreadyCurrent: number;
  skipped: number;
};

// Re-encrypt every wallet row with the current key. Rows are visited with a
// stable id-ordered cursor so already-current rows can never trap the loop on
// the first batch: the cursor advances past every visited row regardless of
// whether it needed rotation. Each write is guarded by the ciphertext read
// earlier in the same pass, so a row changed concurrently is skipped rather
// than overwritten. Rows decryptable with neither key are also skipped.
export async function rotateWalletKeys(
  database: typeof db = db,
  batchSize = 100,
): Promise<WalletRotationResult> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1)
    throw new Error("Rotation batch size must be positive");
  const currentKey = getWalletEncryptionKey();
  const previousKey = getPreviousWalletEncryptionKey();
  if (!previousKey) {
    currentKey.fill(0);
    throw new Error(
      "ARMINT_PREVIOUS_ENCRYPTION_KEY is required to rotate wallet keys",
    );
  }
  let rotated = 0;
  let alreadyCurrent = 0;
  let skipped = 0;
  try {
    let lastId: string | null = null;
    for (;;) {
      let batch: Array<typeof wallets.$inferSelect>;
      if (lastId === null) {
        batch = await database
          .select()
          .from(wallets)
          .orderBy(asc(wallets.id))
          .limit(batchSize);
      } else {
        batch = await database
          .select()
          .from(wallets)
          .where(gt(wallets.id, lastId))
          .orderBy(asc(wallets.id))
          .limit(batchSize);
      }
      if (batch.length === 0) break;
      lastId = batch[batch.length - 1].id;
      for (const row of batch) {
        const encrypted = {
          encryptedPrivateKey: row.encryptedPrivateKey,
          encryptionIv: row.encryptionIv,
          encryptionAuthTag: row.encryptionAuthTag,
          encryptionKeyVersion: row.encryptionKeyVersion,
        };
        try {
          decryptPrivateKey(encrypted, currentKey);
          alreadyCurrent++;
          continue;
        } catch {
          // Fall through to previous-key decryption.
        }
        let privateKey: string;
        try {
          privateKey = decryptPrivateKey(encrypted, previousKey);
        } catch {
          skipped++;
          continue;
        }
        const next = encryptPrivateKey(privateKey, currentKey);
        const updated = await database
          .update(wallets)
          .set({ ...next, updatedAt: new Date() })
          .where(
            and(
              eq(wallets.id, row.id),
              eq(wallets.encryptedPrivateKey, row.encryptedPrivateKey),
            ),
          )
          .returning({ id: wallets.id });
        if (updated.length > 0) rotated++;
        else skipped++;
      }
    }
    return { rotated, alreadyCurrent, skipped };
  } finally {
    currentKey.fill(0);
    previousKey.fill(0);
  }
}
