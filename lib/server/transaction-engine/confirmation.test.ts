import assert from "node:assert/strict";
import test from "node:test";

import { observeTransaction } from "./confirmation.ts";
import type { TransactionChainAdapter } from "./types.ts";

const hash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

test("maps confirmed, reverted and pending receipts", async () => {
  const confirmed = {
    waitForReceipt: async () => ({ state: "CONFIRMED" as const, hash }),
  } as Pick<TransactionChainAdapter, "waitForReceipt">;
  assert.deepEqual(await observeTransaction(confirmed, hash), {
    kind: "confirmed",
    hash,
  });

  const reverted = {
    waitForReceipt: async () => ({
      state: "REVERTED" as const,
      hash,
      reason: "execution reverted",
    }),
  } as Pick<TransactionChainAdapter, "waitForReceipt">;
  assert.deepEqual(await observeTransaction(reverted, hash), {
    kind: "reverted",
    hash,
    reason: "execution reverted",
  });

  const pending = {
    waitForReceipt: async () => ({ state: "PENDING" as const, hash }),
  } as Pick<TransactionChainAdapter, "waitForReceipt">;
  assert.deepEqual(await observeTransaction(pending, hash), {
    kind: "pending",
    hash,
  });
});

test("propagates receipt lookup failures instead of guessing transaction state", async () => {
  const adapter = {
    waitForReceipt: async () => {
      throw new Error("rpc unavailable");
    },
  } as unknown as Pick<TransactionChainAdapter, "waitForReceipt">;

  await assert.rejects(observeTransaction(adapter, hash), /rpc unavailable/);
});
