import {
  mintJobState,
  executionAttemptState,
  transactionState,
} from "@/lib/db/schema";
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
  acquireExecutionLease,
  findRecoverableTransaction,
  markTransactionSubmitted,
  markTransactionTerminal,
  markReplacementSubmitted,
  releaseExecutionLease,
  renewExecutionLease,
  reserveReplacementTransaction,
  reserveTransaction,
} = await import("./store.ts");

before(async () => {
  const schema = await pushSchema(
    {
      mintJobState,
      executionAttemptState,
      transactionState,
      users,
      wallets,
      mintJobs,
      executionAttempts,
      transactions,
    },
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

  const hash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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

  const hash =
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
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

test("submitted persistence cannot overwrite a terminal transaction", async () => {
  const reserved = await reserveTransaction("attempt-1", 84532, 9);
  await markTransactionTerminal(reserved.id, "REVERTED");

  assert.equal(
    await markTransactionSubmitted(
      reserved.id,
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ),
    null,
  );

  const [persisted] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, reserved.id));
  assert.equal(persisted?.state, "REVERTED");
});

test("replacement submission is idempotent against late duplicate writes", async () => {
  const original = await reserveTransaction("attempt-1", 84532, 9);
  await markTransactionSubmitted(
    original.id,
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  );
  const replacement = await reserveReplacementTransaction(
    original.id,
    "attempt-1",
    84532,
    9,
  );

  assert.ok(
    await markReplacementSubmitted(
      replacement.id,
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    ),
  );
  assert.equal(
    await markReplacementSubmitted(
      replacement.id,
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    ),
    null,
  );
});

test("held execution lease cannot be stolen but can be renewed", async () => {
  const before = new Date();
  const first = await acquireExecutionLease("job-1", "attempt-1");
  assert.ok(first);

  // Acquiring also holds the claim so a second worker cannot reclaim mid-run.
  const [held] = await db
    .select({
      claimExpiresAt: mintJobs.claimExpiresAt,
      engineLeaseExpiresAt: mintJobs.engineLeaseExpiresAt,
    })
    .from(mintJobs)
    .where(eq(mintJobs.id, "job-1"));
  assert.ok(held.claimExpiresAt && held.claimExpiresAt > before);
  assert.ok(held.engineLeaseExpiresAt && held.engineLeaseExpiresAt > before);

  // Second acquisition while held fails.
  assert.equal(await acquireExecutionLease("job-1", "attempt-1"), null);

  // Heartbeat keeps the held lease alive.
  assert.ok(await renewExecutionLease("job-1", first!.id));

  // A foreign lease id cannot renew.
  assert.equal(await renewExecutionLease("job-1", "not-the-holder"), null);

  await releaseExecutionLease("job-1", first!.id);

  // After release the job can be leased again.
  assert.ok(await acquireExecutionLease("job-1", "attempt-1"));
});

test("replacement requires the original to be signed", async () => {
  const original = await reserveTransaction("attempt-1", 84532, 9);
  assert.equal(original.hash, null);

  await assert.rejects(
    reserveReplacementTransaction(original.id, "attempt-1", 84532, 9),
    /Only a signed transaction can be replaced/,
  );
});

test("replacement cannot reference a missing transaction", async () => {
  await assert.rejects(
    reserveReplacementTransaction(
      "00000000-0000-4000-8000-000000000000",
      "attempt-1",
      84532,
      9,
    ),
    /not found/,
  );
});

test("orphan replacement links are rejected by the database", async () => {
  const { randomUUID } = await import("node:crypto");
  try {
    await db.insert(transactions).values({
      id: randomUUID(),
      executionAttemptId: "attempt-1",
      replacesTransactionId: "00000000-0000-4000-8000-000000000000",
      chainId: 84532,
      nonce: 9,
    });
    assert.fail("expected orphan replacement link to be rejected");
  } catch (error) {
    const cause =
      error && typeof error === "object" && "cause" in error
        ? String((error as { cause: unknown }).cause)
        : String(error);
    assert.match(cause, /foreign key constraint/i);
  }
});
