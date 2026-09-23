import "server-only";

import {
  getPreviousWalletEncryptionKey,
  getWalletEncryptionKey,
} from "@/lib/server/config";
import {
  decryptPrivateKey,
  encryptPrivateKey,
  type EncryptedPrivateKey,
} from "@/lib/server/wallet-crypto";

export function encryptWalletPrivateKey(
  privateKey: string,
): EncryptedPrivateKey {
  const encryptionKey = getWalletEncryptionKey();

  try {
    return encryptPrivateKey(privateKey, encryptionKey);
  } finally {
    encryptionKey.fill(0);
  }
}

function decryptWithRotationFallback(encrypted: EncryptedPrivateKey): string {
  const encryptionKey = getWalletEncryptionKey();
  try {
    return decryptPrivateKey(encrypted, encryptionKey);
  } catch (error) {
    const previousKey = getPreviousWalletEncryptionKey();
    if (
      previousKey &&
      error instanceof Error &&
      error.message === "Encrypted wallet key authentication failed"
    ) {
      try {
        return decryptPrivateKey(encrypted, previousKey);
      } finally {
        previousKey.fill(0);
      }
    }
    throw error;
  } finally {
    encryptionKey.fill(0);
  }
}

export function withDecryptedWalletPrivateKey<T>(
  encrypted: EncryptedPrivateKey,
  operation: (privateKey: string) => T,
): T {
  return operation(decryptWithRotationFallback(encrypted));
}

export async function withDecryptedWalletPrivateKeyAsync<T>(
  encrypted: EncryptedPrivateKey,
  operation: (privateKey: string) => Promise<T>,
): Promise<T> {
  return operation(decryptWithRotationFallback(encrypted));
}
