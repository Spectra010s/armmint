import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionAttempts, mintJobs } from "@/lib/db/schema";
import { DEFAULT_RETRY_POLICY, shouldRetry, type RetryPolicy } from "./retry";

export type RetryScheduleResult =
  | { kind: "scheduled"; attemptId: string; jobId: string }
  | { kind: "exhausted"; attemptId: string; jobId: string };

export async function scheduleExecutionRetry(
  attemptId: string,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  now = new Date(),
): Promise<RetryScheduleResult | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        mintJobId: executionAttempts.mintJobId,
        attemptNumber: executionAttempts.attemptNumber,
      })
      .from(executionAttempts)
      .where(eq(executionAttempts.id, attemptId))
      .limit(1);

    if (!current) return null;

    const activeAttempt = and(
      eq(executionAttempts.id, attemptId),
      inArray(executionAttempts.state, ["RUNNING", "RETRYING"]),
    );

    if (!shouldRetry(current.attemptNumber, policy)) {
      const [failedAttempt] = await tx
        .update(executionAttempts)
        .set({
          state: "FAILED",
          failureCode: "RETRY_EXHAUSTED",
          failureMessage: "Transaction retry limit exhausted",
          updatedAt: now,
        })
        .where(activeAttempt)
        .returning({ id: executionAttempts.id });

      if (!failedAttempt) return null;

      await tx
        .update(mintJobs)
        .set({ state: "FAILED", updatedAt: now })
        .where(eq(mintJobs.id, current.mintJobId));

      return { kind: "exhausted", attemptId, jobId: current.mintJobId };
    }

    const [scheduledAttempt] = await tx
      .update(executionAttempts)
      .set({ state: "RETRYING", updatedAt: now })
      .where(activeAttempt)
      .returning({ id: executionAttempts.id });

    if (!scheduledAttempt) return null;

    await tx
      .update(mintJobs)
      .set({ state: "RETRYING", updatedAt: now })
      .where(eq(mintJobs.id, current.mintJobId));

    return { kind: "scheduled", attemptId, jobId: current.mintJobId };
  });
}
