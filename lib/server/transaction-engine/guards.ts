import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionAttempts, mintJobs } from "@/lib/db/schema";

export type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export const ACTIVE_JOB_STATES = [
  "CLAIMED",
  "SIMULATING",
  "SIGNING",
  "SUBMITTING",
  "SUBMITTED",
  "RETRYING",
  "CONFIRMING",
] as const;

// All lifecycle writers lock in job -> attempt -> transaction order. Validate
// every parent before writing, so a failed guard cannot commit partial state.
export async function lockExecution(
  tx: DatabaseTransaction,
  attemptId: string,
) {
  const [ref] = await tx
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.id, attemptId));
  if (!ref) return null;
  const [job] = await tx
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.id, ref.mintJobId))
    .for("update");
  const [attempt] = await tx
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.id, attemptId))
    .for("update");
  if (
    !job ||
    !attempt ||
    !ACTIVE_JOB_STATES.some((state) => state === job.state) ||
    !["RUNNING", "RETRYING"].includes(attempt.state)
  )
    return null;
  return { job, attempt };
}
