import assert from "node:assert/strict";
import test from "node:test";

import { TransactionEngineError } from "./errors.ts";
import type {
  PreparedTransaction,
  TransactionChainAdapter,
  TransactionRequest,
} from "./types.ts";

const request: TransactionRequest = {
  chainId: 84532,
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  data: "0x",
};

class FakeAdapter implements TransactionChainAdapter {
  simulations = 0;
  submissions: PreparedTransaction[] = [];

  async simulate() {
    this.simulations += 1;
  }

  async getPendingNonce() {
    return 7;
  }

  async submit(prepared: PreparedTransaction) {
    this.submissions.push(prepared);
    return {
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
      nonce: prepared.nonce,
    };
  }

  async waitForReceipt(hash: `0x${string}`) {
    return { state: "CONFIRMED" as const, hash };
  }
}

test("adapter contract keeps simulation before submission", async () => {
  const adapter = new FakeAdapter();
  await adapter.simulate(request);
  const nonce = await adapter.getPendingNonce(request.from);
  await adapter.submit({ ...request, nonce });

  assert.equal(adapter.simulations, 1);
  assert.equal(adapter.submissions.length, 1);
  assert.equal(adapter.submissions[0]?.nonce, 7);
});

test("engine errors expose stable codes without sensitive context", () => {
  const error = new TransactionEngineError(
    "SUBMISSION_FAILED",
    "Transaction submission failed",
    true,
  );

  assert.equal(error.code, "SUBMISSION_FAILED");
  assert.equal(error.retryable, true);
  assert.equal(error.message, "Transaction submission failed");
});
