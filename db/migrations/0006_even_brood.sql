CREATE TABLE "screen_hotspots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"node_id" text,
	"name" text,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"w" real NOT NULL,
	"h" real NOT NULL,
	"trigger" text,
	"destination_node_id" text
);
--> statement-breakpoint
ALTER TABLE "screen_hotspots" ADD CONSTRAINT "screen_hotspots_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screen_hotspots_screen_id_idx" ON "screen_hotspots" USING btree ("screen_id");