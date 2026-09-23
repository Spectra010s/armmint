import assert from "node:assert/strict";
import test from "node:test";

import type { TransactionChainAdapter } from "./types.ts";
import { createTransactionEngine } from "./engine.ts";

test("claimed-job engine rejects mismatched loader results before execution", async () => {
  const adapter = {} as TransactionChainAdapter;
  const engine = createTransactionEngine(adapter, async () => ({
    jobId: "different-job",
    executionAttemptId: "attempt-1",
    request: {
      chainId: 84532,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      data: "0x",
    },
  }));

  await assert.rejects(
    engine.executeClaimedJob("job-1"),
    /does not match requested job/,
  );
});
