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
const { failExecution } = await import("./failure.ts");

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
    name: "Failure Test",
    email: "failure@example.test",
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
    state: "CONFIRMING",
    idempotencyKey: "failure-job-1",
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
    state: "CONFIRMING",
  });
});

after(async () => {
  databaseMock.restore();
  await client.close();
});

test("revert persists an auditable terminal failure across all execution records", async () => {
  await failExecution(
    "tx-1",
    { code: "REVERTED", message: "Execution reverted" },
    "REVERTED",
  );

  const [transaction] = await db.select().from(transactions).where(eq(transactions.id, "tx-1"));
  const [attempt] = await db.select().from(executionAttempts).where(eq(executionAttempts.id, "attempt-1"));
  const [job] = await db.select().from(mintJobs).where(eq(mintJobs.id, "job-1"));

  assert.equal(transaction?.state, "REVERTED");
  assert.equal(attempt?.state, "FAILED");
  assert.equal(attempt?.failureCode, "REVERTED");
  assert.equal(attempt?.failureMessage, "Execution reverted");
  assert.equal(job?.state, "FAILED");
});

test("failure cannot overwrite an already confirmed transaction", async () => {
  await db.update(transactions).set({ state: "CONFIRMED" }).where(eq(transactions.id, "tx-1"));

  assert.equal(
    await failExecution(
      "tx-1",
      { code: "REVERTED", message: "late receipt" },
      "REVERTED",
    ),
    null,
  );

  const [persistedTransaction] = await db
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

  assert.equal(persistedTransaction?.state, "CONFIRMED");
  assert.notEqual(attempt?.state, "FAILED");
  assert.notEqual(job?.state, "FAILED");
});

test("late failure cannot overwrite a succeeded attempt and job", async () => {
  await db.update(executionAttempts).set({ state: "SUCCEEDED" }).where(eq(executionAttempts.id, "attempt-1"));
  await db.update(mintJobs).set({ state: "SUCCEEDED" }).where(eq(mintJobs.id, "job-1"));

  assert.equal(
    await failExecution(
      "tx-1",
      { code: "REVERTED", message: "late receipt" },
      "REVERTED",
    ),
    null,
  );

  const [attempt] = await db.select().from(executionAttempts).where(eq(executionAttempts.id, "attempt-1"));
  const [job] = await db.select().from(mintJobs).where(eq(mintJobs.id, "job-1"));

  assert.equal(attempt?.state, "SUCCEEDED");
  assert.equal(job?.state, "SUCCEEDED");
});
