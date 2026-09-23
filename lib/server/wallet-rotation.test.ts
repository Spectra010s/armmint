import assert from "node:assert/strict";
import test from "node:test";

process.env.ARMINT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

const keyA = Buffer.alloc(32, 9).toString("base64");
const keyB = Buffer.alloc(32, 7).toString("base64");

const { encryptPrivateKey } = await import("./wallet-crypto.ts");
const service = await import("./wallet-key-service.ts");

const secret = `0x${"ab".repeat(32)}`;

test("rotation fallback decrypts rows encrypted under the previous key", async () => {
  process.env.ARMINT_ENCRYPTION_KEY = keyA;
  delete process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY;
  const encrypted = service.encryptWalletPrivateKey(secret);

  // Rotate: new current key, old key retained as previous.
  process.env.ARMINT_ENCRYPTION_KEY = keyB;
  process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY = keyA;

  const recovered = service.withDecryptedWalletPrivateKey(
    encrypted,
    (value) => value,
  );
  assert.equal(recovered, secret);

  // New rows use the current key and decrypt without fallback.
  const fresh = service.encryptWalletPrivateKey(secret);
  delete process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY;
  assert.equal(
    service.withDecryptedWalletPrivateKey(fresh, (value) => value),
    secret,
  );
  assert.equal(
    JSON.stringify({ encrypted, fresh }).includes(secret),
    false,
  );
});

test("unknown keys still fail without leaking plaintext", async () => {
  process.env.ARMINT_ENCRYPTION_KEY = keyA;
  delete process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY;
  const encrypted = service.encryptWalletPrivateKey(secret);

  process.env.ARMINT_ENCRYPTION_KEY = keyB;
  delete process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY;
  assert.throws(
    () => service.withDecryptedWalletPrivateKey(encrypted, (value) => value),
    /authentication failed/,
  );

  // A wrong previous key does not help either.
  process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString(
    "base64",
  );
  assert.throws(
    () => service.withDecryptedWalletPrivateKey(encrypted, (value) => value),
    /authentication failed/,
  );
  delete process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY;
});

test("previous-key decoding rejects malformed values", async () => {
  process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY = "not-base64!!";
  assert.throws(
    () =>
      service.withDecryptedWalletPrivateKey(
        {
          encryptedPrivateKey: "eA==",
          encryptionIv: Buffer.alloc(12).toString("base64"),
          encryptionAuthTag: Buffer.alloc(16).toString("base64"),
          encryptionKeyVersion: 1,
        },
        (value) => value,
      ),
    /base64-encoded 32-byte key/,
  );
  delete process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY;
  assert.equal(
    encryptPrivateKey(secret, Buffer.alloc(32, 9)).encryptionKeyVersion,
    1,
  );
});
