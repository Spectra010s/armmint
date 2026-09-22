import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { mintJobs } from "@/lib/db/schema";

export const DEFAULT_CLAIM_LEASE_MS = 60_000;

export async function claimNextDueMintJob(workerId: string, now = new Date(), leaseMs = DEFAULT_CLAIM_LEASE_MS) {
  if (!workerId.trim()) throw new Error("Worker id is required");
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("Claim lease must be positive");
  const claimExpiresAt = new Date(now.getTime() + leaseMs);

  return db.transaction(async (tx) => {
    const candidate = await tx.execute<{ id: string }>(sql`SELECT ${mintJobs.id} AS id FROM ${mintJobs} WHERE ((${mintJobs.state} = 'SCHEDULED' AND ${mintJobs.scheduledFor} <= ${now}) OR (${mintJobs.state} = 'CLAIMED' AND ${mintJobs.claimExpiresAt} IS NOT NULL AND ${mintJobs.claimExpiresAt} <= ${now})) ORDER BY ${mintJobs.scheduledFor} ASC, ${mintJobs.createdAt} ASC FOR UPDATE SKIP LOCKED LIMIT 1`);
    const id = candidate.rows[0]?.id;
    if (!id) return null;

    const [claimed] = await tx.update(mintJobs).set({ state: "CLAIMED", claimedAt: now, claimExpiresAt, claimedBy: workerId, updatedAt: now }).where(and(eq(mintJobs.id, id), or(eq(mintJobs.state, "SCHEDULED"), and(eq(mintJobs.state, "CLAIMED"), or(isNull(mintJobs.claimExpiresAt), lte(mintJobs.claimExpiresAt, now))))).returning();
    return claimed ?? null;
  });
}

export function createWorkerId(prefix = "worker") {
  return `${prefix}-${randomUUID()}`;
}
