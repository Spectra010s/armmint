import assert from "node:assert/strict";
import test from "node:test";

import { createEvmChainAdapter, type EvmRpcClient } from "./evm-adapter.ts";

const hash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

test("EVM adapter delegates transaction operations without changing nonce", async () => {
  const calls: string[] = [];
  const client: EvmRpcClient = {
    async simulate() { calls.push("simulate"); },
    async getPendingNonce() { calls.push("nonce"); return 12; },
    async broadcast(request) {
      calls.push("broadcast");
      return { hash, nonce: request.nonce };
    },
    async receipt(receiptHash) {
      calls.push("receipt");
      return { state: "CONFIRMED", hash: receiptHash };
    },
  };

  const adapter = createEvmChainAdapter(client);
  const request = {
    chainId: 84532,
    from: "0x1111111111111111111111111111111111111111" as const,
    to: "0x2222222222222222222222222222222222222222" as const,
    data: "0x" as const,
  };

  await adapter.simulate(request);
  const nonce = await adapter.getPendingNonce(request.from);
  const submitted = await adapter.submit({ ...request, nonce });
  const receipt = await adapter.waitForReceipt(submitted.hash);

  assert.deepEqual(calls, ["simulate", "nonce", "broadcast", "receipt"]);
  assert.equal(submitted.nonce, 12);
  assert.equal(receipt.state, "CONFIRMED");
});
