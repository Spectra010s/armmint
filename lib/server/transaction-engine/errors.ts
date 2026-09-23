export type TransactionFailureCode =
  | "INVALID_EXECUTION"
  | "SIGNING_FAILED"
  | "LEASE_LOST"
  | "RPC_FAILED"
  | "SIMULATION_FAILED"
  | "NONCE_CONFLICT"
  | "SUBMISSION_FAILED"
  | "CONFIRMATION_FAILED"
  | "REVERTED"
  | "RETRY_EXHAUSTED";

export class TransactionEngineError extends Error {
  readonly code: TransactionFailureCode;
  readonly retryable: boolean;

  constructor(
    code: TransactionFailureCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "TransactionEngineError";
  }
}
