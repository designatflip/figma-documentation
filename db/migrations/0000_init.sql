CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_key" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"thumbnail_url" text,
	"last_modified" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "screen_tags" (
	"screen_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "screen_tags_screen_id_tag_id_pk" PRIMARY KEY("screen_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "screen_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"node_id" text,
	"content" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"w" real NOT NULL,
	"h" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"section" text,
	"description" text,
	"image_url" text,
	"image_width" integer,
	"image_height" integer,
	"image_hash" text,
	"figma_url" text NOT NULL,
	"source_file_key" text,
	"source_node_id" text,
	"source_url" text,
	"source_hash" text,
	"source_text" text,
	"drift_state" text DEFAULT 'unknown' NOT NULL,
	"drift_checked_at" timestamp with time zone,
	"text_content" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(name, '')), 'A')
       || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
       || setweight(to_tsvector('simple', coalesce(text_content, '')), 'C')) STORED,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screen_tags" ADD CONSTRAINT "screen_tags_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_tags" ADD CONSTRAINT "screen_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_texts" ADD CONSTRAINT "screen_texts_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flows_file_key_idx" ON "flows" USING btree ("file_key");--> statement-breakpoint
CREATE UNIQUE INDEX "flows_slug_idx" ON "flows" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "flows_archived_at_idx" ON "flows" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "screen_texts_screen_id_idx" ON "screen_texts" USING btree ("screen_id");--> statement-breakpoint
CREATE UNIQUE INDEX "screens_flow_node_idx" ON "screens" USING btree ("flow_id","node_id");--> statement-breakpoint
CREATE INDEX "screens_flow_id_idx" ON "screens" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "screens_archived_at_idx" ON "screens" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "screens_source_file_key_idx" ON "screens" USING btree ("source_file_key");--> statement-breakpoint
CREATE INDEX "screens_search_vector_idx" ON "screens" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_idx" ON "tags" USING btree ("slug");