import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { pushSchema } from "drizzle-kit/api";

import { users, wallets } from "../db/schema.ts";
import { encryptPrivateKey, decryptPrivateKey } from "./wallet-crypto.ts";

const client = new PGlite();
const db = drizzle(client);
const databaseMock = mock.module("@/lib/db", { exports: { db } });

const { rotateWalletKeys } = await import("./wallet-key-rotation.ts");

const OLD_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const NEW_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const oldKey = () => Buffer.from(OLD_KEY_B64, "base64");
const newKey = () => Buffer.from(NEW_KEY_B64, "base64");

function useRotationKeys() {
  process.env.ARMINT_ENCRYPTION_KEY = NEW_KEY_B64;
  process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY = OLD_KEY_B64;
}

function useCurrentKeyOnly() {
  process.env.ARMINT_ENCRYPTION_KEY = NEW_KEY_B64;
  delete process.env.ARMINT_PREVIOUS_ENCRYPTION_KEY;
}

before(async () => {
  const schema = await pushSchema({ users, wallets }, db);
  await schema.apply();
});

async function ensureUser(n: number) {
  const id = `user-${n}`;
  await db
    .insert(users)
    .values({ id, name: `Rotation ${n}`, email: `rotation-${n}@example.test` })
    .onConflictDoNothing();
  return id;
}

beforeEach(async () => {
  await db.delete(wallets);
  await db.delete(users);
});

after(async () => {
  databaseMock.restore();
  await client.close();
});

const idOf = (n: number) => `wallet-${String(n).padStart(3, "0")}`;

async function insertWallet(n: number, key: Buffer) {
  const secret = `wallet-secret-${n}`;
  await db.insert(wallets).values({
    id: idOf(n),
    userId: await ensureUser(n),
    address: `0x${String(n).padStart(40, "0")}`,
    ...encryptPrivateKey(secret, key),
    encryptionKeyVersion: 1,
  });
  return secret;
}

async function assertAllDecryptWithCurrentKeyOnly(expected: Map<string, string>) {
  useCurrentKeyOnly();
  const rows = await db.select().from(wallets);
  assert.equal(rows.length, expected.size);
  for (const row of rows) {
    const recovered = decryptPrivateKey(
      {
        encryptedPrivateKey: row.encryptedPrivateKey,
        encryptionIv: row.encryptionIv,
        encryptionAuthTag: row.encryptionAuthTag,
        encryptionKeyVersion: row.encryptionKeyVersion,
      },
      newKey(),
    );
    assert.equal(recovered, expected.get(row.id));
  }
}

test("rotates more wallets than the batch size with mixed old and current rows", async () => {
  // First two id-ordered batches are already current: the old loop would
  // process them, make no progress, and break before reaching the old rows.
  const secrets = new Map<string, string>();
  for (let n = 0; n < 25; n++) {
    const alreadyCurrent = n < 10;
    secrets.set(
      idOf(n),
      await insertWallet(n, alreadyCurrent ? newKey() : oldKey()),
    );
  }

  useRotationKeys();
  const result = await rotateWalletKeys(undefined, 5);

  assert.equal(result.rotated, 15);
  assert.equal(result.alreadyCurrent, 10);
  assert.equal(result.skipped, 0);
  await assertAllDecryptWithCurrentKeyOnly(secrets);
});

test("undecryptable rows are skipped without blocking later rows", async () => {
  const secrets = new Map<string, string>();
  await db.insert(wallets).values({
    id: idOf(0),
    userId: await ensureUser(1000),
    address: `0x${"0".repeat(40)}`,
    encryptedPrivateKey: Buffer.from("garbage").toString("base64"),
    encryptionIv: Buffer.alloc(12).toString("base64"),
    encryptionAuthTag: Buffer.alloc(16).toString("base64"),
    encryptionKeyVersion: 1,
  });
  for (let n = 1; n <= 6; n++) {
    secrets.set(idOf(n), await insertWallet(n, oldKey()));
  }

  useRotationKeys();
  const result = await rotateWalletKeys(undefined, 5);

  assert.equal(result.rotated, 6);
  assert.equal(result.skipped, 1);

  // The six old-key rows now decrypt with the current key alone; the
  // undecryptable row is untouched.
  useCurrentKeyOnly();
  const rows = await db.select().from(wallets);
  assert.equal(rows.length, 7);
  for (const row of rows) {
    if (row.id === idOf(0)) {
      assert.equal(
        row.encryptedPrivateKey,
        Buffer.from("garbage").toString("base64"),
      );
      continue;
    }
    assert.equal(
      decryptPrivateKey(
        {
          encryptedPrivateKey: row.encryptedPrivateKey,
          encryptionIv: row.encryptionIv,
          encryptionAuthTag: row.encryptionAuthTag,
          encryptionKeyVersion: row.encryptionKeyVersion,
        },
        newKey(),
      ),
      secrets.get(row.id),
    );
  }
});

test("concurrent rotations never double-rotate or corrupt a row", async () => {
  const secrets = new Map<string, string>();
  for (let n = 0; n < 12; n++) {
    secrets.set(idOf(n), await insertWallet(n, oldKey()));
  }

  useRotationKeys();
  const [first, second] = await Promise.all([
    rotateWalletKeys(undefined, 5),
    rotateWalletKeys(undefined, 5),
  ]);

  // Each old row is rotated exactly once; the loser observes the winner's
  // ciphertext via the guarded write and skips instead of overwriting.
  assert.equal(first.rotated + second.rotated, 12);
  await assertAllDecryptWithCurrentKeyOnly(secrets);
});

test("guarded writes never overwrite a row changed after it was read", async () => {
  const secret = await insertWallet(0, oldKey());
  const [read] = await db.select().from(wallets);

  // A concurrent writer re-encrypts the row before our guarded write lands.
  const winner = encryptPrivateKey(secret, newKey());
  await db.update(wallets).set(winner).where(eq(wallets.id, read.id));

  // A stale guarded write matching the previously read ciphertext affects nothing.
  const stale = await db
    .update(wallets)
    .set(encryptPrivateKey(secret, oldKey()))
    .where(
      and(
        eq(wallets.id, read.id),
        eq(wallets.encryptedPrivateKey, read.encryptedPrivateKey),
      ),
    )
    .returning({ id: wallets.id });
  assert.equal(stale.length, 0);

  const [kept] = await db.select().from(wallets);
  assert.equal(kept.encryptedPrivateKey, winner.encryptedPrivateKey);
  useCurrentKeyOnly();
  assert.equal(
    decryptPrivateKey(
      {
        encryptedPrivateKey: kept.encryptedPrivateKey,
        encryptionIv: kept.encryptionIv,
        encryptionAuthTag: kept.encryptionAuthTag,
        encryptionKeyVersion: kept.encryptionKeyVersion,
      },
      newKey(),
    ),
    secret,
  );
});
