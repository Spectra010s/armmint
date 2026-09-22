import assert from "node:assert/strict";
import test from "node:test";

import { decideNonce } from "./nonce.ts";

test("reuses a persisted nonce across retries", () => {
  assert.deepEqual(decideNonce(12, { id: "tx-1", nonce: 7 }), {
    kind: "reuse",
    nonce: 7,
    transactionId: "tx-1",
  });
});

test("reserves the pending nonce when no transaction exists", () => {
  assert.deepEqual(decideNonce(12), { kind: "reserve", nonce: 12 });
});

test("rejects invalid pending nonces", () => {
  assert.throws(() => decideNonce(-1));
  assert.throws(() => decideNonce(Number.MAX_SAFE_INTEGER + 1));
});
