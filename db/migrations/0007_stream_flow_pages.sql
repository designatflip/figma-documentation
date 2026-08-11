-- The catalogue grows a level: a Figma *file* is a stream, a *page* is a flow.
--
-- Hand-written rather than generated, because the differ can only express this
-- as "drop flows, create streams", and that would take every screen with it —
-- along with the ids in every link ever shared and every clipboard payload
-- captured by hand through the plugin. Renaming and backfilling keeps all of it.
--
-- The old `flows` row was the file, and the page was carried on each screen as
-- the free-text `section`. Those distinct strings become the new `flows` rows.

--> statement-breakpoint
ALTER TABLE "flows" RENAME TO "streams";--> statement-breakpoint
-- Postgres leaves constraint and index names alone on a table rename, and the
-- new `flows` table below needs them free.
ALTER TABLE "streams" RENAME CONSTRAINT "flows_pkey" TO "streams_pkey";--> statement-breakpoint
ALTER INDEX "flows_file_key_idx" RENAME TO "streams_file_key_idx";--> statement-breakpoint
ALTER INDEX "flows_slug_idx" RENAME TO "streams_slug_idx";--> statement-breakpoint
ALTER INDEX "flows_archived_at_idx" RENAME TO "streams_archived_at_idx";--> statement-breakpoint

CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stream_id" uuid NOT NULL,
	"page_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flows_stream_page_idx" ON "flows" USING btree ("stream_id","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flows_stream_slug_idx" ON "flows" USING btree ("stream_id","slug");--> statement-breakpoint
CREATE INDEX "flows_stream_id_idx" ON "flows" USING btree ("stream_id");--> statement-breakpoint
CREATE INDEX "flows_archived_at_idx" ON "flows" USING btree ("archived_at");--> statement-breakpoint

-- One flow per distinct page name already documented under each stream.
--
-- `page_id` is left null: no page id was ever recorded, and inventing one would
-- be worse than admitting it. The next sync matches these rows by name and
-- stamps the real id — see `resolveFlow` in lib/figma/sync.ts.
--
-- Screens whose section was never set fall back to the stream's own name, which
-- is what a single-page file looked like before this change.
INSERT INTO "flows" ("stream_id", "name", "slug", "position", "last_synced_at", "archived_at")
SELECT
	page."stream_id",
	page."name",
	-- The sync rewrites this on the next run; it only has to be stable and
	-- unique within the stream until then.
	btrim(regexp_replace(lower(page."name"), '[^a-z0-9]+', '-', 'g'), '-') AS "slug",
	row_number() OVER (PARTITION BY page."stream_id" ORDER BY page."first_position") - 1 AS "position",
	page."last_synced_at",
	page."archived_at"
FROM (
	SELECT
		st."id" AS "stream_id",
		COALESCE(NULLIF(btrim(s."section"), ''), st."name") AS "name",
		min(s."position") AS "first_position",
		max(st."last_synced_at") AS "last_synced_at",
		-- A page under an archived stream is archived with it; nothing else
		-- could have unpublished a page before pages existed.
		max(st."archived_at") AS "archived_at"
	FROM "screens" s
	JOIN "streams" st ON st."id" = s."flow_id"
	GROUP BY st."id", COALESCE(NULLIF(btrim(s."section"), ''), st."name")
) page;--> statement-breakpoint

-- Repoint the children. Both columns currently hold a stream id, which is
-- exactly what the join needs — and why the foreign keys come off first.
ALTER TABLE "screens" DROP CONSTRAINT "screens_flow_id_flows_id_fk";--> statement-breakpoint
ALTER TABLE "flow_prototypes" DROP CONSTRAINT "flow_prototypes_flow_id_flows_id_fk";--> statement-breakpoint

UPDATE "screens" s
SET "flow_id" = f."id"
FROM "flows" f, "streams" st
WHERE st."id" = s."flow_id"
  AND f."stream_id" = s."flow_id"
  AND f."name" = COALESCE(NULLIF(btrim(s."section"), ''), st."name");--> statement-breakpoint

-- A starting point on a page with nothing published has no flow to hang off.
-- It is re-derived from Figma on every sync, so dropping it costs nothing.
DELETE FROM "flow_prototypes" p
WHERE NOT EXISTS (
	SELECT 1
	FROM "flows" f
	JOIN "streams" st ON st."id" = f."stream_id"
	WHERE f."stream_id" = p."flow_id"
	  AND f."name" = COALESCE(NULLIF(btrim(p."section"), ''), st."name")
);--> statement-breakpoint

UPDATE "flow_prototypes" p
SET "flow_id" = f."id"
FROM "flows" f, "streams" st
WHERE st."id" = p."flow_id"
  AND f."stream_id" = p."flow_id"
  AND f."name" = COALESCE(NULLIF(btrim(p."section"), ''), st."name");--> statement-breakpoint

ALTER TABLE "screens" ADD CONSTRAINT "screens_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_prototypes" ADD CONSTRAINT "flow_prototypes_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The page is a row now, so neither table carries its name as a string.
ALTER TABLE "screens" DROP COLUMN "section";--> statement-breakpoint
ALTER TABLE "flow_prototypes" DROP COLUMN "section";
