export type NonceDecision =
  | { kind: "reserve"; nonce: number }
  | { kind: "reuse"; nonce: number; transactionId: string };

export function decideNonce(
  pendingNonce: number,
  existing?: { id: string; nonce: number } | null,
): NonceDecision {
  if (existing) {
    return { kind: "reuse", nonce: existing.nonce, transactionId: existing.id };
  }

  if (!Number.isSafeInteger(pendingNonce) || pendingNonce < 0) {
    throw new Error("Pending nonce must be a non-negative safe integer");
  }

  return { kind: "reserve", nonce: pendingNonce };
}
