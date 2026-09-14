export type MintJobState =
  | "SCHEDULED"
  | "CLAIMED"
  | "SIMULATING"
  | "SIGNING"
  | "SUBMITTING"
  | "SUBMITTED"
  | "RETRYING"
  | "CONFIRMING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type ExecutionAttemptState =
  | "PENDING"
  | "RUNNING"
  | "RETRYING"
  | "SUCCEEDED"
  | "FAILED";

export type TransactionState =
  | "CREATED"
  | "SUBMITTED"
  | "CONFIRMING"
  | "CONFIRMED"
  | "REPLACED"
  | "DROPPED"
  | "REVERTED";

export interface User {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Wallet {
  id: string;
  userId: string;
  address: string;
  encryptedPrivateKey: string;
  encryptionIv: string;
  encryptionAuthTag: string;
  encryptionKeyVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MintJob {
  id: string;
  userId: string;
  walletId: string;
  chainId: number;
  contractAddress: string;
  scheduledFor: Date;
  state: MintJobState;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionAttempt {
  id: string;
  mintJobId: string;
  attemptNumber: number;
  state: ExecutionAttemptState;
  failureCode?: string;
  failureMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  executionAttemptId: string;
  chainId: number;
  hash?: string;
  nonce: number;
  state: TransactionState;
  createdAt: Date;
  updatedAt: Date;
}

const MINT_JOB_TRANSITIONS: Record<MintJobState, readonly MintJobState[]> = {
  SCHEDULED: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["SIMULATING", "FAILED", "CANCELLED"],
  SIMULATING: ["SIGNING", "FAILED"],
  SIGNING: ["SUBMITTING", "FAILED"],
  SUBMITTING: ["SUBMITTED", "RETRYING", "FAILED"],
  SUBMITTED: ["CONFIRMING", "RETRYING", "FAILED"],
  RETRYING: ["SUBMITTED", "FAILED"],
  CONFIRMING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionMintJob(
  from: MintJobState,
  to: MintJobState,
): boolean {
  return MINT_JOB_TRANSITIONS[from].includes(to);
}

export function transitionMintJob(
  from: MintJobState,
  to: MintJobState,
): MintJobState {
  if (!canTransitionMintJob(from, to)) {
    throw new Error(`Invalid MintJob transition: ${from} -> ${to}`);
  }

  return to;
}
