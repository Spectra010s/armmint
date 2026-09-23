import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionAttempts, mintJobs, transactions } from "@/lib/db/schema";
import { lockExecution } from "./guards";

export async function completeConfirmedExecution(
  transactionId: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId));
    if (!ref) return null;
    const context = await lockExecution(tx, ref.executionAttemptId);
    if (!context) {
      const [attempt] = await tx
        .select()
        .from(executionAttempts)
        .where(eq(executionAttempts.id, ref.executionAttemptId));
      const [job] = attempt
        ? await tx
            .select()
            .from(mintJobs)
            .where(eq(mintJobs.id, attempt.mintJobId))
        : [];
      return ref.state === "CONFIRMED" &&
        attempt?.state === "SUCCEEDED" &&
        job?.state === "SUCCEEDED"
        ? { transactionId, attemptId: attempt.id, jobId: job.id }
        : null;
    }
    const [row] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .for("update");
    if (
      !["CREATED", "SUBMITTED", "CONFIRMING", "REPLACED", "CONFIRMED"].includes(
        row.state,
      )
    )
      return null;
    await tx
      .update(transactions)
      .set({ state: "CONFIRMED", updatedAt: now })
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
        state: "SUCCEEDED",
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      })
      .where(eq(executionAttempts.id, context.attempt.id));
    await tx
      .update(mintJobs)
      .set({ state: "SUCCEEDED", updatedAt: now })
      .where(eq(mintJobs.id, context.job.id));
    return {
      transactionId,
      attemptId: context.attempt.id,
      jobId: context.job.id,
    };
  });
}
export async function beginConfirmation(
  transactionId: string,
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
      .update(transactions)
      .set({ state: "CONFIRMING", updatedAt: now })
      .where(
        and(
          eq(transactions.id, transactionId),
          inArray(transactions.state, ["SUBMITTED", "CONFIRMING"]),
        ),
      )
      .returning();
    if (!row) return null;
    await tx
      .update(mintJobs)
      .set({ state: "CONFIRMING", updatedAt: now })
      .where(eq(mintJobs.id, context.job.id));
    return row;
  });
}
