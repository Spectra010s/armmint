import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { executionAttempts, mintJobs, transactions } from "@/lib/db/schema";

export async function failExecution(
  transactionId: string,
  failure: { code: string; message: string },
  transactionState: "REVERTED" | "DROPPED",
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        attemptId: executionAttempts.id,
        jobId: executionAttempts.mintJobId,
      })
      .from(transactions)
      .innerJoin(
        executionAttempts,
        eq(transactions.executionAttemptId, executionAttempts.id),
      )
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (!row) return null;

    const [failedTransaction] = await tx
      .update(transactions)
      .set({ state: transactionState, updatedAt: now })
      .where(
        and(
          eq(transactions.id, transactionId),
          inArray(transactions.state, ["CREATED", "SUBMITTED", "CONFIRMING"]),
        ),
      )
      .returning({ id: transactions.id });

    if (!failedTransaction) return null;

    const [failedAttempt] = await tx
      .update(executionAttempts)
      .set({
        state: "FAILED",
        failureCode: failure.code,
        failureMessage: failure.message,
        updatedAt: now,
      })
      .where(
        and(
          eq(executionAttempts.id, row.attemptId),
          inArray(executionAttempts.state, ["RUNNING", "RETRYING"]),
        ),
      )
      .returning({ id: executionAttempts.id });

    if (!failedAttempt) return null;

    const [failedJob] = await tx
      .update(mintJobs)
      .set({ state: "FAILED", updatedAt: now })
      .where(
        and(
          eq(mintJobs.id, row.jobId),
          inArray(mintJobs.state, [
            "CLAIMED",
            "SIMULATING",
            "SIGNING",
            "SUBMITTING",
            "SUBMITTED",
            "RETRYING",
            "CONFIRMING",
          ]),
        ),
      )
      .returning({ id: mintJobs.id });

    if (!failedJob) return null;

    return { transactionId, attemptId: row.attemptId, jobId: row.jobId };
  });
}
