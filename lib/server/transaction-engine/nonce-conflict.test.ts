import assert from "node:assert/strict";
import test from "node:test";

import { TransactionEngineError } from "./errors.ts";

test("nonce conflicts are non-retryable engine failures", () => {
  const error = new TransactionEngineError(
    "NONCE_CONFLICT",
    "Transaction submission returned an unexpected nonce",
    false,
  );

  assert.equal(error.code, "NONCE_CONFLICT");
  assert.equal(error.retryable, false);
});
