import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
export const WALLET_KEY_VERSION = 1;

export interface EncryptedWalletKey {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

function decodeEncryptionKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  const canonical = key.toString("base64").replace(/=+$/, "");
  const supplied = encodedKey.replace(/=+$/, "");

  if (key.length !== 32 || canonical !== supplied) {
    throw new Error("Invalid wallet encryption key configuration");
  }

  return key;
}

function decodeField(name: string, value: string, expectedBytes?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  const supplied = value.replace(/=+$/, "");

  if (
    canonical !== supplied ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new Error(`Invalid encrypted wallet ${name}`);
  }

  return decoded;
}

export function encryptWalletPrivateKey(
  privateKey: string,
  encodedEncryptionKey: string,
): EncryptedWalletKey {
  if (!privateKey) {
    throw new Error("Private key must not be empty");
  }

  const key = decodeEncryptionKey(encodedEncryptionKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });

  const ciphertext = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: WALLET_KEY_VERSION,
  };
}

export function decryptWalletPrivateKey(
  encrypted: EncryptedWalletKey,
  encodedEncryptionKey: string,
): string {
  if (encrypted.keyVersion !== WALLET_KEY_VERSION) {
    throw new Error("Unsupported wallet encryption key version");
  }

  const key = decodeEncryptionKey(encodedEncryptionKey);
  const iv = decodeField("IV", encrypted.iv, IV_BYTES);
  const authTag = decodeField("authentication tag", encrypted.authTag, AUTH_TAG_BYTES);
  const ciphertext = decodeField("ciphertext", encrypted.ciphertext);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Encrypted wallet key authentication failed");
  }
}
