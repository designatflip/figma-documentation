CREATE TABLE "screen_clips" (
	"screen_id" uuid PRIMARY KEY NOT NULL,
	"blob_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"captured_image_hash" text,
	"captured_by_email" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screen_clips" ADD CONSTRAINT "screen_clips_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;