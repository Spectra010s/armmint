import assert from "node:assert/strict";
import test from "node:test";

import { canTransitionMintJob } from "./mint-job-lifecycle.ts";

test("allows the normal mint execution lifecycle", () => {
  assert.equal(canTransitionMintJob("SCHEDULED", "CLAIMED"), true);
  assert.equal(canTransitionMintJob("CLAIMED", "SIMULATING"), true);
  assert.equal(canTransitionMintJob("SIMULATING", "SIGNING"), true);
  assert.equal(canTransitionMintJob("SIGNING", "SUBMITTING"), true);
  assert.equal(canTransitionMintJob("SUBMITTING", "SUBMITTED"), true);
  assert.equal(canTransitionMintJob("SUBMITTED", "CONFIRMING"), true);
  assert.equal(canTransitionMintJob("CONFIRMING", "SUCCEEDED"), true);
});

test("terminal jobs cannot transition", () => {
  for (const state of ["SUCCEEDED", "FAILED", "CANCELLED"] as const) {
    assert.equal(canTransitionMintJob(state, "SCHEDULED"), false);
  }
});

test("claimed jobs can be released for recovery", () => {
  assert.equal(canTransitionMintJob("CLAIMED", "SCHEDULED"), true);
});
