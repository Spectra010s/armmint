import { setTimeout } from "node:timers/promises";
import { runWorkerTick } from "../lib/server/worker-loop.ts";
import { createWorkerId } from "../lib/server/mint-job-claim.ts";
import { db } from "../lib/db/index.ts";
import { workerLog } from "../lib/server/worker-log.ts";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const workerId = createWorkerId();
while (!controller.signal.aborted) {
  try {
    const result = await runWorkerTick(undefined, workerId);
    if (result)
      workerLog("info", "execution_processed", {
        jobId: result.job.id,
        attemptId: result.attempt.id,
      });
  } catch {
    workerLog("error", "execution_tick_failed");
  }
  try {
    await setTimeout(1_000, undefined, { signal: controller.signal });
  } catch {
    break;
  }
}

await db.$client.end();
