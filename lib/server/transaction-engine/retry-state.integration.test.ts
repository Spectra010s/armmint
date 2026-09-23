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

import { executionAttempts, mintJobs, users, wallets } from "@/lib/db/schema";

const client = new PGlite();
const db = drizzle(client);
const databaseMock = mock.module("@/lib/db", { exports: { db } });
const { scheduleExecutionRetry } = await import("./retry-state.ts");

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
    },
    db,
  );
  await schema.apply();
});

beforeEach(async () => {
  await db.delete(executionAttempts);
  await db.delete(mintJobs);
  await db.delete(wallets);
  await db.delete(users);
  await db
    .insert(users)
    .values({ id: "user-1", name: "Retry Test", email: "retry@example.test" });
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
    idempotencyKey: "retry-job-1",
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

test("retry state is persisted for both attempt and job", async () => {
  assert.deepEqual(await scheduleExecutionRetry("attempt-1"), {
    kind: "scheduled",
    attemptId: "attempt-1",
    jobId: "job-1",
  });

  const [attempt] = await db
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.id, "attempt-1"));
  const [job] = await db
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.id, "job-1"));
  assert.equal(attempt?.state, "RETRYING");
  assert.equal(job?.state, "RETRYING");
});

test("retry exhaustion fails both attempt and job", async () => {
  await db
    .update(executionAttempts)
    .set({ attemptNumber: 3 })
    .where(eq(executionAttempts.id, "attempt-1"));

  assert.deepEqual(
    await scheduleExecutionRetry("attempt-1", {
      maxAttempts: 3,
      gasBumpBps: 1_250,
    }),
    { kind: "exhausted", attemptId: "attempt-1", jobId: "job-1" },
  );

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
  assert.equal(attempt?.failureMessage, "Transaction retry limit exhausted");
  assert.equal(job?.state, "FAILED");
});

test("retry scheduling cannot reopen a succeeded attempt", async () => {
  await db
    .update(executionAttempts)
    .set({ state: "SUCCEEDED" })
    .where(eq(executionAttempts.id, "attempt-1"));
  await db
    .update(mintJobs)
    .set({ state: "SUCCEEDED" })
    .where(eq(mintJobs.id, "job-1"));

  assert.equal(await scheduleExecutionRetry("attempt-1"), null);

  const [attempt] = await db
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.id, "attempt-1"));
  const [job] = await db
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.id, "job-1"));

  assert.equal(attempt?.state, "SUCCEEDED");
  assert.equal(job?.state, "SUCCEEDED");
});
