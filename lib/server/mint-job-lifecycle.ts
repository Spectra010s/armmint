import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  executionAttempts,
  mintJobs,
  type mintJobState,
} from "@/lib/db/schema";

type MintJobState = (typeof mintJobState.enumValues)[number];

const allowedTransitions: Record<MintJobState, readonly MintJobState[]> = {
  SCHEDULED: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["SIMULATING", "SCHEDULED", "FAILED", "CANCELLED"],
  SIMULATING: ["SIGNING", "RETRYING", "FAILED"],
  SIGNING: ["SUBMITTING", "RETRYING", "FAILED"],
  SUBMITTING: ["SUBMITTED", "RETRYING", "FAILED"],
  SUBMITTED: ["CONFIRMING", "RETRYING", "FAILED"],
  RETRYING: ["SIMULATING", "SIGNING", "SUBMITTING", "CONFIRMING", "FAILED"],
  CONFIRMING: ["SUCCEEDED", "RETRYING", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionMintJob(from: MintJobState, to: MintJobState) {
  return allowedTransitions[from].includes(to);
}

export async function transitionMintJob(
  jobId: string,
  from: MintJobState,
  to: MintJobState,
  now = new Date(),
) {
  if (!canTransitionMintJob(from, to)) {
    throw new Error(`Invalid mint job transition: ${from} -> ${to}`);
  }

  const [job] = await db
    .update(mintJobs)
    .set({
      state: to,
      updatedAt: now,
      ...(to === "SCHEDULED"
        ? { claimedAt: null, claimedBy: null, claimExpiresAt: null }
        : {}),
    })
    .where(and(eq(mintJobs.id, jobId), eq(mintJobs.state, from)))
    .returning();

  return job ?? null;
}

export async function startExecutionAttempt(jobId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ attemptNumber: executionAttempts.attemptNumber })
      .from(executionAttempts)
      .where(eq(executionAttempts.mintJobId, jobId))
      .orderBy(desc(executionAttempts.attemptNumber))
      .limit(1);

    const [attempt] = await tx
      .insert(executionAttempts)
      .values({
        id: randomUUID(),
        mintJobId: jobId,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        state: "RUNNING",
        updatedAt: now,
      })
      .returning();

    return attempt;
  });
}

export async function finishExecutionAttempt(
  attemptId: string,
  state: "SUCCEEDED" | "FAILED" | "RETRYING",
  failure?: { code: string; message: string },
  now = new Date(),
) {
  const [attempt] = await db
    .update(executionAttempts)
    .set({
      state,
      failureCode: failure?.code ?? null,
      failureMessage: failure?.message ?? null,
      updatedAt: now,
    })
    .where(eq(executionAttempts.id, attemptId))
    .returning();

  return attempt ?? null;
}
