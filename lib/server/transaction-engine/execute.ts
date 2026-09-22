import "server-only";

import { beginConfirmation, completeConfirmedExecution } from "./completion";
import { observeTransaction } from "./confirmation";
import { TransactionEngineError } from "./errors";
import { failExecution } from "./failure";
import { recoverSubmission } from "./submission-recovery";
import { scheduleExecutionRetry } from "./retry-state";
import {
  findRecoverableTransaction,
  markTransactionSubmitted,
  reserveTransaction,
} from "./store";
import type {
  TransactionChainAdapter,
  TransactionRequest,
} from "./types";

export type ExecuteTransactionInput = {
  mintJobId: string;
  executionAttemptId: string;
  request: TransactionRequest;
};

export async function executeTransaction(
  adapter: TransactionChainAdapter,
  input: ExecuteTransactionInput,
) {
  const existing = await findRecoverableTransaction(input.mintJobId);

  if (existing) {
    const recovery = recoverSubmission(existing);

    if (recovery.kind === "await") {
      const outcome = await observeTransaction(adapter, recovery.hash);
      await persistOutcome(existing.id, existing.executionAttemptId, outcome);
      return { transactionId: existing.id, hash: recovery.hash, recovered: true };
    }

    let submitted;
    try {
      submitted = await adapter.submit({ ...input.request, nonce: recovery.nonce });
    } catch {
      throw new TransactionEngineError(
        "SUBMISSION_FAILED",
        "Transaction resubmission failed",
        true,
      );
    }

    assertSubmittedNonce(recovery.nonce, submitted.nonce);

    const persisted = await markTransactionSubmitted(existing.id, submitted.hash);
    if (!persisted) {
      throw new TransactionEngineError(
        "SUBMISSION_FAILED",
        "Recovered transaction could not be persisted",
        true,
      );
    }

    const outcome = await observeTransaction(adapter, submitted.hash);
    await persistOutcome(existing.id, existing.executionAttemptId, outcome);
    return { transactionId: existing.id, hash: submitted.hash, recovered: true };
  }

  try {
    await adapter.simulate(input.request);
  } catch {
    throw new TransactionEngineError(
      "SIMULATION_FAILED",
      "Transaction simulation failed",
      false,
    );
  }

  const nonce = await adapter.getPendingNonce(input.request.from);
  const transaction = await reserveTransaction(
    input.executionAttemptId,
    input.request.chainId,
    nonce,
  );

  let submitted;
  try {
    submitted = await adapter.submit({ ...input.request, nonce });
  } catch {
    throw new TransactionEngineError(
      "SUBMISSION_FAILED",
      "Transaction submission failed",
      true,
    );
  }

  assertSubmittedNonce(nonce, submitted.nonce);

  const persisted = await markTransactionSubmitted(transaction.id, submitted.hash);
  if (!persisted) {
    throw new TransactionEngineError(
      "SUBMISSION_FAILED",
      "Submitted transaction could not be persisted",
      true,
    );
  }

  const outcome = await observeTransaction(adapter, submitted.hash);
  await persistOutcome(transaction.id, input.executionAttemptId, outcome);

  return {
    transactionId: transaction.id,
    hash: submitted.hash,
    recovered: false,
  };
}

async function persistOutcome(
  transactionId: string,
  executionAttemptId: string,
  outcome: Awaited<ReturnType<typeof observeTransaction>>,
) {
  if (outcome.kind === "confirmed") {
    await beginConfirmation(transactionId);
    const completed = await completeConfirmedExecution(transactionId);
    if (!completed) {
      throw new TransactionEngineError(
        "CONFIRMATION_FAILED",
        "Confirmed transaction could not complete its execution state",
        true,
      );
    }
    return;
  }

  if (outcome.kind === "dropped") {
    const message = "Submitted transaction could not be found";
    const retry = await scheduleExecutionRetry(executionAttemptId);
    if (!retry) {
      throw new TransactionEngineError(
        "CONFIRMATION_FAILED",
        "Dropped transaction could not schedule a retry",
        true,
      );
    }
    if (retry.kind === "exhausted") {
      throw new TransactionEngineError(
        "RETRY_EXHAUSTED",
        "Transaction retry limit exhausted",
        false,
      );
    }
    throw new TransactionEngineError("CONFIRMATION_FAILED", message, true);
  }

  const message = outcome.reason ?? "Transaction reverted";
  await failExecution(
    transactionId,
    { code: "REVERTED", message },
    "REVERTED",
  );
  throw new TransactionEngineError("REVERTED", message, false);
}

function assertSubmittedNonce(expected: number, actual: number) {
  if (expected !== actual) {
    throw new TransactionEngineError(
      "NONCE_CONFLICT",
      `Transaction submission returned nonce ${actual}; expected ${expected}`,
      false,
    );
  }
}
