import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { pushSchema } from "drizzle-kit/api";

import {
  executionAttempts,
  mintJobs,
  transactions,
  users,
  wallets,
} from "@/lib/db/schema";

const client = new PGlite();
const db = drizzle(client);
const databaseMock = mock.module("@/lib/db", { exports: { db } });

const {
  findRecoverableTransaction,
  markTransactionSubmitted,
  markTransactionTerminal,
  markReplacementSubmitted,
  reserveReplacementTransaction,
  reserveTransaction,
} = await import("./store.ts");

before(async () => {
  const schema = await pushSchema(
    { users, wallets, mintJobs, executionAttempts, transactions },
    db,
  );
  await schema.apply();
});

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(executionAttempts);
  await db.delete(mintJobs);
  await db.delete(wallets);
  await db.delete(users);

  await db.insert(users).values({
    id: "user-1",
    name: "Engine Test",
    email: "engine@example.test",
  });
  await db.insert(wallets).values({
    id: "wallet-1",
    userId: "user-1",
    address: "0xabc",
    encryptedPrivateKey: "ciphertext",
    encryptionIv: "iv",
    encryptionAuthTag: "tag",
    encryptionKeyVersion: 1,
  });
  await db.insert(mintJobs).values({
    id: "job-1",
    userId: "user-1",
    walletId: "wallet-1",
    chainId: 84532,
    contractAddress: "0xcontract",
    scheduledFor: new Date("2026-09-22T12:00:00Z"),
    state: "SUBMITTING",
    idempotencyKey: "idem-job-1",
  });
  await db.insert(executionAttempts).values({
    id: "attempt-1",
    mintJobId: "job-1",
    attemptNumber: 1,
    state: "RUNNING",
  });
});

after(async () => {
  databaseMock.restore();
  await client.close();
});

test("reserved nonce survives restart before submission is recorded", async () => {
  await reserveTransaction("attempt-1", 84532, 9);

  const recovered = await findRecoverableTransaction("job-1");
  assert.equal(recovered?.nonce, 9);
  assert.equal(recovered?.state, "CREATED");
  assert.equal(recovered?.hash, null);
});

test("submitted transaction is recovered instead of creating duplicate work", async () => {
  const reserved = await reserveTransaction("attempt-1", 84532, 9);
  assert.ok(reserved);

  const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await markTransactionSubmitted(reserved.id, hash);

  const recovered = await findRecoverableTransaction("job-1");
  assert.equal(recovered?.id, reserved.id);
  assert.equal(recovered?.nonce, 9);
  assert.equal(recovered?.hash, hash);
  assert.equal(recovered?.state, "SUBMITTED");

  const rows = await db.select().from(transactions);
  assert.equal(rows.length, 1);
});

test("terminal transactions are not returned as recoverable", async () => {
  const reserved = await reserveTransaction("attempt-1", 84532, 9);
  assert.ok(reserved);

  const hash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await markTransactionSubmitted(reserved.id, hash);
  await markTransactionTerminal(reserved.id, "CONFIRMED");

  assert.equal(await findRecoverableTransaction("job-1"), null);

  const [persisted] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, reserved.id));
  assert.equal(persisted?.state, "CONFIRMED");
});

test("replacement keeps the original nonce and marks the old transaction replaced", async () => {
  const original = await reserveTransaction("attempt-1", 84532, 9);
  const originalHash =
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  await markTransactionSubmitted(original.id, originalHash);

  const replacement = await reserveReplacementTransaction(
    original.id,
    "attempt-1",
    84532,
    9,
  );
  const replacementHash =
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  await markReplacementSubmitted(replacement.id, replacementHash);

  const rows = await db.select().from(transactions);
  const persistedOriginal = rows.find((row) => row.id === original.id);
  const persistedReplacement = rows.find((row) => row.id === replacement.id);

  assert.equal(persistedOriginal?.state, "REPLACED");
  assert.equal(persistedReplacement?.state, "SUBMITTED");
  assert.equal(persistedReplacement?.nonce, original.nonce);
  assert.equal(persistedReplacement?.replacesTransactionId, original.id);

  const recovered = await findRecoverableTransaction("job-1");
  assert.equal(recovered?.id, replacement.id);
  assert.equal(recovered?.hash, replacementHash);
});

test("replacement refuses a different nonce", async () => {
  const original = await reserveTransaction("attempt-1", 84532, 9);

  await assert.rejects(
    reserveReplacementTransaction(original.id, "attempt-1", 84532, 10),
    /must reuse the original nonce/,
  );

  const rows = await db.select().from(transactions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, original.id);
});
