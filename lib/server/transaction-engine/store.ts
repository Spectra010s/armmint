import "server-only";
import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  isNotNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  executionAttempts,
  mintJobs,
  transactions,
  wallets,
} from "@/lib/db/schema";
import { ACTIVE_JOB_STATES, lockExecution } from "./guards";
import { TransactionEngineError } from "./errors";
import type { PreparedTransaction } from "./types";

export const ENGINE_LEASE_MS = 60_000;
// Proof-based stall bound: Ethereum nonces are sequential, so latest > reserved
// proves the reserved nonce was already mined by a different transaction.
// The grace period absorbs receipt lag before declaring our hash unmineable.
export const NONCE_CONSUMED_GRACE_MS = 5 * 60_000;

export async function findJobTransactions(jobId: string) {
  return db
    .select({ transaction: transactions })
    .from(transactions)
    .innerJoin(
      executionAttempts,
      eq(transactions.executionAttemptId, executionAttempts.id),
    )
    .where(eq(executionAttempts.mintJobId, jobId))
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .then((rows) => rows.map((row) => row.transaction));
}
export async function findRecoverableTransaction(jobId: string) {
  return (
    (await findJobTransactions(jobId)).find((row) =>
      ["CREATED", "SUBMITTED", "CONFIRMING"].includes(row.state),
    ) ?? null
  );
}

export function encodeRequest(
  request: PreparedTransaction,
): NonNullable<typeof transactions.$inferSelect.request> {
  if (
    request.gas === undefined ||
    request.maxFeePerGas === undefined ||
    request.maxPriorityFeePerGas === undefined
  ) {
    throw new TransactionEngineError(
      "INVALID_EXECUTION",
      "Transaction gas and fees must be prepared",
    );
  }
  return {
    from: request.from,
    to: request.to,
    data: request.data,
    value: String(request.value ?? 0n),
    gas: String(request.gas),
    maxFeePerGas: String(request.maxFeePerGas),
    maxPriorityFeePerGas: String(request.maxPriorityFeePerGas),
  };
}
export function decodeRequest(
  row: typeof transactions.$inferSelect,
): PreparedTransaction {
  if (!row.request)
    throw new TransactionEngineError(
      "INVALID_EXECUTION",
      "Persisted transaction request is unavailable",
    );
  return {
    chainId: row.chainId,
    nonce: row.nonce,
    from: row.request.from as `0x${string}`,
    to: row.request.to as `0x${string}`,
    data: row.request.data as `0x${string}`,
    value: BigInt(row.request.value),
    gas: BigInt(row.request.gas),
    maxFeePerGas: BigInt(row.request.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(row.request.maxPriorityFeePerGas),
  };
}

export async function reserveTransaction(
  attemptId: string,
  chainId: number,
  pendingNonce: number,
  now = new Date(),
  request?: PreparedTransaction,
) {
  if (!Number.isSafeInteger(pendingNonce) || pendingNonce < 0)
    throw new TransactionEngineError("NONCE_CONFLICT", "Invalid pending nonce");
  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select({ walletId: mintJobs.walletId })
      .from(executionAttempts)
      .innerJoin(mintJobs, eq(executionAttempts.mintJobId, mintJobs.id))
      .where(eq(executionAttempts.id, attemptId));
    if (!ref)
      throw new TransactionEngineError(
        "INVALID_EXECUTION",
        "Execution not found",
      );
    // Serialize reservations for this wallet across jobs and worker processes.
    await tx
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.id, ref.walletId))
      .for("update");
    const context = await lockExecution(tx, attemptId);
    if (!context || context.job.chainId !== chainId)
      throw new TransactionEngineError(
        "LEASE_LOST",
        "Execution is no longer active",
      );
    const existing = await tx
      .select({ transaction: transactions })
      .from(transactions)
      .innerJoin(
        executionAttempts,
        eq(transactions.executionAttemptId, executionAttempts.id),
      )
      .where(eq(executionAttempts.mintJobId, context.job.id))
      .orderBy(desc(transactions.createdAt), desc(transactions.id))
      .limit(1);
    if (existing[0]) return existing[0].transaction;
    const reserved = await tx
      .select({ nonce: transactions.nonce })
      .from(transactions)
      .innerJoin(
        executionAttempts,
        eq(transactions.executionAttemptId, executionAttempts.id),
      )
      .innerJoin(mintJobs, eq(executionAttempts.mintJobId, mintJobs.id))
      .where(
        and(
          eq(mintJobs.walletId, ref.walletId),
          eq(transactions.chainId, chainId),
          or(
            isNotNull(transactions.hash),
            notInArray(mintJobs.state, ["FAILED", "CANCELLED"]),
          ),
        ),
      );
    // An unsigned terminal job cannot broadcast after its guard fails. Its gap
    // may be reused; signed/ambiguous reservations are never released.
    const occupied = new Set(reserved.map((row) => row.nonce));
    let nonce = pendingNonce;
    while (occupied.has(nonce)) nonce++;
    if (!Number.isSafeInteger(nonce))
      throw new TransactionEngineError(
        "NONCE_CONFLICT",
        "Nonce exceeds supported range",
      );
    const [row] = await tx
      .insert(transactions)
      .values({
        id: randomUUID(),
        executionAttemptId: attemptId,
        chainId,
        nonce,
        request: request ? encodeRequest({ ...request, nonce }) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row;
  });
}

export async function checkpointSignedHash(
  id: string,
  hash: string,
  leaseId: string,
) {
  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));
    if (!ref) return false;
    const context = await lockExecution(tx, ref.executionAttemptId);
    if (
      !context ||
      context.job.engineLeaseId !== leaseId ||
      !context.job.engineLeaseExpiresAt ||
      context.job.engineLeaseExpiresAt <= new Date()
    )
      return false;
    const [row] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .for("update");
    if (row.state !== "CREATED" || (row.hash && row.hash !== hash))
      return false;
    await tx
      .update(transactions)
      .set({ hash, submittedAt: row.submittedAt ?? new Date() })
      .where(eq(transactions.id, id));
    return true;
  });
}

export async function markTransactionSubmitted(
  id: string,
  hash: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));
    if (!ref || !(await lockExecution(tx, ref.executionAttemptId))) return null;
    const [row] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .for("update");
    if (
      !["CREATED", "SUBMITTED"].includes(row.state) ||
      (row.hash && row.hash !== hash)
    )
      return null;
    const [updated] = await tx
      .update(transactions)
      .set({
        hash,
        state: "SUBMITTED",
        submittedAt: row.submittedAt ?? now,
        updatedAt: now,
      })
      .where(eq(transactions.id, id))
      .returning();
    if (row.replacesTransactionId) {
      await tx
        .update(transactions)
        .set({ state: "REPLACED", updatedAt: now })
        .where(
          and(
            eq(transactions.id, row.replacesTransactionId),
            inArray(transactions.state, [
              "CREATED",
              "SUBMITTED",
              "CONFIRMING",
              "DROPPED",
            ]),
          ),
        );
    }
    const [attempt] = await tx
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.id, row.executionAttemptId));
    await tx
      .update(mintJobs)
      .set({ state: "SUBMITTED", updatedAt: now })
      .where(eq(mintJobs.id, attempt.mintJobId));
    return updated;
  });
}

export async function markTransactionTerminal(
  id: string,
  state: "CONFIRMED" | "REVERTED" | "DROPPED",
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));
    if (!ref || !(await lockExecution(tx, ref.executionAttemptId))) return null;
    const [row] = await tx
      .update(transactions)
      .set({ state, updatedAt: now })
      .where(
        and(
          eq(transactions.id, id),
          inArray(transactions.state, ["CREATED", "SUBMITTED", "CONFIRMING"]),
        ),
      )
      .returning();
    return row ?? null;
  });
}

export async function reserveReplacementTransaction(
  originalId: string,
  attemptId: string,
  chainId: number,
  nonce: number,
  now = new Date(),
  request?: PreparedTransaction,
) {
  return db.transaction(async (tx) => {
    const context = await lockExecution(tx, attemptId);
    if (!context)
      throw new TransactionEngineError(
        "LEASE_LOST",
        "Execution is no longer active",
      );
    const [original] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, originalId))
      .for("update");
    if (!original)
      throw new TransactionEngineError(
        "INVALID_EXECUTION",
        "Transaction to replace was not found",
      );
    if (original.nonce !== nonce)
      throw new TransactionEngineError(
        "NONCE_CONFLICT",
        "Replacement transaction must reuse the original nonce",
      );
    // Only a signed (broadcast or checkpointed) transaction may be replaced.
    // Forking an unsigned reservation would create two signable rows sharing
    // one nonce; only checkpoint/submit guards would stop a double broadcast.
    if (!original.hash)
      throw new TransactionEngineError(
        "INVALID_EXECUTION",
        "Only a signed transaction can be replaced",
      );
    if (
      original.executionAttemptId !== attemptId ||
      original.chainId !== chainId ||
      ["CONFIRMED", "REVERTED"].includes(original.state)
    ) {
      throw new TransactionEngineError(
        "INVALID_EXECUTION",
        "Replacement does not match active execution",
      );
    }
    const [existing] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.replacesTransactionId, originalId));
    if (existing) return existing;
    const [replacement] = await tx
      .insert(transactions)
      .values({
        id: randomUUID(),
        executionAttemptId: attemptId,
        replacesTransactionId: originalId,
        chainId,
        nonce,
        request: request ? encodeRequest(request) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return replacement;
  });
}
export async function markReplacementSubmitted(
  id: string,
  hash: string,
  now = new Date(),
) {
  return markTransactionSubmitted(id, hash, now);
}

export async function acquireExecutionLease(
  jobId: string,
  attemptId: string,
  now = new Date(),
  leaseMs = ENGINE_LEASE_MS,
) {
  return db.transaction(async (tx) => {
    const context = await lockExecution(tx, attemptId);
    if (!context || context.job.id !== jobId) return null;
    const id = randomUUID();
    const [job] = await tx
      .update(mintJobs)
      .set({
        engineLeaseId: id,
        engineLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        // Hold the claim while the engine owns the job so a second worker
        // cannot satisfy the claim query's both-leases-expired condition
        // mid-execution. The heartbeat below keeps both fresh.
        claimExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      })
      .where(
        and(
          eq(mintJobs.id, jobId),
          or(
            isNull(mintJobs.engineLeaseExpiresAt),
            lt(mintJobs.engineLeaseExpiresAt, now),
          ),
        ),
      )
      .returning();
    return job ? { id, context } : null;
  });
}
// Heartbeat: extend an owned, unexpired lease before long RPC waits so a
// second worker cannot steal mid-waitForReceipt. Returns null when the lease
// is no longer ours (caller must stop before any external side effect).
export async function renewExecutionLease(
  jobId: string,
  leaseId: string,
  now = new Date(),
  leaseMs = ENGINE_LEASE_MS,
) {
  const [job] = await db
    .update(mintJobs)
    .set({
      engineLeaseExpiresAt: new Date(now.getTime() + leaseMs),
      claimExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    })
    .where(
      and(
        eq(mintJobs.id, jobId),
        eq(mintJobs.engineLeaseId, leaseId),
        inArray(mintJobs.state, ACTIVE_JOB_STATES),
        gt(mintJobs.engineLeaseExpiresAt, now),
      ),
    )
    .returning({ id: mintJobs.id });
  return job ?? null;
}
export async function releaseExecutionLease(jobId: string, leaseId: string) {
  await db
    .update(mintJobs)
    .set({ engineLeaseId: null, engineLeaseExpiresAt: null })
    .where(and(eq(mintJobs.id, jobId), eq(mintJobs.engineLeaseId, leaseId)));
}
export async function setExecutionStage(
  jobId: string,
  leaseId: string,
  state: (typeof ACTIVE_JOB_STATES)[number],
) {
  const [job] = await db
    .update(mintJobs)
    .set({ state, updatedAt: new Date() })
    .where(
      and(
        eq(mintJobs.id, jobId),
        eq(mintJobs.engineLeaseId, leaseId),
        inArray(mintJobs.state, ACTIVE_JOB_STATES),
        // Expired executors must stop before any external side effect.
        gt(mintJobs.engineLeaseExpiresAt, new Date()),
      ),
    )
    .returning();
  if (!job)
    throw new TransactionEngineError("LEASE_LOST", "Execution lease lost");
}

export async function recordNonceConflict(attemptId: string) {
  return db.transaction(async (tx) => {
    const context = await lockExecution(tx, attemptId);
    if (!context) return;
    await tx
      .update(executionAttempts)
      .set({
        failureCode: "NONCE_CONFLICT",
        failureMessage: "Account nonce advanced; awaiting a candidate receipt",
      })
      .where(eq(executionAttempts.id, attemptId));
    await tx
      .update(mintJobs)
      .set({ state: "CONFIRMING" })
      .where(eq(mintJobs.id, context.job.id));
  });
}
