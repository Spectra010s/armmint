CREATE TABLE "telegram_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"username" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_user_id_unique" ON "telegram_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_telegram_user_id_unique" ON "telegram_accounts" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_tokens_digest_unique" ON "telegram_link_tokens" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_user_id_idx" ON "telegram_link_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_expires_at_idx" ON "telegram_link_tokens" USING btree ("expires_at");