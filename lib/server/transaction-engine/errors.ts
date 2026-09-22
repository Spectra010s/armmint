export type TransactionFailureCode =
  | "SIMULATION_FAILED"
  | "NONCE_CONFLICT"
  | "SUBMISSION_FAILED"
  | "CONFIRMATION_FAILED"
  | "REVERTED"
  | "RETRY_EXHAUSTED";

export class TransactionEngineError extends Error {
  constructor(
    public readonly code: TransactionFailureCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "TransactionEngineError";
  }
}
