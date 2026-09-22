import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { executionAttempts, mintJobs, transactions } from "@/lib/db/schema";

export async function findRecoverableTransaction(mintJobId: string) {
  const [row] = await db
    .select({
      id: transactions.id,
      hash: transactions.hash,
      nonce: transactions.nonce,
      state: transactions.state,
      executionAttemptId: transactions.executionAttemptId,
    })
    .from(transactions)
    .innerJoin(
      executionAttempts,
      eq(transactions.executionAttemptId, executionAttempts.id),
    )
    .where(
      and(
        eq(executionAttempts.mintJobId, mintJobId),
        inArray(transactions.state, ["CREATED", "SUBMITTED", "CONFIRMING"]),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function reserveTransaction(
  executionAttemptId: string,
  chainId: number,
  nonce: number,
  now = new Date(),
) {
  const [transaction] = await db
    .insert(transactions)
    .values({
      id: randomUUID(),
      executionAttemptId,
      chainId,
      nonce,
      state: "CREATED",
      updatedAt: now,
    })
    .returning();

  return transaction;
}

export async function markTransactionSubmitted(
  transactionId: string,
  hash: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [transaction] = await tx
      .update(transactions)
      .set({ hash, state: "SUBMITTED", updatedAt: now })
      .where(eq(transactions.id, transactionId))
      .returning();

    if (!transaction) return null;

    await tx
      .update(mintJobs)
      .set({ state: "SUBMITTED", updatedAt: now })
      .where(
        eq(
          mintJobs.id,
          tx
            .select({ mintJobId: executionAttempts.mintJobId })
            .from(executionAttempts)
            .where(eq(executionAttempts.id, transaction.executionAttemptId)),
        ),
      );

    return transaction;
  });
}

export async function markTransactionTerminal(
  transactionId: string,
  state: "CONFIRMED" | "REVERTED" | "DROPPED",
  now = new Date(),
) {
  const [transaction] = await db
    .update(transactions)
    .set({ state, updatedAt: now })
    .where(eq(transactions.id, transactionId))
    .returning();

  return transaction ?? null;
}
