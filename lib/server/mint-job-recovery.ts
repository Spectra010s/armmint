import "server-only";

import { and, eq, isNotNull, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { mintJobs } from "@/lib/db/schema";

export async function releaseExpiredMintJobClaims(now = new Date()) {
  return db
    .update(mintJobs)
    .set({
      state: "SCHEDULED",
      claimedAt: null,
      claimedBy: null,
      claimExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(mintJobs.state, "CLAIMED"),
        isNotNull(mintJobs.claimExpiresAt),
        lte(mintJobs.claimExpiresAt, now),
      ),
    )
    .returning({ id: mintJobs.id });
}
