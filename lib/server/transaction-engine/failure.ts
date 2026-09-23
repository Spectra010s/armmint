import "server-only";
import { eq, and, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionAttempts, mintJobs, transactions } from "@/lib/db/schema";
import { lockExecution } from "./guards";

export async function failExecution(
  transactionId: string,
  failure: { code: string; message: string },
  transactionState: "REVERTED" | "DROPPED",
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId));
    if (!ref) return null;
    const context = await lockExecution(tx, ref.executionAttemptId);
    if (!context) return null;
    const [row] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .for("update");
    if (!["CREATED", "SUBMITTED", "CONFIRMING", "REPLACED"].includes(row.state))
      return null;
    await tx
      .update(transactions)
      .set({ state: transactionState, updatedAt: now })
      .where(eq(transactions.id, transactionId));
    await tx
      .update(transactions)
      .set({ state: "REPLACED", updatedAt: now })
      .where(
        and(
          eq(transactions.executionAttemptId, ref.executionAttemptId),
          ne(transactions.id, transactionId),
          inArray(transactions.state, ["CREATED", "SUBMITTED", "CONFIRMING"]),
        ),
      );
    await tx
      .update(executionAttempts)
      .set({
        state: "FAILED",
        failureCode: failure.code,
        failureMessage: failure.message,
        updatedAt: now,
      })
      .where(eq(executionAttempts.id, context.attempt.id));
    await tx
      .update(mintJobs)
      .set({ state: "FAILED", updatedAt: now })
      .where(eq(mintJobs.id, context.job.id));
    return {
      transactionId,
      attemptId: context.attempt.id,
      jobId: context.job.id,
    };
  });
}
export async function failUnsubmittedExecution(
  attemptId: string,
  code: string,
  message: string,
  jobId?: string,
) {
  return db.transaction(async (tx) => {
    const context = await lockExecution(tx, attemptId);
    if (!context || (jobId && context.job.id !== jobId)) return;
    const rows = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.executionAttemptId, attemptId));
    // A lost response is not proof of failure. Keep monitoring anything signed.
    if (rows.some((row) => row.hash)) return;
    await tx
      .update(executionAttempts)
      .set({ state: "FAILED", failureCode: code, failureMessage: message })
      .where(eq(executionAttempts.id, attemptId));
    await tx
      .update(mintJobs)
      .set({ state: "FAILED" })
      .where(eq(mintJobs.id, context.job.id));
  });
}
