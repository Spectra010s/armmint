import type {
  PreparedTransaction,
  SubmittedTransaction,
  TransactionChainAdapter,
  TransactionReceiptResult,
  TransactionRequest,
} from "./types";

export type EvmRpcClient = {
  simulate(request: TransactionRequest): Promise<void>;
  getPendingNonce(address: `0x${string}`): Promise<number>;
  broadcast(request: PreparedTransaction): Promise<SubmittedTransaction>;
  receipt(hash: `0x${string}`): Promise<TransactionReceiptResult>;
};

export function createEvmChainAdapter(client: EvmRpcClient): TransactionChainAdapter {
  return {
    simulate: (request) => client.simulate(request),
    getPendingNonce: (address) => client.getPendingNonce(address),
    submit: (request) => client.broadcast(request),
    waitForReceipt: (hash) => client.receipt(hash),
  };
}
