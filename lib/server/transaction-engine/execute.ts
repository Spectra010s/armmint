import "server-only";
import { beginConfirmation, completeConfirmedExecution } from "./completion";
import { TransactionEngineError } from "./errors";
import { failExecution, failUnsubmittedExecution } from "./failure";
import { buildReplacementRequest } from "./replacement";
import { DEFAULT_RETRY_POLICY, shouldRetry, type RetryPolicy } from "./retry";
import { scheduleExecutionRetry } from "./retry-state";
import {
  acquireExecutionLease,
  checkpointSignedHash,
  decodeRequest,
  findJobTransactions,
  markTransactionSubmitted,
  NONCE_CONSUMED_GRACE_MS,
  recordNonceConflict,
  releaseExecutionLease,
  renewExecutionLease,
  reserveReplacementTransaction,
  reserveTransaction,
  setExecutionStage,
} from "./store";
import type { TransactionChainAdapter, TransactionRequest } from "./types";

export type ExecuteTransactionInput = {
  mintJobId: string;
  executionAttemptId: string;
  request: TransactionRequest;
};

export async function executeTransaction(
  adapter: TransactionChainAdapter,
  input: ExecuteTransactionInput,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
) {
  shouldRetry(1, policy); // Validate policy before doing work.
  const lease = await acquireExecutionLease(
    input.mintJobId,
    input.executionAttemptId,
  );
  if (!lease) return { status: "inactive" as const };
  // Heartbeat before every long RPC so a second worker can never satisfy the
  // claim query's both-leases-expired condition mid-execution. Losing the
  // lease aborts before any signing side effect (checkpoint enforces it too).
  const renew = async () => {
    const held = await renewExecutionLease(input.mintJobId, lease.id);
    if (!held)
      throw new TransactionEngineError(
        "LEASE_LOST",
        "Execution is no longer active",
      );
  };
  const stage = (state: Parameters<typeof setExecutionStage>[2]) =>
    setExecutionStage(input.mintJobId, lease.id, state);
  try {
    let rows = await findJobTransactions(input.mintJobId);
    if (lease.context.job.chainId !== input.request.chainId || rows.some((row) => row.chainId !== input.request.chainId))
      throw new TransactionEngineError("INVALID_EXECUTION", "Persisted transaction network does not match job");
    const recovered = rows.length > 0;
    // Observe every signed candidate, including an original replaced locally.
    // A miner may include the original while the replacement is in flight.
    for (const row of rows) {
      if (!row.hash || ["REVERTED", "DROPPED"].includes(row.state)) continue;
      await renew();
      const receipt = await adapter.waitForReceipt(row.hash as `0x${string}`);
      if (receipt.state === "CONFIRMED") {
        if (!(await completeConfirmedExecution(row.id)))
          return { status: "inactive" as const };
        return {
          status: "confirmed" as const,
          transactionId: row.id,
          hash: row.hash,
          recovered,
        };
      }
      if (receipt.state === "REVERTED") {
        await failExecution(
          row.id,
          { code: "REVERTED", message: "Mint transaction reverted on chain" },
          "REVERTED",
        );
        return {
          status: "reverted" as const,
          transactionId: row.id,
          hash: row.hash,
          recovered,
        };
      }
    }
    let transaction = rows.find((row) =>
      ["CREATED", "SUBMITTED", "CONFIRMING"].includes(row.state),
    );
    if (rows.length && !transaction) return { status: "inactive" as const };
    if (
      transaction &&
      adapter.getLatestNonce &&
      (await (async () => {
        await renew();
        return adapter.getLatestNonce!(input.request.from);
      })()) > transaction.nonce
    ) {
      // Receipts can lag the latest nonce. Nonces are sequential, so latest >
      // reserved proves the reservation was consumed by a different
      // transaction — but only after a grace period. Before that, stop signing
      // and let subsequent receipt polls resolve it.
      await recordNonceConflict(input.executionAttemptId);
      const age =
        Date.now() -
        (transaction.submittedAt ?? transaction.createdAt).getTime();
      if (age > NONCE_CONSUMED_GRACE_MS) {
        // Proven unmineable: the network already mined this nonce without our
        // hash. Drop the reservation (hash retained, nonce stays occupied so
        // future jobs skip it) and fail closed. No duplicate mint is possible:
        // our hash can never be included under a consumed nonce.
        await failExecution(
          transaction.id,
          {
            code: "NONCE_CONSUMED",
            message:
              "Account nonce advanced past the reserved nonce; reserved transaction can never mine",
          },
          "DROPPED",
        );
        return {
          status: "dropped" as const,
          transactionId: transaction.id,
        };
      }
      return {
        status: "nonce_consumed" as const,
        transactionId: transaction.id,
      };
    }
    const attemptsUsed =
      lease.context.attempt.attemptNumber + lease.context.attempt.retryCount;
    if (
      transaction?.hash &&
      transaction.state === "CREATED" &&
      adapter.isKnown &&
      (await (async () => {
        await renew();
        return adapter.isKnown!(transaction!.hash as `0x${string}`);
      })())
    ) {
      await markTransactionSubmitted(transaction.id, transaction.hash);
      rows = await findJobTransactions(input.mintJobId);
      transaction = rows.find((row) => row.id === transaction!.id)!;
    }
    if (transaction?.hash && transaction.state !== "CREATED") {
      await beginConfirmation(transaction.id);
      const age =
        Date.now() -
        (transaction.submittedAt ?? transaction.createdAt).getTime();
      if (age < (policy.replacementAfterMs ?? 120_000))
        return { status: "pending" as const, transactionId: transaction.id };
      const retry = await scheduleExecutionRetry(
        input.executionAttemptId,
        policy,
        new Date(),
        true,
      );
      if (retry?.kind !== "scheduled")
        return {
          status: "retry_exhausted" as const,
          transactionId: transaction.id,
        };
      const request = buildReplacementRequest(
        decodeRequest(transaction),
        policy.gasBumpBps,
      );
      await stage("SIMULATING");
      await renew();
      await adapter.simulate(request);
      transaction = await reserveReplacementTransaction(
        transaction.id,
        input.executionAttemptId,
        request.chainId,
        request.nonce,
        new Date(),
        request,
      );
    } else if (lease.context.attempt.failureCode === "RETRY_EXHAUSTED") {
      return { status: "retry_exhausted" as const };
    } else if (!transaction) {
      await stage("SIMULATING");
      await renew();
      const request = adapter.prepare
        ? await adapter.prepare(input.request)
        : input.request;
      await adapter.simulate(request);
      await renew();
      const pendingNonce = await adapter.getPendingNonce(request.from);
      transaction = await reserveTransaction(
        input.executionAttemptId,
        request.chainId,
        pendingNonce,
        new Date(),
        { ...request, nonce: pendingNonce },
      );
    }
    if (!transaction) return { status: "inactive" as const };
    const request = decodeRequest(transaction);
    // Recovery of an unsigned or ambiguously broadcast transaction uses exactly
    // its persisted request. Never let a refreshed job or fee quote change it.
    await stage("SIMULATING");
    await renew();
    await adapter.simulate(request);
    await stage("SIGNING");
    await renew();
    const submitted = await adapter.submit(request, async (hash) => {
      await stage("SUBMITTING");
      if (!(await checkpointSignedHash(transaction!.id, hash, lease.id)))
        throw new TransactionEngineError(
          "LEASE_LOST",
          "Execution is no longer active",
        );
    });
    if (submitted.nonce !== request.nonce)
      throw new TransactionEngineError(
        "NONCE_CONFLICT",
        "Signer changed reserved nonce",
      );
    const persisted = await markTransactionSubmitted(
      transaction.id,
      submitted.hash,
    );
    if (!persisted) return { status: "inactive" as const };
    await renew();
    const receipt = await adapter.waitForReceipt(submitted.hash);
    if (receipt.state === "CONFIRMED")
      await completeConfirmedExecution(transaction.id);
    else if (receipt.state === "REVERTED")
      await failExecution(
        transaction.id,
        { code: "REVERTED", message: "Mint transaction reverted on chain" },
        "REVERTED",
      );
    else await beginConfirmation(transaction.id);
    return {
      status: receipt.state.toLowerCase(),
      transactionId: transaction.id,
      hash: submitted.hash,
      recovered,
      attemptsUsed,
    };
  } catch (error) {
    // Only stable, locally defined messages cross the engine boundary.
    const safe =
      error instanceof TransactionEngineError
        ? error
        : new TransactionEngineError(
            "RPC_FAILED",
            "Transaction execution interrupted",
            true,
          );
    if (safe.code === "LEASE_LOST") return { status: "inactive" as const };
    const rows = await findJobTransactions(input.mintJobId);
    const mayBeOnChain = rows.some((row) => row.hash);
    if (!safe.retryable && !mayBeOnChain) {
      await failUnsubmittedExecution(
        input.executionAttemptId,
        safe.code,
        safe.message,
      );
      return { status: "failed" as const, code: safe.code };
    }
    const retry = await scheduleExecutionRetry(
      input.executionAttemptId,
      policy,
      new Date(),
      mayBeOnChain,
    );
    return {
      status: retry?.kind === "exhausted" ? "retry_exhausted" : "retrying",
      code: safe.code,
    };
  } finally {
    await releaseExecutionLease(input.mintJobId, lease.id);
  }
}
