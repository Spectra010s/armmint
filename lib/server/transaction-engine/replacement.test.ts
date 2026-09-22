import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReplacementNonce,
  buildReplacementFees,
} from "./replacement.ts";

test("replacement fees are bumped deterministically", () => {
  assert.deepEqual(
    buildReplacementFees(
      { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n },
      1_250,
    ),
    { maxFeePerGas: 113n, maxPriorityFeePerGas: 12n },
  );
});

test("replacement transactions must preserve nonce", () => {
  assert.doesNotThrow(() => assertReplacementNonce(4, 4));
  assert.throws(() => assertReplacementNonce(4, 5));
});
