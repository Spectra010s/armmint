import assert from "node:assert/strict";
import test from "node:test";

import { recoverSubmission } from "./submission-recovery.ts";

test("submitted hashes are awaited instead of resubmitted", () => {
  const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.deepEqual(recoverSubmission({ hash, nonce: 8 }), { kind: "await", hash });
});

test("reserved transactions retry with their persisted nonce", () => {
  assert.deepEqual(recoverSubmission({ hash: null, nonce: 8 }), {
    kind: "retry-same-nonce",
    nonce: 8,
  });
});
