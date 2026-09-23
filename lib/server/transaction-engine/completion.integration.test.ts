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

const { beginConfirmation, completeConfirmedExecution } = await import(
  "./completion.ts"
);

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
    name: "Completion Test",
    email: "completion@example.test",
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
    state: "SUBMITTED",
    idempotencyKey: "completion-job-1",
  });
  await db.insert(executionAttempts).values({
    id: "attempt-1",
    mintJobId: "job-1",
    attemptNumber: 1,
    state: "RUNNING",
  });
  await db.insert(transactions).values({
    id: "tx-1",
    executionAttemptId: "attempt-1",
    chainId: 84532,
    nonce: 4,
    hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    state: "SUBMITTED",
  });
});

after(async () => {
  databaseMock.restore();
  await client.close();
});

test("confirmation completes transaction, attempt, and job exactly once", async () => {
  assert.ok(await beginConfirmation("tx-1"));
  assert.ok(await completeConfirmedExecution("tx-1"));
  assert.ok(await completeConfirmedExecution("tx-1"));

  const [transaction] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, "tx-1"));
  const [attempt] = await db
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.id, "attempt-1"));
  const [job] = await db
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.id, "job-1"));

  assert.equal(transaction?.state, "CONFIRMED");
  assert.equal(attempt?.state, "SUCCEEDED");
  assert.equal(job?.state, "SUCCEEDED");
});

test("late confirmation cannot overwrite a failed execution", async () => {
  await beginConfirmation("tx-1");

  await db
    .update(executionAttempts)
    .set({ state: "FAILED", failureCode: "RETRY_EXHAUSTED" })
    .where(eq(executionAttempts.id, "attempt-1"));
  await db
    .update(mintJobs)
    .set({ state: "FAILED" })
    .where(eq(mintJobs.id, "job-1"));

  assert.equal(await completeConfirmedExecution("tx-1"), null);

  const [attempt] = await db
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.id, "attempt-1"));
  const [job] = await db
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.id, "job-1"));

  assert.equal(attempt?.state, "FAILED");
  assert.equal(attempt?.failureCode, "RETRY_EXHAUSTED");
  assert.equal(job?.state, "FAILED");
});
