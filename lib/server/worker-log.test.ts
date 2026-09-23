import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeWorkerLogContext } from "./worker-log.ts";

test("redacts wallet and transaction secrets recursively", () => {
  assert.deepEqual(
    sanitizeWorkerLogContext({
      jobId: "job-1",
      privateKey: "secret",
      nested: {
        signature: "sig",
        rawTransaction: "raw",
        hash: "0xpublic",
      },
    }),
    {
      jobId: "job-1",
      privateKey: "[REDACTED]",
      nested: {
        signature: "[REDACTED]",
        rawTransaction: "[REDACTED]",
        hash: "0xpublic",
      },
    },
  );
});
