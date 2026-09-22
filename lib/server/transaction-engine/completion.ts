import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { executionAttempts, mintJobs, transactions } from "@/lib/db/schema";

export async function completeConfirmedExecution(
  transactionId: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        transactionState: transactions.state,
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

    if (row.transactionState !== "CONFIRMED") {
      const [confirmed] = await tx
        .update(transactions)
        .set({ state: "CONFIRMED", updatedAt: now })
        .where(
          and(
            eq(transactions.id, transactionId),
            eq(transactions.state, "CONFIRMING"),
          ),
        )
        .returning({ id: transactions.id });

      if (!confirmed) return null;
    }

    await tx
      .update(executionAttempts)
      .set({ state: "SUCCEEDED", updatedAt: now })
      .where(eq(executionAttempts.id, row.attemptId));

    await tx
      .update(mintJobs)
      .set({ state: "SUCCEEDED", updatedAt: now })
      .where(eq(mintJobs.id, row.jobId));

    return { transactionId, attemptId: row.attemptId, jobId: row.jobId };
  });
}

export async function beginConfirmation(
  transactionId: string,
  now = new Date(),
) {
  const [transaction] = await db
    .update(transactions)
    .set({ state: "CONFIRMING", updatedAt: now })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.state, "SUBMITTED"),
      ),
    )
    .returning();

  return transaction ?? null;
}
