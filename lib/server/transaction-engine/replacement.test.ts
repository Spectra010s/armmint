import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReplacementNonce,
  buildReplacementFees,
  buildReplacementRequest,
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

test("replacement request preserves nonce and bumps EIP-1559 fees", () => {
  const replacement = buildReplacementRequest(
    {
      nonce: 9,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 10n,
    },
    1250,
  );

  assert.equal(replacement.nonce, 9);
  assert.equal(replacement.maxFeePerGas, 113n);
  assert.equal(replacement.maxPriorityFeePerGas, 12n);
});

test("replacement request rejects missing fee data", () => {
  assert.throws(
    () => buildReplacementRequest({ nonce: 9 }, 1250),
    /requires EIP-1559 fee fields/,
  );
});
