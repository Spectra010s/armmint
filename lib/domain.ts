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
  replacesTransactionId?: string;
  chainId: number;
  hash?: string;
  nonce: number;
  state: TransactionState;
  createdAt: Date;
  updatedAt: Date;
}

export const MINT_JOB_TRANSITIONS = {
  SCHEDULED: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["SIMULATING", "FAILED", "CANCELLED"],
  SIMULATING: ["SIGNING", "FAILED"],
  SIGNING: ["SUBMITTING", "FAILED"],
  SUBMITTING: ["SUBMITTED", "RETRYING", "FAILED"],
  SUBMITTED: ["CONFIRMING", "RETRYING", "FAILED"],
  RETRYING: ["SUBMITTING", "SUBMITTED", "CONFIRMING", "FAILED"],
  CONFIRMING: ["SUCCEEDED", "RETRYING", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
} as const satisfies Record<MintJobState, readonly MintJobState[]>;

export const EXECUTION_ATTEMPT_TRANSITIONS = {
  PENDING: ["RUNNING", "FAILED"],
  RUNNING: ["RETRYING", "SUCCEEDED", "FAILED"],
  RETRYING: ["RUNNING", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
} as const satisfies Record<ExecutionAttemptState, readonly ExecutionAttemptState[]>;

export const TRANSACTION_TRANSITIONS = {
  CREATED: ["SUBMITTED", "DROPPED"],
  SUBMITTED: ["CONFIRMING", "REPLACED", "DROPPED", "REVERTED"],
  CONFIRMING: ["CONFIRMED", "REPLACED", "DROPPED", "REVERTED"],
  CONFIRMED: [],
  REPLACED: [],
  DROPPED: [],
  REVERTED: [],
} as const satisfies Record<TransactionState, readonly TransactionState[]>;

function canTransition<TState extends string>(
  transitions: Record<TState, readonly TState[]>,
  from: TState,
  to: TState,
): boolean {
  return transitions[from].includes(to);
}

function transition<TState extends string>(
  entity: string,
  transitions: Record<TState, readonly TState[]>,
  from: TState,
  to: TState,
): TState {
  if (!canTransition(transitions, from, to)) {
    throw new Error(`Invalid ${entity} transition: ${from} -> ${to}`);
  }

  return to;
}

export function canTransitionMintJob(
  from: MintJobState,
  to: MintJobState,
): boolean {
  return canTransition(MINT_JOB_TRANSITIONS, from, to);
}

export function transitionMintJob(
  from: MintJobState,
  to: MintJobState,
): MintJobState {
  return transition("MintJob", MINT_JOB_TRANSITIONS, from, to);
}

export function canTransitionExecutionAttempt(
  from: ExecutionAttemptState,
  to: ExecutionAttemptState,
): boolean {
  return canTransition(EXECUTION_ATTEMPT_TRANSITIONS, from, to);
}

export function transitionExecutionAttempt(
  from: ExecutionAttemptState,
  to: ExecutionAttemptState,
): ExecutionAttemptState {
  return transition(
    "ExecutionAttempt",
    EXECUTION_ATTEMPT_TRANSITIONS,
    from,
    to,
  );
}

export function canTransitionTransaction(
  from: TransactionState,
  to: TransactionState,
): boolean {
  return canTransition(TRANSACTION_TRANSITIONS, from, to);
}

export function transitionTransaction(
  from: TransactionState,
  to: TransactionState,
): TransactionState {
  return transition("Transaction", TRANSACTION_TRANSITIONS, from, to);
}
