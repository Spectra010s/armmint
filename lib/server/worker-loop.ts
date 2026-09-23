import "server-only";

import {
  claimNextDueMintJob,
  createWorkerId,
} from "@/lib/server/mint-job-claim";
import { startExecutionAttempt } from "@/lib/server/mint-job-lifecycle";

export type ClaimedMintJobHandler = (
  job: NonNullable<Awaited<ReturnType<typeof claimNextDueMintJob>>>,
  attemptId: string,
) => Promise<void>;

export async function runWorkerTick(
  handleClaimedJob: ClaimedMintJobHandler = async (job, attemptId) => {
    const { createProductionTransactionEngine } = await import(
      "@/lib/server/transaction-engine/engine"
    );
    const engine = await createProductionTransactionEngine();
    await engine.executeClaimedJob(job.id, attemptId);
  },
  workerId = createWorkerId(),
  now = new Date(),
) {
  const job = await claimNextDueMintJob(workerId, now);
  if (!job) return null;

  const attempt = await startExecutionAttempt(job.id, now);
  if (!attempt) throw new Error("Failed to create execution attempt");

  await handleClaimedJob(job, attempt.id);
  return { job, attempt };
}
