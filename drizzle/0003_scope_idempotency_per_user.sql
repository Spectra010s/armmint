DROP INDEX IF EXISTS "mint_jobs_idempotency_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "mint_jobs_user_idempotency_unique" ON "mint_jobs" USING btree ("user_id","idempotency_key");
