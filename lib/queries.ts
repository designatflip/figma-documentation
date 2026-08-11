import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db";
import {
  flowPrototypes,
  flows,
  screenHotspots,
  screens,
  screenTexts,
  streams,
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
const liveStream = () => isNull(streams.archivedAt);

/**
 * Where a flow's rail sits on the home page.
 *
 * Flow slugs are only unique within their stream — two products can both have
 * an "Onboarding" — so the anchor has to name both. Built here rather than in
 * the components, so the link and the target cannot be spelled differently.
 */
export function flowAnchor(streamSlug: string, flowSlug: string): string {
  return `${streamSlug}--${flowSlug}`;
}

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
  /** `flowAnchor` of this flow, ready to link to and to render as an id. */
  anchor: string;
  lastSyncedAt: Date | null;
  /** The whole flow, in the order the frames sit on its Figma page. */
  screens: FlowRailScreen[];
}

/** A Figma file: the product stream its flows belong to. */
export interface StreamSummary {
  id: string;
  name: string;
  slug: string;
  flows: FlowSummary[];
}

/**
 * Every documented stream, its flows, and their screens — the whole home page.
 *
 * One join rather than a query per level: the catalogue is small, the whole
 * result is cached for days under the `catalog` tag, and the screens *are* the
 * home page now rather than something it links to.
 *
 * `innerJoin` does the work `having count(*) > 0` used to: a flow with nothing
 * live under it has nothing to draw, and a stream with no such flow drops out
 * behind it, both on their own.
 */
export async function getStreams(): Promise<StreamSummary[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("days");

  const rows = await db
    .select({
      streamId: streams.id,
      streamName: streams.name,
      streamSlug: streams.slug,
      flowId: flows.id,
      flowName: flows.name,
      flowSlug: flows.slug,
      lastSyncedAt: flows.lastSyncedAt,
      screenId: screens.id,
      screenName: screens.name,
      imageUrl: screens.imageUrl,
      imageWidth: screens.imageWidth,
      imageHeight: screens.imageHeight,
      driftState: screens.driftState,
    })
    .from(streams)
    .innerJoin(flows, and(eq(flows.streamId, streams.id), liveFlow()))
    .innerJoin(screens, and(eq(screens.flowId, flows.id), liveScreen()))
    .where(liveStream())
    // Streams alphabetically, but flows in Figma's own page order: the order
    // the pages sit in the file is a decision the designers made, and reading
    // it back to them is more use than an alphabet.
    .orderBy(asc(streams.name), asc(flows.position), asc(screens.position));

  // Insertion order is the ordering above, so both maps hand their rows back
  // in the order the query sorted them.
  const byStream = new Map<string, StreamSummary>();
  const byFlow = new Map<string, FlowSummary>();

  for (const row of rows) {
    let stream = byStream.get(row.streamId);
    if (!stream) {
      stream = {
        id: row.streamId,
        name: row.streamName,
        slug: row.streamSlug,
        flows: [],
      };
      byStream.set(row.streamId, stream);
    }

    let flow = byFlow.get(row.flowId);
    if (!flow) {
      flow = {
        id: row.flowId,
        name: row.flowName,
        slug: row.flowSlug,
        anchor: flowAnchor(row.streamSlug, row.flowSlug),
        lastSyncedAt: row.lastSyncedAt,
        screens: [],
      };
      byFlow.set(row.flowId, flow);
      stream.flows.push(flow);
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

  return [...byStream.values()];
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
  /** Where this flow's rail sits on the home page. */
  anchor: string;
  /** The stream it belongs to, for the line that says where you are. */
  streamName: string;
  streamSlug: string;
  /** The Figma file. Needed to address the flow's prototypes. */
  fileKey: string;
  lastSyncedAt: Date | null;
  /** The flow end to end, in the order the frames sit on its Figma page. */
  screens: ScreenCard[];
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

/**
 * By id rather than by slug: the screen view already holds the flow id of the
 * screen it is showing, and a slug would have to be qualified by its stream to
 * mean anything. Nothing links to a flow on its own — a flow is a rail on the
 * home page and a run of frames in the lightbox — so there is no URL here to
 * keep readable.
 */
export async function getFlowById(id: string): Promise<FlowDetail | null> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("days");

  const [flow] = await db
    .select({
      id: flows.id,
      name: flows.name,
      slug: flows.slug,
      lastSyncedAt: flows.lastSyncedAt,
      streamName: streams.name,
      streamSlug: streams.slug,
      fileKey: streams.fileKey,
    })
    .from(flows)
    .innerJoin(streams, eq(streams.id, flows.streamId))
    .where(and(eq(flows.id, id), liveFlow(), liveStream()))
    .limit(1);

  if (!flow) return null;

  const rows = await db
    .select({
      id: screens.id,
      name: screens.name,
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

  return {
    id: flow.id,
    name: flow.name,
    slug: flow.slug,
    anchor: flowAnchor(flow.streamSlug, flow.slug),
    streamName: flow.streamName,
    streamSlug: flow.streamSlug,
    fileKey: flow.fileKey,
    lastSyncedAt: flow.lastSyncedAt,
    screens: rows.map((row) => ({
      ...row,
      driftState: row.driftState as DriftState,
      hotspots: hotspotsByScreen.get(row.id) ?? [],
    })),
    flowEndNodeIds: flowEnds.map((row) => row.nodeId),
    prototypes: prototypeRows.map((row) => ({
      nodeId: row.nodeId,
      name: row.name,
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
  /** The flow this screen belongs to — a page of its stream's Figma file. */
  flowId: string;
  flowName: string;
  /** Where that flow's rail sits on the home page. */
  flowAnchor: string;
  streamName: string;
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
      flowId: flows.id,
      flowName: flows.name,
      flowSlug: flows.slug,
      streamName: streams.name,
      streamSlug: streams.slug,
    })
    .from(screens)
    .innerJoin(flows, eq(flows.id, screens.flowId))
    .innerJoin(streams, eq(streams.id, flows.streamId))
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

  return {
    ...row,
    driftState: row.driftState as DriftState,
    flowAnchor: flowAnchor(row.streamSlug, row.flowSlug),
    texts,
  };
}

export interface SearchHit {
  id: string;
  name: string;
  /** The page it is documented on, and the file that page belongs to. */
  flowName: string;
  streamName: string;
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
      s.image_url        AS "imageUrl",
      s.image_width      AS "imageWidth",
      s.image_height     AS "imageHeight",
      f.name             AS "flowName",
      st.name            AS "streamName",
      ts_rank(s.search_vector, q) AS rank
    FROM screens s
    JOIN flows f ON f.id = s.flow_id
    JOIN streams st ON st.id = f.stream_id,
         websearch_to_tsquery('simple', ${trimmed}) q
    WHERE s.archived_at IS NULL
      AND f.archived_at IS NULL
      AND st.archived_at IS NULL
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
      s.image_url    AS "imageUrl",
      s.image_width  AS "imageWidth",
      s.image_height AS "imageHeight",
      f.name         AS "flowName",
      st.name        AS "streamName",
      GREATEST(
        similarity(s.name, ${trimmed}),
        similarity(coalesce(s.text_content, ''), ${trimmed})
      ) AS rank
    FROM screens s
    JOIN flows f ON f.id = s.flow_id
    JOIN streams st ON st.id = f.stream_id
    WHERE s.archived_at IS NULL
      AND f.archived_at IS NULL
      AND st.archived_at IS NULL
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

/** One page of one file, as the admin table lists it. */
export interface AdminFlowStatus {
  id: string;
  name: string;
  lastSyncedAt: Date | null;
  screenCount: number;
  driftCount: number;
  archivedAt: Date | null;
}

export interface AdminStreamStatus {
  id: string;
  name: string;
  slug: string;
  syncStatus: string;
  syncError: string | null;
  lastSyncedAt: Date | null;
  lastModified: Date | null;
  archivedAt: Date | null;
  flows: AdminFlowStatus[];
}

/**
 * Not cached — the admin page exists to show current state.
 *
 * Two queries and a join in memory rather than one grouped query: the counts
 * are per flow now, and rolling them up per stream in SQL as well would mean
 * either a second pass or double-counting screens across the join.
 */
export async function getAdminStatus(): Promise<AdminStreamStatus[]> {
  const streamRows = await db
    .select({
      id: streams.id,
      name: streams.name,
      slug: streams.slug,
      syncStatus: streams.syncStatus,
      syncError: streams.syncError,
      lastSyncedAt: streams.lastSyncedAt,
      lastModified: streams.lastModified,
      archivedAt: streams.archivedAt,
    })
    .from(streams)
    .orderBy(asc(streams.name));

  const flowRows = await db
    .select({
      id: flows.id,
      streamId: flows.streamId,
      name: flows.name,
      lastSyncedAt: flows.lastSyncedAt,
      archivedAt: flows.archivedAt,
      screenCount: sql<number>`count(${screens.id}) FILTER (WHERE ${screens.archivedAt} IS NULL)::int`,
      driftCount: sql<number>`count(${screens.id}) FILTER (WHERE ${screens.archivedAt} IS NULL AND ${screens.driftState} IN ('content_changed','source_changed'))::int`,
    })
    .from(flows)
    .leftJoin(screens, eq(screens.flowId, flows.id))
    .groupBy(flows.id)
    .orderBy(asc(flows.position));

  const byStream = new Map<string, AdminFlowStatus[]>();
  for (const { streamId, ...flow } of flowRows) {
    const list = byStream.get(streamId) ?? [];
    list.push(flow);
    byStream.set(streamId, list);
  }

  return streamRows.map((stream) => ({
    ...stream,
    flows: byStream.get(stream.id) ?? [],
  }));
}
