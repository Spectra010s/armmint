import { isMintNetwork } from "@/lib/networks";
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { isAddress, zeroAddress } from "viem";
import { db } from "@/lib/db";
import {
  executionAttempts,
  mintJobs,
  transactions,
  wallets,
} from "@/lib/db/schema";
import type { DatabaseTransaction } from "./transaction-engine/guards";

export type MintConfiguration = {
  chainId: number;
  contractAddress: string;
  calldata: string;
  valueWei: string;
  scheduledFor: string;
};
export class MintInputError extends Error {}

export function validateMintConfiguration(
  input: MintConfiguration,
  now = new Date(),
) {
  if (!isMintNetwork(input.chainId))
    throw new MintInputError("Choose a supported Arc or Ink network.");
  if (
    !isAddress(input.contractAddress) ||
    input.contractAddress.toLowerCase() === zeroAddress
  )
    throw new MintInputError("Enter a valid, non-zero contract address.");
  // A 32-byte input can be an accidentally pasted private key. Never accept it.
  if (
    !/^0x(?:[a-fA-F0-9]{2}){4,1800}$/.test(input.calldata) ||
    input.calldata.length === 66
  )
    throw new MintInputError(
      "Enter encoded contract calldata, including its 4-byte function selector (maximum 1,800 bytes). Never send a private key.",
    );
  if (
    !/^(0|[1-9][0-9]{0,77})$/.test(input.valueWei) ||
    BigInt(input.valueWei) >= 2n ** 256n
  )
    throw new MintInputError("Enter a valid transaction value.");
  const scheduledFor = new Date(input.scheduledFor);
  if (
    !Number.isFinite(scheduledFor.getTime()) ||
    scheduledFor.getTime() < now.getTime() - 60_000 ||
    scheduledFor.getTime() > now.getTime() + 365 * 86400_000
  )
    throw new MintInputError(
      "Choose a future time within one year, or Mint now.",
    );
  return scheduledFor;
}

export async function getUserWallet(
  userId: string,
  database: DatabaseTransaction | typeof db = db,
) {
  const [wallet] = await database
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  return wallet ?? null;
}

// Shared persistence boundary: Telegram only supplies validated public inputs.
export async function createMintJob(
  userId: string,
  input: MintConfiguration,
  idempotencyKey: string,
  now = new Date(),
  database?: DatabaseTransaction,
) {
  const create = async (tx: DatabaseTransaction) => {
    const [existing] = await tx
      .select()
      .from(mintJobs)
      .where(
        and(
          eq(mintJobs.userId, userId),
          eq(mintJobs.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.chainId !== input.chainId) throw new MintInputError("This request was already used for another network.");
      return existing;
    }
    const scheduledFor = validateMintConfiguration(input, now);
    const wallet = await getUserWallet(userId, tx);
    if (!wallet || !isAddress(wallet.address))
      throw new MintInputError(
        "Set up a valid burner wallet in the ArmMint web app first.",
      );
    const [created] = await tx
      .insert(mintJobs)
      .values({
        id: randomUUID(),
        userId,
        walletId: wallet.id,
        ...input,
        scheduledFor,
        idempotencyKey,
      })
      .onConflictDoNothing({
        target: [mintJobs.userId, mintJobs.idempotencyKey],
      })
      .returning();
    if (created) return created;
    const [retry] = await tx
      .select()
      .from(mintJobs)
      .where(
        and(
          eq(mintJobs.userId, userId),
          eq(mintJobs.idempotencyKey, idempotencyKey),
        ),
      );
    if (!retry)
      throw new MintInputError("Unable to create this job. Start a new mint.");
    if (retry.chainId !== input.chainId) throw new MintInputError("This request was already used for another network.");
    return retry;
  };
  return database ? create(database) : db.transaction(create);
}

export async function listMintJobs(
  userId: string,
  page = 0,
  database: DatabaseTransaction | typeof db = db,
) {
  return database
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.userId, userId))
    .orderBy(desc(mintJobs.createdAt), desc(mintJobs.id))
    .limit(6)
    .offset(page * 5);
}
export async function getMintJob(
  userId: string,
  jobId: string,
  database: DatabaseTransaction | typeof db = db,
) {
  const [job] = await database
    .select()
    .from(mintJobs)
    .where(and(eq(mintJobs.id, jobId), eq(mintJobs.userId, userId)));
  if (!job) return null;
  const history = await database
    .select({ hash: transactions.hash, state: transactions.state, chainId: transactions.chainId })
    .from(transactions)
    .innerJoin(
      executionAttempts,
      eq(transactions.executionAttemptId, executionAttempts.id),
    )
    .where(
      and(
        eq(executionAttempts.mintJobId, job.id),
        isNotNull(transactions.hash),
      ),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(5);
  return { job, history };
}

export async function cancelMintJob(
  userId: string,
  jobId: string,
  now = new Date(),
  database?: DatabaseTransaction,
) {
  const cancel = async (tx: DatabaseTransaction) => {
    // Same job lock as the worker. Once claimed, cancellation is deliberately unavailable.
    const [job] = await tx
      .select()
      .from(mintJobs)
      .where(and(eq(mintJobs.id, jobId), eq(mintJobs.userId, userId)))
      .for("update");
    if (!job) return "not_found" as const;
    if (job.state === "CANCELLED") return "cancelled" as const;
    if (job.state !== "SCHEDULED") return "unsafe" as const;
    const [signed] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .innerJoin(
        executionAttempts,
        eq(transactions.executionAttemptId, executionAttempts.id),
      )
      .where(
        and(
          eq(executionAttempts.mintJobId, job.id),
          isNotNull(transactions.hash),
        ),
      )
      .limit(1);
    if (signed) return "unsafe" as const;
    await tx
      .update(mintJobs)
      .set({ state: "CANCELLED", updatedAt: now })
      .where(eq(mintJobs.id, job.id));
    await tx
      .update(executionAttempts)
      .set({
        state: "FAILED",
        failureCode: "CANCELLED",
        failureMessage: "Job cancelled before execution",
        updatedAt: now,
      })
      .where(
        and(
          eq(executionAttempts.mintJobId, job.id),
          inArray(executionAttempts.state, ["PENDING", "RUNNING", "RETRYING"]),
        ),
      );
    return "cancelled" as const;
  };
  return database ? cancel(database) : db.transaction(cancel);
}
