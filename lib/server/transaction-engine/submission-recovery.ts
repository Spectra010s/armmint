export type SubmissionRecoveryDecision =
  | { kind: "await"; hash: `0x${string}` }
  | { kind: "retry-same-nonce"; nonce: number };

export function recoverSubmission(
  transaction: { hash: string | null; nonce: number },
): SubmissionRecoveryDecision {
  if (transaction.hash) {
    return { kind: "await", hash: transaction.hash as `0x${string}` };
  }

  return { kind: "retry-same-nonce", nonce: transaction.nonce };
}
