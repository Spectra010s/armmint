import type { TransactionChainAdapter } from "./types";

export type ConfirmationOutcome =
  | { kind: "confirmed"; hash: `0x${string}` }
  | { kind: "reverted"; hash: `0x${string}`; reason?: string }
  | { kind: "dropped"; hash: `0x${string}` };

export async function observeTransaction(
  adapter: TransactionChainAdapter,
  hash: `0x${string}`,
): Promise<ConfirmationOutcome> {
  try {
    const receipt = await adapter.waitForReceipt(hash);
    return receipt.state === "CONFIRMED"
      ? { kind: "confirmed", hash: receipt.hash }
      : { kind: "reverted", hash: receipt.hash, reason: receipt.reason };
  } catch {
    return { kind: "dropped", hash };
  }
}
