import { bumpFee } from "./retry";

export type ReplacementFees = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export function buildReplacementFees(
  previous: ReplacementFees,
  gasBumpBps: number,
): ReplacementFees {
  return {
    maxFeePerGas: bumpFee(previous.maxFeePerGas, gasBumpBps),
    maxPriorityFeePerGas: bumpFee(
      previous.maxPriorityFeePerGas,
      gasBumpBps,
    ),
  };
}

export function assertReplacementNonce(
  originalNonce: number,
  replacementNonce: number,
) {
  if (replacementNonce !== originalNonce) {
    throw new Error("Replacement transaction must reuse the original nonce");
  }
}
