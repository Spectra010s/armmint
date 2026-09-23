CREATE TABLE "telegram_conversations" (
	"user_id" text PRIMARY KEY NOT NULL,
	"draft" jsonb,
	"last_update_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "mint_jobs_idempotency_key_unique";--> statement-breakpoint
DROP INDEX "transactions_replaces_idx";--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mint_jobs" ADD COLUMN "calldata" text;--> statement-breakpoint
ALTER TABLE "mint_jobs" ADD COLUMN "value_wei" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "mint_jobs" ADD COLUMN "engine_lease_id" text;--> statement-breakpoint
ALTER TABLE "mint_jobs" ADD COLUMN "engine_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "request" jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_conversations" ADD CONSTRAINT "telegram_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mint_jobs_user_idempotency_unique" ON "mint_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_replaces_unique" ON "transactions" USING btree ("replaces_transaction_id");