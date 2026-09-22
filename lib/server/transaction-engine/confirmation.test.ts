import assert from "node:assert/strict";
import test from "node:test";

import { observeTransaction } from "./confirmation.ts";
import type { TransactionChainAdapter } from "./types.ts";

const hash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

test("maps confirmed and reverted receipts", async () => {
  const confirmed = {
    waitForReceipt: async () => ({ state: "CONFIRMED" as const, hash }),
  } as TransactionChainAdapter;
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
  } as TransactionChainAdapter;
  assert.deepEqual(await observeTransaction(reverted, hash), {
    kind: "reverted",
    hash,
    reason: "execution reverted",
  });
});

test("maps receipt lookup failure to dropped observation", async () => {
  const adapter = {
    waitForReceipt: async () => {
      throw new Error("not found");
    },
  } as unknown as TransactionChainAdapter;

  assert.deepEqual(await observeTransaction(adapter, hash), {
    kind: "dropped",
    hash,
  });
});
