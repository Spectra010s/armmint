import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionAttempts, mintJobs } from "@/lib/db/schema";
import { lockExecution } from "./guards";
import { DEFAULT_RETRY_POLICY, shouldRetry, type RetryPolicy } from "./retry";

export type RetryScheduleResult = {
  kind: "scheduled" | "exhausted";
  attemptId: string;
  jobId: string;
};
export async function scheduleExecutionRetry(
  attemptId: string,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  now = new Date(),
  mayBeOnChain = false,
): Promise<RetryScheduleResult | null> {
  return db.transaction(async (tx) => {
    const context = await lockExecution(tx, attemptId);
    if (!context) return null;
    const exhausted = !shouldRetry(
      context.attempt.attemptNumber + context.attempt.retryCount,
      policy,
    );
    await tx
      .update(executionAttempts)
      .set({
        state: exhausted && !mayBeOnChain ? "FAILED" : "RETRYING",
        retryCount: context.attempt.retryCount + (exhausted ? 0 : 1),
        failureCode: exhausted ? "RETRY_EXHAUSTED" : null,
        failureMessage: exhausted ? "Transaction retry limit exhausted" : null,
        updatedAt: now,
      })
      .where(eq(executionAttempts.id, attemptId));
    await tx
      .update(mintJobs)
      .set({
        state: exhausted
          ? mayBeOnChain
            ? "CONFIRMING"
            : "FAILED"
          : "RETRYING",
        updatedAt: now,
      })
      .where(eq(mintJobs.id, context.job.id));
    return {
      kind: exhausted ? "exhausted" : "scheduled",
      attemptId,
      jobId: context.job.id,
    };
  });
}
