import type { TransactionChainAdapter } from "./types";

export type ConfirmationOutcome =
  | { kind: "confirmed"; hash: `0x${string}` }
  | { kind: "reverted"; hash: `0x${string}`; reason?: string }
  | { kind: "pending"; hash: `0x${string}` };

export async function observeTransaction(
  adapter: Pick<TransactionChainAdapter, "waitForReceipt">,
  hash: `0x${string}`,
): Promise<ConfirmationOutcome> {
  const receipt = await adapter.waitForReceipt(hash);

  if (receipt.state === "CONFIRMED") {
    return { kind: "confirmed", hash: receipt.hash };
  }
  if (receipt.state === "REVERTED") {
    return { kind: "reverted", hash: receipt.hash, reason: receipt.reason };
  }
  return { kind: "pending", hash: receipt.hash };
}
