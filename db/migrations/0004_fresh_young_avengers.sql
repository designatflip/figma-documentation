CREATE TABLE "flow_prototypes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"screen_node_id" text NOT NULL,
	"name" text NOT NULL,
	"section" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_prototypes" ADD CONSTRAINT "flow_prototypes_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flow_prototypes_flow_node_idx" ON "flow_prototypes" USING btree ("flow_id","node_id");--> statement-breakpoint
CREATE INDEX "flow_prototypes_flow_id_idx" ON "flow_prototypes" USING btree ("flow_id");