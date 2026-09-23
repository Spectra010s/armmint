import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mintJobs } from "@/lib/db/schema";
export const DEFAULT_CLAIM_LEASE_MS = 60_000;

export async function claimNextDueMintJob(
  workerId: string,
  now = new Date(),
  leaseMs = DEFAULT_CLAIM_LEASE_MS,
) {
  if (!workerId.trim()) throw new Error("Worker id is required");
  if (!Number.isFinite(leaseMs) || leaseMs <= 0)
    throw new Error("Claim lease must be positive");
  return db.transaction(async (tx) => {
    const candidates = await tx.execute<{ id: string }>(sql`
      SELECT ${mintJobs.id} AS id FROM ${mintJobs}
      WHERE (${mintJobs.state} = 'SCHEDULED' AND ${mintJobs.scheduledFor} <= ${now})
        OR (${mintJobs.state} IN ('CLAIMED','SIMULATING','SIGNING','SUBMITTING','SUBMITTED','RETRYING','CONFIRMING')
          AND (${mintJobs.claimExpiresAt} IS NULL OR ${mintJobs.claimExpiresAt} <= ${now})
          AND (${mintJobs.engineLeaseExpiresAt} IS NULL OR ${mintJobs.engineLeaseExpiresAt} <= ${now}))
      ORDER BY CASE WHEN ${mintJobs.state} = 'SCHEDULED' THEN ${mintJobs.scheduledFor}
        ELSE COALESCE(${mintJobs.claimExpiresAt}, ${mintJobs.updatedAt}) END,
        ${mintJobs.scheduledFor}, ${mintJobs.createdAt}
      FOR UPDATE SKIP LOCKED LIMIT 1
    `);
    const id = candidates.rows[0]?.id;
    if (!id) return null;
    const [job] = await tx
      .update(mintJobs)
      .set({
        state: sql`CASE WHEN ${mintJobs.state} = 'SCHEDULED' THEN 'CLAIMED'::mint_job_state ELSE ${mintJobs.state} END`,
        claimedAt: now,
        claimExpiresAt: new Date(now.getTime() + leaseMs),
        claimedBy: workerId,
        updatedAt: now,
      })
      .where(eq(mintJobs.id, id))
      .returning();
    return job ?? null;
  });
}
export function createWorkerId(prefix = "worker") {
  return `${prefix}-${randomUUID()}`;
}
