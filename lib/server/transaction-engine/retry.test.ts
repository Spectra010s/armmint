import assert from "node:assert/strict";
import test from "node:test";

import { bumpFee, shouldRetry } from "./retry.ts";

test("retry policy stops at the configured attempt limit", () => {
  assert.equal(shouldRetry(1, { maxAttempts: 3, gasBumpBps: 1_250 }), true);
  assert.equal(shouldRetry(2, { maxAttempts: 3, gasBumpBps: 1_250 }), true);
  assert.equal(shouldRetry(3, { maxAttempts: 3, gasBumpBps: 1_250 }), false);
});

test("gas bump rounds upward and never lowers the fee", () => {
  assert.equal(bumpFee(100n, 1_250), 113n);
  assert.equal(bumpFee(100n, 0), 100n);
  assert.throws(() => bumpFee(100n, -1));
});
