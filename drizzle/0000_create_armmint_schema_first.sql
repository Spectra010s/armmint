CREATE TYPE "public"."execution_attempt_state" AS ENUM('PENDING', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."mint_job_state" AS ENUM('SCHEDULED', 'CLAIMED', 'SIMULATING', 'SIGNING', 'SUBMITTING', 'SUBMITTED', 'RETRYING', 'CONFIRMING', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."transaction_state" AS ENUM('CREATED', 'SUBMITTED', 'CONFIRMING', 'CONFIRMED', 'REPLACED', 'DROPPED', 'REVERTED');--> statement-breakpoint
CREATE TABLE "execution_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"mint_job_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"state" "execution_attempt_state" DEFAULT 'PENDING' NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_attempts_number_positive" CHECK ("execution_attempts"."attempt_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "mint_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"chain_id" bigint NOT NULL,
	"contract_address" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"state" "mint_job_state" DEFAULT 'SCHEDULED' NOT NULL,
	"idempotency_key" text NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"claimed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mint_jobs_chain_id_positive" CHECK ("mint_jobs"."chain_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_attempt_id" text NOT NULL,
	"replaces_transaction_id" text,
	"chain_id" bigint NOT NULL,
	"hash" text,
	"nonce" bigint NOT NULL,
	"state" "transaction_state" DEFAULT 'CREATED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_chain_id_positive" CHECK ("transactions"."chain_id" > 0),
	CONSTRAINT "transactions_nonce_nonnegative" CHECK ("transactions"."nonce" >= 0),
	CONSTRAINT "transactions_not_self_replacing" CHECK ("transactions"."replaces_transaction_id" IS NULL OR "transactions"."replaces_transaction_id" <> "transactions"."id")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"encryption_iv" text NOT NULL,
	"encryption_auth_tag" text NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_encryption_key_version_positive" CHECK ("wallets"."encryption_key_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_mint_job_id_mint_jobs_id_fk" FOREIGN KEY ("mint_job_id") REFERENCES "public"."mint_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mint_jobs" ADD CONSTRAINT "mint_jobs_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_execution_attempt_id_execution_attempts_id_fk" FOREIGN KEY ("execution_attempt_id") REFERENCES "public"."execution_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_attempts_job_number_unique" ON "execution_attempts" USING btree ("mint_job_id","attempt_number");--> statement-breakpoint
CREATE INDEX "execution_attempts_job_idx" ON "execution_attempts" USING btree ("mint_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mint_jobs_idempotency_key_unique" ON "mint_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "mint_jobs_due_idx" ON "mint_jobs" USING btree ("scheduled_for") WHERE "mint_jobs"."state" = 'SCHEDULED';--> statement-breakpoint
CREATE INDEX "mint_jobs_claim_expiry_idx" ON "mint_jobs" USING btree ("claim_expires_at") WHERE "mint_jobs"."state" = 'CLAIMED';--> statement-breakpoint
CREATE INDEX "mint_jobs_user_created_idx" ON "mint_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_hash_unique" ON "transactions" USING btree ("hash") WHERE "transactions"."hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_attempt_idx" ON "transactions" USING btree ("execution_attempt_id");--> statement-breakpoint
CREATE INDEX "transactions_replaces_idx" ON "transactions" USING btree ("replaces_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_id_unique" ON "wallets" USING btree ("user_id");