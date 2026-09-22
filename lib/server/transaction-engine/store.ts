import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

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
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
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
      .where(
        and(
          eq(transactions.id, transactionId),
          inArray(transactions.state, ["CREATED", "SUBMITTED"]),
        ),
      )
      .returning();

    if (!transaction) return null;

    const [attempt] = await tx
      .select({ mintJobId: executionAttempts.mintJobId })
      .from(executionAttempts)
      .where(eq(executionAttempts.id, transaction.executionAttemptId))
      .limit(1);

    if (!attempt) {
      throw new Error("Execution attempt not found for transaction");
    }

    await tx
      .update(mintJobs)
      .set({ state: "SUBMITTED", updatedAt: now })
      .where(eq(mintJobs.id, attempt.mintJobId));

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

export async function reserveReplacementTransaction(
  replacedTransactionId: string,
  executionAttemptId: string,
  chainId: number,
  nonce: number,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [original] = await tx
      .select({ nonce: transactions.nonce })
      .from(transactions)
      .where(eq(transactions.id, replacedTransactionId))
      .limit(1);

    if (!original) throw new Error("Transaction to replace was not found");
    if (original.nonce !== nonce) {
      throw new Error("Replacement transaction must reuse the original nonce");
    }

    const [replacement] = await tx
      .insert(transactions)
      .values({
        id: randomUUID(),
        executionAttemptId,
        replacesTransactionId: replacedTransactionId,
        chainId,
        nonce,
        state: "CREATED",
        updatedAt: now,
      })
      .returning();

    return replacement;
  });
}

export async function markReplacementSubmitted(
  replacementTransactionId: string,
  hash: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const [replacement] = await tx
      .update(transactions)
      .set({ hash, state: "SUBMITTED", updatedAt: now })
      .where(
        and(
          eq(transactions.id, replacementTransactionId),
          eq(transactions.state, "CREATED"),
        ),
      )
      .returning();

    if (!replacement) return null;

    if (replacement.replacesTransactionId) {
      await tx
        .update(transactions)
        .set({ state: "REPLACED", updatedAt: now })
        .where(
          and(
            eq(transactions.id, replacement.replacesTransactionId),
            inArray(transactions.state, ["SUBMITTED", "CONFIRMING", "DROPPED"]),
          ),
        );
    }

    const [attempt] = await tx
      .select({ mintJobId: executionAttempts.mintJobId })
      .from(executionAttempts)
      .where(eq(executionAttempts.id, replacement.executionAttemptId))
      .limit(1);

    if (!attempt) throw new Error("Execution attempt not found for replacement");

    await tx
      .update(mintJobs)
      .set({ state: "SUBMITTED", updatedAt: now })
      .where(eq(mintJobs.id, attempt.mintJobId));

    return replacement;
  });
}
