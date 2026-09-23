export type RetryPolicy = {
  maxAttempts: number;
  gasBumpBps: number;
  replacementAfterMs?: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  gasBumpBps: 1_250,
  replacementAfterMs: 120_000,
};

export function shouldRetry(
  attemptNumber: number,
  policy = DEFAULT_RETRY_POLICY,
) {
  if (
    !Number.isSafeInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    !Number.isSafeInteger(policy.gasBumpBps) ||
    policy.gasBumpBps < 0 ||
    policy.gasBumpBps > 10_000
  ) {
    throw new Error("Invalid transaction retry policy");
  }
  return attemptNumber < policy.maxAttempts;
}

export function bumpFee(value: bigint, gasBumpBps: number) {
  if (
    !Number.isSafeInteger(gasBumpBps) ||
    gasBumpBps < 0 ||
    gasBumpBps > 10_000
  )
    throw new Error("Gas bump must be non-negative");
  return (value * BigInt(10_000 + gasBumpBps) + 9_999n) / 10_000n;
}
