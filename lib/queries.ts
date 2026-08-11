import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db";
import {
  flowPrototypes,
  flows,
  screenHotspots,
  screens,
  screenTexts,
} from "@/db/schema";
import type { DriftState } from "@/db/schema";
import { FULL_BLEED_AREA } from "@/lib/figma/extract";

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

/** A frame as the home page's rail draws it: the render, and whether it drifted. */
export interface FlowRailScreen {
  id: string;
  name: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  driftState: DriftState;
}

export interface FlowSummary {
  id: string;
  name: string;
  slug: string;
  lastSyncedAt: Date | null;
  /**
   * The whole flow, in sync order, with the Figma pages flattened into one run.
   * The home page shows a flow as a single horizontal rail, so there is no
   * second axis for sections to group along — same reading the lightbox strip
   * takes of the same screens.
   */
  screens: FlowRailScreen[];
}

/**
 * Every documented flow with its screens, for the home page's rails.
 *
 * One join rather than a count plus a cover image plus a query per flow: the
 * catalogue is small, the whole result is cached for days under the `catalog`
 * tag, and a flow's screens are what the home page is now made of rather than
 * something it links to.
 *
 * `innerJoin` does the work `having count(*) > 0` used to: a flow with nothing
 * live under it has nothing to draw, so it drops out on its own.
 */
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
      screenId: screens.id,
      screenName: screens.name,
      imageUrl: screens.imageUrl,
      imageWidth: screens.imageWidth,
      imageHeight: screens.imageHeight,
      driftState: screens.driftState,
    })
    .from(flows)
    .innerJoin(screens, and(eq(screens.flowId, flows.id), liveScreen()))
    .where(liveFlow())
    .orderBy(asc(flows.name), asc(screens.position));

  // Insertion order is the `flows.name` ordering above, so the map hands the
  // flows back in the order the query sorted them.
  const byFlow = new Map<string, FlowSummary>();
  for (const row of rows) {
    let flow = byFlow.get(row.id);
    if (!flow) {
      flow = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        lastSyncedAt: row.lastSyncedAt,
        screens: [],
      };
      byFlow.set(row.id, flow);
    }
    flow.screens.push({
      id: row.screenId,
      name: row.screenName,
      imageUrl: row.imageUrl,
      imageWidth: row.imageWidth,
      imageHeight: row.imageHeight,
      driftState: row.driftState as DriftState,
    });
  }

  return [...byFlow.values()];
}

/**
 * A tappable region of a render, normalised 0–1 against it. Shaped for the
 * overlay and nothing else — the node ids behind it stay on the server.
 */
export interface HotspotBox {
  /** The Figma layer's name, for the hover title. Null on older rows. */
  name: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The interaction covers the whole screen — tap anywhere to advance, or a
   * scrim over a sheet. Derived here rather than stored: it is a fact about the
   * geometry in the row, and deciding it once keeps the threshold on the server
   * next to the extraction that chose it.
   */
  wholeScreen: boolean;
}

/**
 * A run of copy on a render, normalised 0–1 against it like `HotspotBox`.
 * Shaped for the highlight overlay: the content is what decides whether a
 * search term is inside it.
 */
export interface TextBox {
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** Empty for a screen with nothing wired, and for one synced before 0006. */
  hotspots: HotspotBox[];
}

/**
 * A playable prototype.
 *
 * Deliberately no URLs. This whole result is cached for days under the
 * `catalog` tag, and a Figma embed URL carries presentation parameters we
 * tune far more often than the catalogue changes — baking them in here would
 * mean a sync just to adjust how the player looks. The player builds them from
 * `fileKey` and `nodeId` at render time.
 */
export interface FlowPrototype {
  nodeId: string;
  name: string;
  section: string | null;
  /** The screen it opens on. Null only if that screen has been unpublished. */
  startsOn: {
    id: string;
    name: string;
    imageUrl: string | null;
    imageWidth: number | null;
    imageHeight: number | null;
  } | null;
}

export interface FlowDetail {
  id: string;
  name: string;
  slug: string;
  /** The Figma file. Needed to address the flow's prototypes. */
  fileKey: string;
  lastSyncedAt: Date | null;
  /** Grouped by Figma page. A single unnamed group means no sub-structure. */
  sections: { name: string | null; screens: ScreenCard[] }[];
  /**
   * Node ids of screens with nothing wired to tap — where a flow ends.
   *
   * Listed rather than flagged per screen because the only consumer is the
   * prototype player, which is handed a node id by Figma and has to decide
   * whether that is an ending, not walk the catalogue.
   */
  flowEndNodeIds: string[];
  /** Empty for the many flows nobody has wired a prototype into. */
  prototypes: FlowPrototype[];
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

  // Left join: a starting point outlives the screen it opens on for exactly
  // one sync, and losing the entry thumbnail is no reason to hide a prototype
  // that still plays perfectly well in Figma.
  const prototypeRows = await db
    .select({
      nodeId: flowPrototypes.nodeId,
      name: flowPrototypes.name,
      section: flowPrototypes.section,
      screenId: screens.id,
      screenName: screens.name,
      imageUrl: screens.imageUrl,
      imageWidth: screens.imageWidth,
      imageHeight: screens.imageHeight,
    })
    .from(flowPrototypes)
    .leftJoin(
      screens,
      and(
        eq(screens.flowId, flowPrototypes.flowId),
        eq(screens.nodeId, flowPrototypes.screenNodeId),
        liveScreen(),
      ),
    )
    .where(eq(flowPrototypes.flowId, flow.id))
    .orderBy(asc(flowPrototypes.position));

  // Its own query rather than two more columns on the cards above: only the
  // player wants this, and node ids on every card would cross to the client
  // on every screen listing for nothing. The whole result is cached for days,
  // so the extra round trip is paid once per sync, not per view.
  const flowEnds = await db
    .select({ nodeId: screens.nodeId })
    .from(screens)
    .where(
      and(
        eq(screens.flowId, flow.id),
        liveScreen(),
        eq(screens.navigates, false),
      ),
    );

  // One query for the whole flow rather than one per card: a flow runs to
  // dozens of screens and each has a handful of hotspots, so this is a single
  // indexed scan paid once per sync — the result is cached with everything else
  // here — instead of N round trips on every view.
  const hotspotRows = await db
    .select({
      screenId: screenHotspots.screenId,
      name: screenHotspots.name,
      x: screenHotspots.x,
      y: screenHotspots.y,
      w: screenHotspots.w,
      h: screenHotspots.h,
    })
    .from(screenHotspots)
    .innerJoin(screens, eq(screens.id, screenHotspots.screenId))
    .where(and(eq(screens.flowId, flow.id), liveScreen()));

  const hotspotsByScreen = new Map<string, HotspotBox[]>();
  for (const { screenId, ...box } of hotspotRows) {
    const list = hotspotsByScreen.get(screenId) ?? [];
    list.push({ ...box, wholeScreen: box.w * box.h >= FULL_BLEED_AREA });
    hotspotsByScreen.set(screenId, list);
  }

  const grouped = new Map<string | null, ScreenCard[]>();
  for (const row of rows) {
    const key = row.section;
    const list = grouped.get(key) ?? [];
    list.push({
      ...row,
      hotspots: hotspotsByScreen.get(row.id) ?? [],
    } as ScreenCard);
    grouped.set(key, list);
  }

  return {
    id: flow.id,
    name: flow.name,
    slug: flow.slug,
    fileKey: flow.fileKey,
    lastSyncedAt: flow.lastSyncedAt,
    sections: [...grouped].map(([name, list]) => ({ name, screens: list })),
    flowEndNodeIds: flowEnds.map((row) => row.nodeId),
    prototypes: prototypeRows.map((row) => ({
      nodeId: row.nodeId,
      name: row.name,
      section: row.section,
      startsOn: row.screenId
        ? {
            id: row.screenId,
            name: row.screenName ?? row.name,
            imageUrl: row.imageUrl,
            imageWidth: row.imageWidth,
            imageHeight: row.imageHeight,
          }
        : null,
    })),
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
  texts: TextBox[];
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
  matchedIn: "text" | "name";
  /**
   * The runs of copy on the render that contain the search term, so a result
   * card can point at where on the screen the match is. Empty when the screen
   * matched on its name, or on words that no single run holds together.
   */
  matchedTexts: TextBox[];
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
    return withMatchedTexts(
      (ranked as unknown as SearchHit[]).map((hit) => ({
        ...hit,
        matchedIn: "text" as const,
      })),
      trimmed,
    );
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
  return withMatchedTexts([...merged.values()], trimmed);
}

/**
 * Fill in the copy each hit matched on, in one query for the whole page of
 * results rather than one per card.
 *
 * The rule is `ScreenImage`'s, moved into SQL: a run of copy matches when the
 * term appears inside it, case-insensitively — which is what ILIKE does. Same
 * rule on both sides means a result card and the detail view it opens can never
 * outline different parts of the same render.
 */
async function withMatchedTexts(
  hits: Omit<SearchHit, "matchedTexts">[],
  term: string,
): Promise<SearchHit[]> {
  if (hits.length === 0) return [];

  // Someone typing `50%` into a search box means the character, not a LIKE
  // wildcard, so the pattern metacharacters are escaped before wrapping.
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      screenId: screenTexts.screenId,
      content: screenTexts.content,
      x: screenTexts.x,
      y: screenTexts.y,
      w: screenTexts.w,
      h: screenTexts.h,
    })
    .from(screenTexts)
    .where(
      and(
        inArray(
          screenTexts.screenId,
          hits.map((hit) => hit.id),
        ),
        ilike(screenTexts.content, pattern),
      ),
    );

  const byScreen = new Map<string, TextBox[]>();
  for (const { screenId, ...box } of rows) {
    const list = byScreen.get(screenId) ?? [];
    list.push(box);
    byScreen.set(screenId, list);
  }

  return hits.map((hit) => ({
    ...hit,
    matchedTexts: byScreen.get(hit.id) ?? [],
  }));
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
