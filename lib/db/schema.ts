import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const mintJobState = pgEnum("mint_job_state", [
  "SCHEDULED",
  "CLAIMED",
  "SIMULATING",
  "SIGNING",
  "SUBMITTING",
  "SUBMITTED",
  "RETRYING",
  "CONFIRMING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export const executionAttemptState = pgEnum("execution_attempt_state", [
  "PENDING",
  "RUNNING",
  "RETRYING",
  "SUCCEEDED",
  "FAILED",
]);

export const transactionState = pgEnum("transaction_state", [
  "CREATED",
  "SUBMITTED",
  "CONFIRMING",
  "CONFIRMED",
  "REPLACED",
  "DROPPED",
  "REVERTED",
]);

// Better Auth owns the user row under #5. Application tables intentionally
// reference its string user ID without duplicating an ArmMint user table here.
export const wallets = pgTable(
  "wallets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    address: text("address").notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    encryptionAuthTag: text("encryption_auth_tag").notNull(),
    encryptionKeyVersion: integer("encryption_key_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("wallets_user_id_unique").on(table.userId)],
);

export const mintJobs = pgTable(
  "mint_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict" }),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    contractAddress: text("contract_address").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    state: mintJobState("state").default("SCHEDULED").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("mint_jobs_idempotency_key_unique").on(table.idempotencyKey),
  ],
);

export const executionAttempts = pgTable(
  "execution_attempts",
  {
    id: text("id").primaryKey(),
    mintJobId: text("mint_job_id")
      .notNull()
      .references(() => mintJobs.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    state: executionAttemptState("state").default("PENDING").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("execution_attempts_job_number_unique").on(
      table.mintJobId,
      table.attemptNumber,
    ),
  ],
);

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  executionAttemptId: text("execution_attempt_id")
    .notNull()
    .references(() => executionAttempts.id, { onDelete: "restrict" }),
  replacesTransactionId: text("replaces_transaction_id"),
  chainId: bigint("chain_id", { mode: "number" }).notNull(),
  hash: text("hash"),
  nonce: bigint("nonce", { mode: "number" }).notNull(),
  state: transactionState("state").default("CREATED").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
