import { getNetwork } from "@/lib/networks";
import { getNetworkRpcUrl } from "@/lib/server/network-config";
import type { TransactionChainAdapter, TransactionRequest } from "./types";

export type ClaimedJobExecution = {
  jobId: string;
  executionAttemptId: string;
  request: TransactionRequest;
};

export function createTransactionEngine(
  adapter: TransactionChainAdapter,
  loadClaimedJob: (jobId: string) => Promise<ClaimedJobExecution>,
) {
  return {
    async executeClaimedJob(jobId: string) {
      const execution = await loadClaimedJob(jobId);

      if (execution.jobId !== jobId) {
        throw new Error("Loaded execution does not match requested job");
      }

      const { executeTransaction } = await import("./execute");
      await executeTransaction(adapter, {
        mintJobId: execution.jobId,
        executionAttemptId: execution.executionAttemptId,
        request: execution.request,
      });
    },
  };
}

// Production composition uses the same executeTransaction API as injected adapters.
// Only the viem signing boundary can load encrypted key material.
export async function createProductionTransactionEngine(
  options: {
    rpcUrl?: string;
    transportForChain?: (chainId: number) => import("viem").Transport;
    transport?: import("viem").Transport;
    confirmations?: number;
    retryPolicy?: import("./retry").RetryPolicy;
  } = {},
) {
  const { executeTransaction } = await import("./execute");
  const { createViemTransactionAdapter } = await import("./viem-adapter");
  const { loadClaimedMintJob, loadSigningWallet } = await import(
    "./claimed-job"
  );
  const { failUnsubmittedExecution } = await import("./failure");
  const { TransactionEngineError } = await import("./errors");
  return {
    async executeClaimedJob(jobId: string, attemptId: string) {
      try {
        const { job, request } = await loadClaimedMintJob(jobId, attemptId);
        const network = getNetwork(job.chainId);
        if (!network) throw new TransactionEngineError("INVALID_EXECUTION", "Unsupported job network");
        const transport = options.transportForChain?.(job.chainId) ?? options.transport;
        const adapter = createViemTransactionAdapter({
          chain: network.chain,
          address: request.from,
          rpcUrl: transport ? undefined : options.rpcUrl ?? getNetworkRpcUrl(job.chainId),
          transport,
          confirmations: options.confirmations,
          loadEncryptedWallet: () =>
            loadSigningWallet(job.walletId, job.userId, request.from),
        });
        return await executeTransaction(
          adapter,
          { mintJobId: job.id, executionAttemptId: attemptId, request },
          options.retryPolicy,
        );
      } catch (error) {
        if (
          error instanceof TransactionEngineError &&
          error.code === "INVALID_EXECUTION"
        ) {
          await failUnsubmittedExecution(
            attemptId,
            error.code,
            error.message,
            jobId,
          );
          return { status: "failed", code: error.code };
        }
        // Database/provider errors may embed values. Do not propagate their text.
        throw new TransactionEngineError(
          "RPC_FAILED",
          "Execution could not be loaded or persisted",
          true,
        );
      }
    },
  };
}
