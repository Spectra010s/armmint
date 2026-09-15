import "server-only";

import { getWalletEncryptionKey } from "@/lib/server/config";
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

export function withDecryptedWalletPrivateKey<T>(
  encrypted: EncryptedPrivateKey,
  operation: (privateKey: string) => T,
): T {
  const encryptionKey = getWalletEncryptionKey();

  try {
    const privateKey = decryptPrivateKey(encrypted, encryptionKey);
    return operation(privateKey);
  } finally {
    encryptionKey.fill(0);
  }
}

export async function withDecryptedWalletPrivateKeyAsync<T>(
  encrypted: EncryptedPrivateKey,
  operation: (privateKey: string) => Promise<T>,
): Promise<T> {
  const encryptionKey = getWalletEncryptionKey();

  try {
    const privateKey = decryptPrivateKey(encrypted, encryptionKey);
    return await operation(privateKey);
  } finally {
    encryptionKey.fill(0);
  }
}
