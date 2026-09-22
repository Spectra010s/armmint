import "server-only";

import { beginConfirmation, completeConfirmedExecution } from "./completion";
import { TransactionEngineError } from "./errors";
import { failExecution } from "./failure";
import {
  findRecoverableTransaction,
  markTransactionSubmitted,
  markTransactionTerminal,
  reserveTransaction,
} from "./store";
import type {
  TransactionChainAdapter,
  TransactionReceiptResult,
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

  if (existing?.hash) {
    const receipt = await adapter.waitForReceipt(existing.hash as `0x${string}`);
    await persistReceipt(existing.id, receipt);
    return { transactionId: existing.id, hash: existing.hash, recovered: true };
  }

  if (existing && !existing.hash) {
    throw new TransactionEngineError(
      "SUBMISSION_FAILED",
      "A reserved transaction exists without a persisted hash",
      true,
    );
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

  const persisted = await markTransactionSubmitted(transaction.id, submitted.hash);
  if (!persisted) {
    throw new TransactionEngineError(
      "SUBMISSION_FAILED",
      "Submitted transaction could not be persisted",
      true,
    );
  }

  const receipt = await adapter.waitForReceipt(submitted.hash);
  await persistReceipt(transaction.id, receipt);

  return {
    transactionId: transaction.id,
    hash: submitted.hash,
    recovered: false,
  };
}

async function persistReceipt(
  transactionId: string,
  receipt: TransactionReceiptResult,
) {
  if (receipt.state === "CONFIRMED") {
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

  const message = receipt.reason ?? "Transaction reverted";
  await failExecution(
    transactionId,
    { code: "REVERTED", message },
    "REVERTED",
  );
  throw new TransactionEngineError("REVERTED", message, false);
}
