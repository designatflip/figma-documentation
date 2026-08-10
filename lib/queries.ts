import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db";
import { flows, screens, screenTexts } from "@/db/schema";
import type { DriftState } from "@/db/schema";

/**
 * The catalog only changes when a sync runs, and that run calls
 * `revalidateTag('catalog')`. Everything below shares the tag.
 */
const CATALOG_TAG = "catalog";

/**
 * Live rows only.
 *
 * `archived_at IS NULL` is the single most important predicate in the app —
 * a query that forgets it leaks unpublished screens, which is the failure
 * mode the whole publishing model exists to prevent. It lives here once so no
 * call site has to remember it.
 */
const liveScreen = () => isNull(screens.archivedAt);
const liveFlow = () => isNull(flows.archivedAt);

export interface FlowSummary {
  id: string;
  name: string;
  slug: string;
  screenCount: number;
  coverImageUrl: string | null;
  lastSyncedAt: Date | null;
}

export async function getFlows(): Promise<FlowSummary[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("days");

  const rows = await db
    .select({
      id: flows.id,
      name: flows.name,
      slug: flows.slug,
      lastSyncedAt: flows.lastSyncedAt,
      screenCount: sql<number>`count(${screens.id})::int`,
      coverImageUrl: sql<
        string | null
      >`(array_agg(${screens.imageUrl} ORDER BY ${screens.position}) FILTER (WHERE ${screens.imageUrl} IS NOT NULL))[1]`,
    })
    .from(flows)
    .leftJoin(screens, and(eq(screens.flowId, flows.id), liveScreen()))
    .where(liveFlow())
    .groupBy(flows.id)
    .having(sql`count(${screens.id}) > 0`)
    .orderBy(asc(flows.name));

  return rows;
}

export interface ScreenCard {
  id: string;
  name: string;
  section: string | null;
  description: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  driftState: DriftState;
}

export interface FlowDetail {
  id: string;
  name: string;
  slug: string;
  lastSyncedAt: Date | null;
  /** Grouped by Figma page. A single unnamed group means no sub-structure. */
  sections: { name: string | null; screens: ScreenCard[] }[];
}

export async function getFlowBySlug(slug: string): Promise<FlowDetail | null> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("days");

  const [flow] = await db
    .select()
    .from(flows)
    .where(and(eq(flows.slug, slug), liveFlow()))
    .limit(1);

  if (!flow) return null;

  const rows = await db
    .select({
      id: screens.id,
      name: screens.name,
      section: screens.section,
      description: screens.description,
      imageUrl: screens.imageUrl,
      imageWidth: screens.imageWidth,
      imageHeight: screens.imageHeight,
      driftState: screens.driftState,
    })
    .from(screens)
    .where(and(eq(screens.flowId, flow.id), liveScreen()))
    .orderBy(asc(screens.position));

  const grouped = new Map<string | null, ScreenCard[]>();
  for (const row of rows) {
    const key = row.section;
    const list = grouped.get(key) ?? [];
    list.push(row as ScreenCard);
    grouped.set(key, list);
  }

  return {
    id: flow.id,
    name: flow.name,
    slug: flow.slug,
    lastSyncedAt: flow.lastSyncedAt,
    sections: [...grouped].map(([name, list]) => ({ name, screens: list })),
  };
}

export interface ScreenDetail {
  id: string;
  name: string;
  section: string | null;
  description: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  figmaUrl: string;
  sourceUrl: string | null;
  driftState: DriftState;
  driftCheckedAt: Date | null;
  textContent: string | null;
  archivedAt: Date | null;
  flowName: string;
  flowSlug: string;
  texts: { content: string; x: number; y: number; w: number; h: number }[];
}

/**
 * Archived screens are intentionally still resolvable here. A link shared in
 * Slack months ago should explain itself rather than 404; the page renders it
 * read-only with a notice.
 */
export async function getScreenById(id: string): Promise<ScreenDetail | null> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("days");

  const [row] = await db
    .select({
      id: screens.id,
      name: screens.name,
      section: screens.section,
      description: screens.description,
      imageUrl: screens.imageUrl,
      imageWidth: screens.imageWidth,
      imageHeight: screens.imageHeight,
      figmaUrl: screens.figmaUrl,
      sourceUrl: screens.sourceUrl,
      driftState: screens.driftState,
      driftCheckedAt: screens.driftCheckedAt,
      textContent: screens.textContent,
      archivedAt: screens.archivedAt,
      flowName: flows.name,
      flowSlug: flows.slug,
    })
    .from(screens)
    .innerJoin(flows, eq(flows.id, screens.flowId))
    .where(eq(screens.id, id))
    .limit(1);

  if (!row) return null;

  const texts = await db
    .select({
      content: screenTexts.content,
      x: screenTexts.x,
      y: screenTexts.y,
      w: screenTexts.w,
      h: screenTexts.h,
    })
    .from(screenTexts)
    .where(eq(screenTexts.screenId, id));

  return { ...row, texts } as ScreenDetail;
}

export interface SearchHit {
  id: string;
  name: string;
  flowName: string;
  flowSlug: string;
  section: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  /** `ts_headline` fragment of the matched in-screen copy, may contain <mark>. */
  snippet: string | null;
  matchedIn: "text" | "name";
}

const SEARCH_LIMIT = 60;
/** Below this, fall back to trigram matching before giving up. */
const FALLBACK_THRESHOLD = 5;

export async function searchScreens(query: string): Promise<SearchHit[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("days");

  const trimmed = query.trim();
  if (!trimmed) return [];

  // `websearch_to_tsquery` accepts quoted phrases and OR/-, and never throws
  // on malformed input the way `to_tsquery` does.
  const ranked = await db.execute(sql`
    SELECT
      s.id,
      s.name,
      s.section,
      s.image_url        AS "imageUrl",
      s.image_width      AS "imageWidth",
      s.image_height     AS "imageHeight",
      f.name             AS "flowName",
      f.slug             AS "flowSlug",
      ts_headline(
        'simple', coalesce(s.text_content, ''), q,
        'MaxFragments=2, MaxWords=14, MinWords=4, StartSel=<mark>, StopSel=</mark>'
      )                  AS snippet,
      ts_rank(s.search_vector, q) AS rank
    FROM screens s
    JOIN flows f ON f.id = s.flow_id,
         websearch_to_tsquery('simple', ${trimmed}) q
    WHERE s.archived_at IS NULL
      AND f.archived_at IS NULL
      AND s.search_vector @@ q
    ORDER BY rank DESC, s.name ASC
    LIMIT ${SEARCH_LIMIT}
  `);

  if (ranked.length >= FALLBACK_THRESHOLD) {
    return (ranked as unknown as SearchHit[]).map((hit) => ({
      ...hit,
      matchedIn: "text" as const,
    }));
  }

  // Trigram fallback. The search config is 'simple' (no stemming, correct for
  // mixed Indonesian/English), so "transfers" does not match "transfer" —
  // ILIKE over the gin_trgm_ops index covers substrings and near-misses.
  const pattern = `%${trimmed}%`;
  const fuzzy = await db.execute(sql`
    SELECT
      s.id,
      s.name,
      s.section,
      s.image_url    AS "imageUrl",
      s.image_width  AS "imageWidth",
      s.image_height AS "imageHeight",
      f.name         AS "flowName",
      f.slug         AS "flowSlug",
      NULL           AS snippet,
      GREATEST(
        similarity(s.name, ${trimmed}),
        similarity(coalesce(s.text_content, ''), ${trimmed})
      ) AS rank
    FROM screens s
    JOIN flows f ON f.id = s.flow_id
    WHERE s.archived_at IS NULL
      AND f.archived_at IS NULL
      AND (s.name ILIKE ${pattern} OR s.text_content ILIKE ${pattern})
    ORDER BY rank DESC, s.name ASC
    LIMIT ${SEARCH_LIMIT}
  `);

  const merged = new Map<string, SearchHit>();
  for (const hit of ranked as unknown as SearchHit[]) {
    merged.set(hit.id, { ...hit, matchedIn: "text" });
  }
  for (const hit of fuzzy as unknown as SearchHit[]) {
    if (!merged.has(hit.id)) merged.set(hit.id, { ...hit, matchedIn: "name" });
  }
  return [...merged.values()];
}

export interface AdminFlowStatus {
  id: string;
  name: string;
  slug: string;
  syncStatus: string;
  syncError: string | null;
  lastSyncedAt: Date | null;
  lastModified: Date | null;
  screenCount: number;
  driftCount: number;
  archivedAt: Date | null;
}

/** Not cached — the admin page exists to show current state. */
export async function getAdminStatus(): Promise<AdminFlowStatus[]> {
  const rows = await db
    .select({
      id: flows.id,
      name: flows.name,
      slug: flows.slug,
      syncStatus: flows.syncStatus,
      syncError: flows.syncError,
      lastSyncedAt: flows.lastSyncedAt,
      lastModified: flows.lastModified,
      archivedAt: flows.archivedAt,
      screenCount: sql<number>`count(${screens.id}) FILTER (WHERE ${screens.archivedAt} IS NULL)::int`,
      driftCount: sql<number>`count(${screens.id}) FILTER (WHERE ${screens.archivedAt} IS NULL AND ${screens.driftState} IN ('content_changed','source_changed'))::int`,
    })
    .from(flows)
    .leftJoin(screens, eq(screens.flowId, flows.id))
    .groupBy(flows.id)
    .orderBy(asc(flows.name));

  return rows;
}
