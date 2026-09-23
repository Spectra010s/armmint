import "server-only";
import { and, eq } from "drizzle-orm";
import { isAddress } from "viem";
import { db } from "@/lib/db";
import { executionAttempts, mintJobs, wallets } from "@/lib/db/schema";
import { TransactionEngineError } from "./errors";
import type { TransactionRequest } from "./types";

export function buildMintTransaction(
  job: typeof mintJobs.$inferSelect,
  wallet: Pick<typeof wallets.$inferSelect, "id" | "userId" | "address">,
): TransactionRequest {
  if (
    wallet.id !== job.walletId ||
    wallet.userId !== job.userId ||
    !isAddress(wallet.address) ||
    !isAddress(job.contractAddress) ||
    !job.calldata ||
    !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(job.calldata) ||
    !/^(0|[1-9][0-9]*)$/.test(job.valueWei) ||
    BigInt(job.valueWei) >= 2n ** 256n ||
    ![8453, 84532].includes(job.chainId)
  ) {
    throw new TransactionEngineError(
      "INVALID_EXECUTION",
      "Mint job has invalid wallet, chain, calldata, or value",
    );
  }
  return {
    chainId: job.chainId,
    from: wallet.address as `0x${string}`,
    to: job.contractAddress as `0x${string}`,
    data: job.calldata as `0x${string}`,
    value: BigInt(job.valueWei),
  };
}
export async function loadClaimedMintJob(jobId: string, attemptId: string) {
  const [row] = await db
    .select({
      job: mintJobs,
      address: wallets.address,
      walletUserId: wallets.userId,
      walletId: wallets.id,
    })
    .from(mintJobs)
    .innerJoin(wallets, eq(wallets.id, mintJobs.walletId))
    .innerJoin(executionAttempts, eq(executionAttempts.mintJobId, mintJobs.id))
    .where(and(eq(mintJobs.id, jobId), eq(executionAttempts.id, attemptId)));
  if (!row)
    throw new TransactionEngineError(
      "INVALID_EXECUTION",
      "Claimed execution not found",
    );
  const request = buildMintTransaction(row.job, {
    id: row.walletId,
    userId: row.walletUserId,
    address: row.address,
  });
  return { job: row.job, request };
}
export async function loadSigningWallet(
  walletId: string,
  userId: string,
  expectedAddress: string,
) {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)));
  if (!wallet || wallet.address.toLowerCase() !== expectedAddress.toLowerCase())
    throw new TransactionEngineError(
      "SIGNING_FAILED",
      "Signing wallet is unavailable",
    );
  return wallet;
}
