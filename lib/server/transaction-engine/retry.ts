export type RetryPolicy = {
  maxAttempts: number;
  gasBumpBps: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  gasBumpBps: 1_250,
};

export function shouldRetry(attemptNumber: number, policy = DEFAULT_RETRY_POLICY) {
  return attemptNumber < policy.maxAttempts;
}

export function bumpFee(value: bigint, gasBumpBps: number) {
  if (gasBumpBps < 0) throw new Error("Gas bump must be non-negative");
  return (value * BigInt(10_000 + gasBumpBps) + 9_999n) / 10_000n;
}
