import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  decryptPrivateKey,
  encryptPrivateKey,
} from "./wallet-crypto";

const encryptionKey = Buffer.alloc(32, 7);
const privateKey = `0x${"ab".repeat(32)}`;

test("encrypts and decrypts a private key", () => {
  const encrypted = encryptPrivateKey(privateKey, encryptionKey);

  assert.notEqual(encrypted.encryptedPrivateKey, privateKey);
  assert.equal(encrypted.encryptionKeyVersion, 1);
  assert.equal(decryptPrivateKey(encrypted, encryptionKey), privateKey);
});

test("uses a fresh IV for every encryption", () => {
  const first = encryptPrivateKey(privateKey, encryptionKey);
  const second = encryptPrivateKey(privateKey, encryptionKey);

  assert.notEqual(first.encryptionIv, second.encryptionIv);
  assert.notEqual(first.encryptedPrivateKey, second.encryptedPrivateKey);
});

test("rejects tampered ciphertext", () => {
  const encrypted = encryptPrivateKey(privateKey, encryptionKey);
  const ciphertext = Buffer.from(encrypted.encryptedPrivateKey, "base64");
  ciphertext[0] ^= 1;

  assert.throws(() =>
    decryptPrivateKey(
      { ...encrypted, encryptedPrivateKey: ciphertext.toString("base64") },
      encryptionKey,
    ),
  );
});

test("rejects tampered authentication tag", () => {
  const encrypted = encryptPrivateKey(privateKey, encryptionKey);
  const tag = Buffer.from(encrypted.encryptionAuthTag, "base64");
  tag[0] ^= 1;

  assert.throws(() =>
    decryptPrivateKey(
      { ...encrypted, encryptionAuthTag: tag.toString("base64") },
      encryptionKey,
    ),
  );
});

test("rejects tampered IV", () => {
  const encrypted = encryptPrivateKey(privateKey, encryptionKey);
  const iv = Buffer.from(encrypted.encryptionIv, "base64");
  iv[0] ^= 1;

  assert.throws(() =>
    decryptPrivateKey(
      { ...encrypted, encryptionIv: iv.toString("base64") },
      encryptionKey,
    ),
  );
});

test("rejects unsupported key versions", () => {
  const encrypted = encryptPrivateKey(privateKey, encryptionKey);

  assert.throws(
    () =>
      decryptPrivateKey(
        { ...encrypted, encryptionKeyVersion: 2 },
        encryptionKey,
      ),
    /Unsupported wallet encryption key version/,
  );
});
