CREATE TABLE "plugin_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text,
	"pairing_state" text,
	"pickup_token" text,
	"pickup_expires_at" timestamp with time zone,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paired_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_locks" (
	"id" text PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"started_by" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_tokens_token_hash_idx" ON "plugin_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_tokens_pairing_state_idx" ON "plugin_tokens" USING btree ("pairing_state");--> statement-breakpoint
CREATE INDEX "plugin_tokens_clerk_user_id_idx" ON "plugin_tokens" USING btree ("clerk_user_id");