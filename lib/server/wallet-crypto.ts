import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;
export const WALLET_ENCRYPTION_KEY_VERSION = 1;

export interface EncryptedPrivateKey {
  encryptedPrivateKey: string;
  encryptionIv: string;
  encryptionAuthTag: string;
  encryptionKeyVersion: number;
}

function assertEncryptionKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error("Wallet encryption key must be exactly 32 bytes");
  }
}

function decodeBase64(name: string, value: string, expectedLength?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  const supplied = value.replace(/=+$/, "");

  if (!value || canonical !== supplied) {
    throw new Error(`Invalid ${name}`);
  }

  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`Invalid ${name}`);
  }

  return decoded;
}

export function encryptPrivateKey(
  privateKey: string,
  encryptionKey: Buffer,
): EncryptedPrivateKey {
  assertEncryptionKey(encryptionKey);

  if (!privateKey) {
    throw new Error("Private key must not be empty");
  }

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  const ciphertext = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedPrivateKey: ciphertext.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionAuthTag: cipher.getAuthTag().toString("base64"),
    encryptionKeyVersion: WALLET_ENCRYPTION_KEY_VERSION,
  };
}

export function decryptPrivateKey(
  encrypted: EncryptedPrivateKey,
  encryptionKey: Buffer,
): string {
  assertEncryptionKey(encryptionKey);

  if (encrypted.encryptionKeyVersion !== WALLET_ENCRYPTION_KEY_VERSION) {
    throw new Error(
      `Unsupported wallet encryption key version: ${encrypted.encryptionKeyVersion}`,
    );
  }

  const iv = decodeBase64("wallet encryption IV", encrypted.encryptionIv, IV_LENGTH_BYTES);
  const authTag = decodeBase64(
    "wallet encryption authentication tag",
    encrypted.encryptionAuthTag,
    AUTH_TAG_LENGTH_BYTES,
  );
  const ciphertext = decodeBase64(
    "encrypted private key",
    encrypted.encryptedPrivateKey,
  );

  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return plaintext.toString("utf8");
  } catch {
    throw new Error("Encrypted wallet key authentication failed");
  }
}
