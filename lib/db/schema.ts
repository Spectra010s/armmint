import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  foreignKey,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.token),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("accounts_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("verifications_identifier_idx").on(table.identifier),
    index("verifications_expires_at_idx").on(table.expiresAt),
  ],
);

export const telegramAccounts = pgTable(
  "telegram_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull(),
    username: text("username"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("telegram_accounts_user_id_unique").on(table.userId),
    uniqueIndex("telegram_accounts_telegram_user_id_unique").on(
      table.telegramUserId,
    ),
  ],
);

export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenDigest: text("token_digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("telegram_link_tokens_digest_unique").on(table.tokenDigest),
    index("telegram_link_tokens_user_id_idx").on(table.userId),
    index("telegram_link_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

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

export const wallets = pgTable(
  "wallets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    encryptionAuthTag: text("encryption_auth_tag").notNull(),
    encryptionKeyVersion: integer("encryption_key_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("wallets_user_id_unique").on(table.userId),
    check(
      "wallets_encryption_key_version_positive",
      sql`${table.encryptionKeyVersion} > 0`,
    ),
  ],
);

export const mintJobs = pgTable(
  "mint_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict" }),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    contractAddress: text("contract_address").notNull(),
    // Encoded contract call, including quantity/proof arguments, supplied at scheduling.
    calldata: text("calldata"),
    valueWei: text("value_wei").default("0").notNull(),
    engineLeaseId: text("engine_lease_id"),
    engineLeaseExpiresAt: timestamp("engine_lease_expires_at", {
      withTimezone: true,
    }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    state: mintJobState("state").default("SCHEDULED").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("mint_jobs_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("mint_jobs_due_idx")
      .on(table.scheduledFor)
      .where(sql`${table.state} = 'SCHEDULED'`),
    index("mint_jobs_claim_expiry_idx")
      .on(table.claimExpiresAt)
      .where(sql`${table.state} = 'CLAIMED'`),
    index("mint_jobs_user_created_idx").on(table.userId, table.createdAt),
    check("mint_jobs_chain_id_positive", sql`${table.chainId} > 0`),
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
    retryCount: integer("retry_count").default(0).notNull(),
    state: executionAttemptState("state").default("PENDING").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("execution_attempts_job_number_unique").on(
      table.mintJobId,
      table.attemptNumber,
    ),
    index("execution_attempts_job_idx").on(table.mintJobId),
    check(
      "execution_attempts_number_positive",
      sql`${table.attemptNumber} > 0`,
    ),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    executionAttemptId: text("execution_attempt_id")
      .notNull()
      .references(() => executionAttempts.id, { onDelete: "restrict" }),
    replacesTransactionId: text("replaces_transaction_id").references(
      (): AnyPgColumn => transactions.id,
      { onDelete: "restrict" },
    ),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    hash: text("hash"),
    // Public, immutable signing inputs. Never store a key or signed payload here.
    request: jsonb("request").$type<{
      from: string;
      to: string;
      data: string;
      value: string;
      gas: string;
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
    }>(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    nonce: bigint("nonce", { mode: "number" }).notNull(),
    state: transactionState("state").default("CREATED").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("transactions_chain_hash_unique")
      .on(table.chainId, table.hash)
      .where(sql`${table.hash} IS NOT NULL`),
    unique("transactions_replacement_identity_unique").on(table.id, table.chainId, table.nonce, table.executionAttemptId),
    foreignKey({
      name: "transactions_replacement_same_network_fk",
      columns: [table.replacesTransactionId, table.chainId, table.nonce, table.executionAttemptId],
      foreignColumns: [table.id, table.chainId, table.nonce, table.executionAttemptId],
    }).onDelete("restrict"),
    index("transactions_attempt_idx").on(table.executionAttemptId),
    uniqueIndex("transactions_replaces_unique").on(table.replacesTransactionId),
    check("transactions_chain_id_positive", sql`${table.chainId} > 0`),
    check("transactions_nonce_nonnegative", sql`${table.nonce} >= 0`),
    check(
      "transactions_not_self_replacing",
      sql`${table.replacesTransactionId} IS NULL OR ${table.replacesTransactionId} <> ${table.id}`,
    ),
  ],
);

// One durable conversation per linked account. Only validated public mint inputs
// are stored; raw Telegram messages and signing secrets never enter this table.
export const telegramConversations = pgTable("telegram_conversations", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  draft: jsonb("draft").$type<import("../server/telegram-types").MintDraft>(),
  lastUpdateId: bigint("last_update_id", { mode: "number" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
