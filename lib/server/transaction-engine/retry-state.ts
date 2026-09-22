import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionAttempts, mintJobs } from "@/lib/db/schema";

export async function scheduleExecutionRetry(attemptId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [attempt] = await tx.update(executionAttempts)
      .set({ state: "RETRYING", updatedAt: now })
      .where(eq(executionAttempts.id, attemptId))
      .returning({ mintJobId: executionAttempts.mintJobId });

    if (!attempt) return null;

    const [job] = await tx.update(mintJobs)
      .set({ state: "RETRYING", updatedAt: now })
      .where(eq(mintJobs.id, attempt.mintJobId))
      .returning({ id: mintJobs.id });

    return job ? { attemptId, jobId: job.id } : null;
  });
}
