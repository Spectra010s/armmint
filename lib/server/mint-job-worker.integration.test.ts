import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";

import {
  executionAttempts,
  mintJobs,
  users,
  wallets,
} from "@/lib/db/schema";

const client = new PGlite();
const db = drizzle(client);
const databaseMock = mock.module("@/lib/db", { exports: { db } });

const { claimNextDueMintJob } = await import("./mint-job-claim.ts");
const { releaseExpiredMintJobClaims } = await import("./mint-job-recovery.ts");
const { startExecutionAttempt } = await import("./mint-job-lifecycle.ts");

before(async () => {
  const schema = await pushSchema(
    { users, wallets, mintJobs, executionAttempts },
    db,
  );
  await schema.apply();
});

beforeEach(async () => {
  await db.delete(executionAttempts);
  await db.delete(mintJobs);
  await db.delete(wallets);
  await db.delete(users);

  await db.insert(users).values({
    id: "user-1",
    name: "Worker Test",
    email: "worker@example.test",
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
});

after(async () => {
  databaseMock.restore();
  await client.close();
});

async function insertJob(
  id: string,
  scheduledFor: Date,
  overrides: Partial<typeof mintJobs.$inferInsert> = {},
) {
  await db.insert(mintJobs).values({
    id,
    userId: "user-1",
    walletId: "wallet-1",
    chainId: 84532,
    contractAddress: "0xcontract",
    scheduledFor,
    idempotencyKey: `idem-${id}`,
    ...overrides,
  });
}

test("only one competing worker claims a due job", async () => {
  const now = new Date("2026-09-22T12:00:00Z");
  await insertJob("job-1", new Date(now.getTime() - 1_000));

  const [first, second] = await Promise.all([
    claimNextDueMintJob("worker-a", now),
    claimNextDueMintJob("worker-b", now),
  ]);

  const claims = [first, second].filter(Boolean);
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.id, "job-1");
  assert.ok(["worker-a", "worker-b"].includes(claims[0]?.claimedBy ?? ""));
});

test("claims due jobs in scheduled order and ignores future jobs", async () => {
  const now = new Date("2026-09-22T12:00:00Z");
  await insertJob("future", new Date(now.getTime() + 60_000));
  await insertJob("later", new Date(now.getTime() - 1_000));
  await insertJob("earlier", new Date(now.getTime() - 5_000));

  const first = await claimNextDueMintJob("worker-a", now);
  const second = await claimNextDueMintJob("worker-a", now);
  const third = await claimNextDueMintJob("worker-a", now);

  assert.equal(first?.id, "earlier");
  assert.equal(second?.id, "later");
  assert.equal(third, null);
});

test("expired claims are recoverable after a worker restart", async () => {
  const claimedAt = new Date("2026-09-22T11:58:00Z");
  const expiredAt = new Date("2026-09-22T11:59:00Z");
  const restartAt = new Date("2026-09-22T12:00:00Z");

  await insertJob("abandoned", claimedAt, {
    state: "CLAIMED",
    claimedAt,
    claimedBy: "dead-worker",
    claimExpiresAt: expiredAt,
  });

  const released = await releaseExpiredMintJobClaims(restartAt);
  assert.deepEqual(released, [{ id: "abandoned" }]);

  const recovered = await claimNextDueMintJob("replacement-worker", restartAt);
  assert.equal(recovered?.id, "abandoned");
  assert.equal(recovered?.claimedBy, "replacement-worker");
  assert.ok(recovered?.claimExpiresAt);
});

test("active leases are not stolen during recovery", async () => {
  const now = new Date("2026-09-22T12:00:00Z");
  await insertJob("active", new Date(now.getTime() - 60_000), {
    state: "CLAIMED",
    claimedAt: new Date(now.getTime() - 1_000),
    claimedBy: "healthy-worker",
    claimExpiresAt: new Date(now.getTime() + 30_000),
  });

  assert.deepEqual(await releaseExpiredMintJobClaims(now), []);
  assert.equal(await claimNextDueMintJob("other-worker", now), null);
});

test("execution attempts remain auditable across retries", async () => {
  const now = new Date("2026-09-22T12:00:00Z");
  await insertJob("job-retry", new Date(now.getTime() - 1_000));

  const first = await startExecutionAttempt("job-retry", now);
  const second = await startExecutionAttempt(
    "job-retry",
    new Date(now.getTime() + 1_000),
  );

  assert.equal(first?.attemptNumber, 1);
  assert.equal(second?.attemptNumber, 2);

  const attempts = await db.select().from(executionAttempts);
  assert.deepEqual(
    attempts.map((attempt) => attempt.attemptNumber).sort(),
    [1, 2],
  );
});
