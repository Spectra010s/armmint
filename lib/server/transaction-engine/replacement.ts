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

export function buildReplacementRequest<T extends {
  nonce: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}>(request: T, gasBumpBps: number): T {
  if (
    request.maxFeePerGas === undefined ||
    request.maxPriorityFeePerGas === undefined
  ) {
    throw new Error("Replacement transaction requires EIP-1559 fee fields");
  }

  return {
    ...request,
    ...buildReplacementFees(
      {
        maxFeePerGas: request.maxFeePerGas,
        maxPriorityFeePerGas: request.maxPriorityFeePerGas,
      },
      gasBumpBps,
    ),
  };
}
