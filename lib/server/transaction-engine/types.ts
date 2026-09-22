export type TransactionRequest = {
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

export type PreparedTransaction = TransactionRequest & {
  nonce: number;
};

export type SubmittedTransaction = {
  hash: `0x${string}`;
  nonce: number;
};

export type TransactionReceiptResult =
  | { state: "CONFIRMED"; hash: `0x${string}` }
  | { state: "REVERTED"; hash: `0x${string}`; reason?: string }
  | { state: "PENDING"; hash: `0x${string}` };

export interface TransactionChainAdapter {
  simulate(request: TransactionRequest): Promise<void>;
  getPendingNonce(address: `0x${string}`): Promise<number>;
  submit(request: PreparedTransaction): Promise<SubmittedTransaction>;
  waitForReceipt(hash: `0x${string}`): Promise<TransactionReceiptResult>;
}

export interface TransactionEngine {
  executeClaimedJob(jobId: string): Promise<void>;
}
