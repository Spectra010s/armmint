import type { TransactionChainAdapter, TransactionRequest } from "./types";
import { executeTransaction } from "./execute";

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

      await executeTransaction(adapter, {
        mintJobId: execution.jobId,
        executionAttemptId: execution.executionAttemptId,
        request: execution.request,
      });
    },
  };
}
