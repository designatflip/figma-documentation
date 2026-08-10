-- Trigram matching, used as the fallback when `tsquery` returns too few rows.
--
-- The search config is 'simple' (see db/schema.ts), which does no stemming --
-- correct for mixed Indonesian/English UI copy, but it means "transfers" will
-- not match "transfer". pg_trgm covers that gap plus typo tolerance.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "screens_text_content_trgm_idx"
  ON "screens" USING gin ("text_content" gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "screens_name_trgm_idx"
  ON "screens" USING gin ("name" gin_trgm_ops);
