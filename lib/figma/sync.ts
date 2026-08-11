import { del, put } from "@vercel/blob";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  flowPrototypes,
  flows,
  screenHotspots,
  screens,
  screenTexts,
  streams,
} from "@/db/schema";
import { blobToken, figmaEnv } from "@/lib/env";
import { FigmaClient } from "./client";
import { checkDrift } from "./drift";
import {
  type ExtractedFrame,
  type ExtractedPage,
  type ExtractedPrototype,
  extractFrame,
  figmaUrl,
  findPageFrames,
  findPagePrototypes,
  findPages,
  isHidden,
  parseFigmaUrl,
  sha256,
  slugify,
} from "./extract";
import type { FigmaNode, ProjectFile } from "./types";

/** Node ids per images request. Keeps URLs well under any length limit. */
const IMAGE_CHUNK_SIZE = 50;

/** Figma refuses to render above 32 megapixels. */
const MAX_MEGAPIXELS = 32_000_000;

/**
 * A single sync run would have to archive more than this share of a flow's
 * live screens for us to suspect a moved file or a partial API response
 * rather than a real bulk unpublish.
 */
const MASS_ARCHIVE_RATIO = 0.5;

/**
 * …and the flow has to have been big enough for the ratio to mean anything.
 *
 * A page is a much smaller unit than the file this guard was written for.
 * Deleting two frames from a four-frame page is an ordinary morning's work, and
 * a refusal there would be one a designer cannot clear: the override is a CLI
 * flag, and the plugin has no way to pass it.
 */
const MASS_ARCHIVE_MIN = 5;

export interface SyncOptions {
  /** Re-sync files whose `last_modified` is unchanged. */
  force?: boolean;
  /** Resolve and report everything, write nothing. */
  dryRun?: boolean;
  allowMassArchive?: boolean;
  /** Limit the run to one stream's file. */
  onlyFileKey?: string;
  /** Skip the drift pass (it is the slowest stage). */
  skipDrift?: boolean;
  onLog?: (message: string) => void;
}

export interface SyncSummary {
  streamsChecked: number;
  streamsSkipped: number;
  streamsSynced: number;
  /** Pages written. The unit a designer publishes, so the unit reported. */
  flowsPublished: number;
  flowsArchived: number;
  screensRendered: number;
  blobWrites: number;
  prototypesPublished: number;
  screensArchived: number;
  driftFlagged: number;
  requestCount: number;
  errors: string[];
  /** Populated on dry runs for the CLI to print. */
  preview: StreamPreview[];
}

function emptySummary(): SyncSummary {
  return {
    streamsChecked: 0,
    streamsSkipped: 0,
    streamsSynced: 0,
    flowsPublished: 0,
    flowsArchived: 0,
    screensRendered: 0,
    blobWrites: 0,
    prototypesPublished: 0,
    screensArchived: 0,
    driftFlagged: 0,
    requestCount: 0,
    errors: [],
    preview: [],
  };
}

/**
 * The result every trigger surface shows — the admin button, the plugin, and
 * the API response. Shared so the wording cannot drift between them.
 *
 * Written for the designer who just pressed Publish rather than for whoever
 * wrote the sync: each sentence says what is true of the site now, in the order
 * someone actually cares about it — what got published, what changed, what
 * disappeared, what needs review — with the request count last because it only
 * matters when debugging the rate limit. It renders into a plain `<p>` on the
 * admin page, so it has to read as prose; no counters-and-dots table.
 */
export function formatSyncSummary(summary: SyncSummary): string {
  const parts: string[] = [];

  if (summary.streamsSynced === 0) {
    parts.push(nothingPublished(summary));
  } else {
    parts.push(published(summary));
    // Nothing was rendered, so there is no image story to tell — `published`
    // has already explained why.
    if (summary.screensRendered > 0) parts.push(images(summary));
    // Only worth a sentence when there is one. Most pages are never
    // prototyped, and "0 prototypes" would read as something having failed.
    if (summary.prototypesPublished > 0) parts.push(prototypes(summary));
  }

  if (summary.screensArchived > 0) {
    parts.push(
      `${plural(summary.screensArchived, "screen")} no longer in Figma, ` +
        `now hidden from the site.`,
    );
  }

  if (summary.flowsArchived > 0) {
    parts.push(
      `${plural(summary.flowsArchived, "page")} no longer in Figma, ` +
        `so ${summary.flowsArchived === 1 ? "that flow is" : "those flows are"} ` +
        `off the site too.`,
    );
  }

  parts.push(
    summary.driftFlagged === 0
      ? "Nothing has drifted from its source design."
      : `${plural(summary.driftFlagged, "screen")} no longer match the source ` +
        `design they were copied from — flagged for review.`,
  );

  if (summary.errors.length > 0) {
    parts.push(
      `${plural(summary.errors.length, "problem")} along the way: ${summary.errors.join("; ")}.`,
    );
  }

  parts.push(`${plural(summary.requestCount, "Figma API request")} used.`);

  return parts.filter(Boolean).join(" ");
}

function nothingPublished(summary: SyncSummary): string {
  if (summary.streamsChecked === 0) {
    return "Nothing to publish — no Figma files matched.";
  }
  return summary.streamsChecked === 1
    ? "Nothing to publish — this file has not changed in Figma since it was last published."
    : `Nothing to publish — none of the ${summary.streamsChecked} files have changed in Figma since they were last published.`;
}

function published(summary: SyncSummary): string {
  const scope =
    summary.flowsPublished === 1 ? "" : ` across ${summary.flowsPublished} pages`;

  if (summary.screensRendered === 0) {
    return (
      `Published${scope}, but found no frames to document. ` +
      `Frames are skipped when their name matches the ignore prefix.`
    );
  }

  const also =
    summary.streamsSkipped > 0
      ? ` ${plural(summary.streamsSkipped, "other file")} had not changed and ` +
        `${summary.streamsSkipped === 1 ? "was" : "were"} left alone.`
      : "";

  return `${plural(summary.screensRendered, "screen")} published${scope}.${also}`;
}

/**
 * Renders are compared by hash before upload, so most screens in a re-publish
 * cost nothing. Saying so is what stops "0 image writes" reading like a failure.
 */
function images(summary: SyncSummary): string {
  const identical = Math.max(0, summary.screensRendered - summary.blobWrites);

  if (summary.blobWrites === 0) {
    return "Every image was already identical, so none were re-uploaded.";
  }
  if (identical === 0) {
    return `${plural(summary.blobWrites, "image")} uploaded.`;
  }
  return (
    `${plural(summary.blobWrites, "image")} changed and ${summary.blobWrites === 1 ? "was" : "were"} ` +
    `re-uploaded; the other ${identical} were identical.`
  );
}

function prototypes(summary: SyncSummary): string {
  return summary.prototypesPublished === 1
    ? "One prototype is playable on the site."
    : `${summary.prototypesPublished} prototypes are playable on the site.`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export interface FlowPreview {
  pageId: string;
  name: string;
  /** Prototype starting points, by the screen each one opens on. */
  prototypes: { name: string; startsOn: string }[];
  frames: {
    nodeId: string;
    name: string;
    description: string | null;
    textSample: string[];
    /** Names of the layers found wired up, so the overlay is checkable dry. */
    hotspots: string[];
    sourceUrl: string | null;
  }[];
}

export interface StreamPreview {
  fileKey: string;
  name: string;
  changed: boolean;
  flows: FlowPreview[];
}

export async function syncProject(
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const log = options.onLog ?? (() => {});
  const env = figmaEnv();
  const client = new FigmaClient({ onLog: log });

  const summary = emptySummary();

  // 1. Discover + change gate. One request returns every file in the project
  //    along with its last_modified, so unchanged streams cost nothing further.
  const project = await client.getProjectFiles(env.projectId);
  log(`Project "${project.name}": ${project.files.length} file(s)`);

  let candidates = project.files.filter(
    (f) => !env.ignorePattern.test(f.name.trim()),
  );
  if (options.onlyFileKey) {
    candidates = candidates.filter((f) => f.key === options.onlyFileKey);
  }

  const existingStreams = await db.select().from(streams);
  const streamByKey = new Map(existingStreams.map((s) => [s.fileKey, s]));

  for (const file of candidates) {
    summary.streamsChecked++;
    const existing = streamByKey.get(file.key);
    const remoteModified = new Date(file.last_modified);
    const unchanged =
      existing?.lastModified != null &&
      existing.lastModified.getTime() === remoteModified.getTime() &&
      existing.archivedAt == null;

    if (unchanged && !options.force) {
      summary.streamsSkipped++;
      log(`  skip  ${file.name} (unchanged)`);
      continue;
    }

    try {
      await syncStreamFile(client, file, remoteModified, options, summary, log);
      summary.streamsSynced++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${file.name}: ${message}`);
      log(`  ERROR ${file.name}: ${message}`);
      if (!options.dryRun) {
        await db
          .update(streams)
          .set({
            syncStatus: "error",
            syncError: message,
            // The stream row is upserted with the new `last_modified` *before*
            // rendering, so a failure after that point would leave the change
            // gate believing this file is done — and the retry would skip it
            // until Figma next touched the file. Clearing the gate makes a
            // failed sync retry, which is what anyone pressing Publish again
            // in the plugin already assumes happens.
            lastModified: null,
          })
          .where(eq(streams.fileKey, file.key));
      }
    }
  }

  // Files that left the project entirely.
  if (!options.dryRun) {
    const liveKeys = candidates.map((f) => f.key);
    const archivedStreams = await db
      .update(streams)
      .set({ archivedAt: new Date() })
      .where(
        and(
          isNull(streams.archivedAt),
          liveKeys.length > 0
            ? notInArray(streams.fileKey, liveKeys)
            : sql`true`,
        ),
      )
      .returning({ id: streams.id, name: streams.name });

    for (const stream of archivedStreams) {
      log(`  archived stream "${stream.name}" (no longer in project)`);
      summary.screensArchived += await archiveStreamContents(stream.id, summary);
    }
  }

  if (!options.skipDrift && !options.dryRun) {
    summary.driftFlagged = await checkDrift(client, log);
  }

  summary.requestCount = client.requestCount;
  return summary;
}

/** Every flow and screen under a stream that has left the project. */
async function archiveStreamContents(
  streamId: string,
  summary: SyncSummary,
): Promise<number> {
  const archivedFlows = await db
    .update(flows)
    .set({ archivedAt: new Date() })
    .where(and(eq(flows.streamId, streamId), isNull(flows.archivedAt)))
    .returning({ id: flows.id });

  summary.flowsArchived += archivedFlows.length;
  if (archivedFlows.length === 0) return 0;

  const archivedScreens = await db
    .update(screens)
    .set({ archivedAt: new Date() })
    .where(
      and(
        inArray(
          screens.flowId,
          archivedFlows.map((f) => f.id),
        ),
        isNull(screens.archivedAt),
      ),
    )
    .returning({ id: screens.id });

  return archivedScreens.length;
}

async function syncStreamFile(
  client: FigmaClient,
  file: ProjectFile,
  remoteModified: Date,
  options: SyncOptions,
  summary: SyncSummary,
  log: (message: string) => void,
) {
  const env = figmaEnv();
  log(`  sync  ${file.name}`);

  // 2. Full nested tree — one request, includes the TEXT nodes.
  const fileData = await client.getFile(file.key);
  const pages = findPages(fileData.document, env.ignorePattern);

  if (pages.length === 0) {
    log(`        no pages found — check DOCS_IGNORE_PATTERN`);
  }

  // 3. Source links, read once for the whole file. Absent scope or absent
  //    links must not fail it.
  const sourceByNodeId = await readSourceLinks(client, file.key, summary, log);

  if (options.dryRun) {
    summary.preview.push({
      fileKey: file.key,
      name: file.name,
      changed: true,
      flows: pages.map((page) => {
        const frames = findPageFrames(page.node, env.ignorePattern);
        const extracted = frames.map(({ frame, position }) =>
          extractFrame(frame, position),
        );
        const nameByNodeId = new Map(
          frames.map(({ frame }) => [frame.id, frame.name.trim()]),
        );
        summary.screensRendered += extracted.length;

        return {
          pageId: page.pageId,
          name: page.name,
          prototypes: findPagePrototypes(page.node, env.ignorePattern).map(
            (p) => ({
              name: p.name,
              startsOn: nameByNodeId.get(p.screenNodeId) ?? p.screenNodeId,
            }),
          ),
          frames: extracted.map((f) => ({
            nodeId: f.nodeId,
            name: f.name,
            description: f.description,
            textSample: f.texts.slice(0, 8).map((t) => t.content),
            hotspots: f.hotspots.map((h) => h.name),
            sourceUrl: sourceByNodeId.get(f.nodeId)?.url ?? null,
          })),
        };
      }),
    });
    return;
  }

  const stream = await upsertStream(file, remoteModified);

  for (const page of pages) {
    await publishPage({
      client,
      stream,
      page,
      sourceByNodeId,
      // The walk that produced these pages is the file's own page order.
      reposition: true,
      allowMassArchive: options.allowMassArchive,
      summary,
      log,
    });
  }

  // Pages that left the file. Their screens go with them — a screen whose page
  // is gone is as unpublished as one whose frame was deleted, and leaving it
  // live would strand it in a flow nothing links to.
  const livePageIds = pages.map((p) => p.pageId);
  const archivedFlows = await db
    .update(flows)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(flows.streamId, stream.id),
        isNull(flows.archivedAt),
        livePageIds.length > 0
          ? notInArray(flows.pageId, livePageIds)
          : sql`true`,
      ),
    )
    .returning({ id: flows.id, name: flows.name });

  for (const flow of archivedFlows) {
    log(`        archived flow "${flow.name}" (page no longer in file)`);
    summary.flowsArchived++;
    const result = await db
      .update(screens)
      .set({ archivedAt: new Date() })
      .where(and(eq(screens.flowId, flow.id), isNull(screens.archivedAt)))
      .returning({ id: screens.id });
    summary.screensArchived += result.length;
  }
}

/**
 * The stream row for a file, with the change gate stamped.
 *
 * Only a whole-file sync calls this. A page publish uses `adoptStream`, which
 * is the same upsert minus `lastModified` — see there for why.
 */
async function upsertStream(file: ProjectFile, remoteModified: Date) {
  const values = {
    fileKey: file.key,
    name: file.name,
    slug: await uniqueStreamSlug(slugify(file.name), file.key),
    thumbnailUrl: file.thumbnail_url ?? null,
    lastModified: remoteModified,
    lastSyncedAt: new Date(),
    syncStatus: "ok",
    syncError: null,
    // Republishing must be as cheap as publishing.
    archivedAt: null,
  };

  const [stream] = await db
    .insert(streams)
    .values(values)
    .onConflictDoUpdate({ target: streams.fileKey, set: values })
    .returning();

  return stream;
}

// --- Publishing one page ----------------------------------------------------

export interface PageSyncOptions {
  fileKey: string;
  /** Figma node id of the CANVAS, which the plugin reads off `currentPage`. */
  pageId: string;
  allowMassArchive?: boolean;
  onLog?: (message: string) => void;
}

export interface PageSyncSummary {
  streamName: string;
  flowName: string;
  /** The page was not documented before this run. */
  created: boolean;
  screensPublished: number;
  blobWrites: number;
  prototypes: number;
  screensArchived: number;
  driftFlagged: number;
  requestCount: number;
}

/**
 * A refusal the designer can act on, as opposed to a sync that broke.
 *
 * Carries the status the route should answer with, so the wording lives next to
 * the check that produced it rather than being re-derived from a string.
 */
export class PublishError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

/**
 * Publish one page, leaving the rest of its file untouched.
 *
 * This is the button in the plugin, and the reason the catalogue has a page
 * level at all: a documentation file is a product stream that runs to hundreds
 * of frames across a dozen pages, and a designer who has just finished one flow
 * should not have to re-render the other eleven — nor wait out the rate limit
 * while it happens.
 *
 * Unlike a single screen, a page is a *complete* unit. Everything the catalogue
 * knows about a flow is answerable from one `/nodes` request on the CANVAS:
 * its frames and their order, its text and wiring, and its prototype starting
 * points, which Figma reports per page. So this path archives, reorders and
 * republishes prototypes exactly as a full sync does, within its own page.
 *
 * What it deliberately does not do:
 *
 * - **Touch `streams.lastModified`.** That column is the change gate in
 *   `syncProject`. Stamping it would make the next full sync skip the file and
 *   silently strand every other page edited in the same session.
 * - **Reconcile pages.** A page that was deleted from the file is invisible
 *   from here; the nightly run is what notices.
 */
export async function syncPage(
  options: PageSyncOptions,
): Promise<PageSyncSummary> {
  const log = options.onLog ?? (() => {});
  const env = figmaEnv();
  const client = new FigmaClient({ onLog: log });
  const summary = emptySummary();

  // One request buys the whole page: the frames, every TEXT node under them,
  // the prototype wiring, and the starting points on the CANVAS itself.
  const { name: fileName, nodes } = await client.getFileNodes(
    options.fileKey,
    [options.pageId],
  );
  const node = nodes[options.pageId]?.document;

  if (!node) {
    throw new PublishError("That page is no longer in this file.", 404);
  }
  if (node.type !== "CANVAS") {
    throw new PublishError(
      `“${node.name}” is a ${node.type}, not a page.`,
      400,
    );
  }

  const pageName = node.name.trim();
  if (env.ignorePattern.test(pageName)) {
    throw new PublishError(
      `“${pageName}” matches the ignore prefix, so it stays unpublished.`,
      400,
    );
  }
  if (env.ignorePattern.test(fileName.trim())) {
    throw new PublishError(
      `“${fileName}” matches the ignore prefix, so nothing in it is published.`,
      400,
    );
  }

  const stream = await adoptStream(client, options.fileKey, fileName);
  log(`  page  "${pageName}" in "${stream.name}"`);

  const sourceByNodeId = await readSourceLinks(
    client,
    options.fileKey,
    summary,
    log,
  );

  const page: ExtractedPage = {
    node,
    pageId: options.pageId,
    name: pageName,
    // Only read when this page has never been documented. Where it sits among
    // its siblings is a whole-file fact — see `reposition` below.
    position: await nextFlowPosition(stream.id),
  };

  const { flow, created } = await publishPage({
    client,
    stream,
    page,
    sourceByNodeId,
    // A canvas fetched on its own cannot know which page number it is, so an
    // existing flow keeps the position a full sync gave it and a new one goes
    // last until the next one files it properly.
    reposition: false,
    allowMassArchive: options.allowMassArchive,
    summary,
    log,
  });

  // Republishing is exactly when the drift badges on this page stop being
  // trustworthy, and the pass costs one request per distinct source file —
  // usually one for a whole flow, since a flow is normally copied out of one
  // feature file.
  const pageScreens = await db
    .select({ id: screens.id })
    .from(screens)
    .where(and(eq(screens.flowId, flow.id), isNull(screens.archivedAt)));

  summary.driftFlagged = await checkDrift(client, log, {
    screenIds: pageScreens.map((s) => s.id),
  });

  return {
    streamName: stream.name,
    flowName: flow.name,
    created,
    screensPublished: summary.screensRendered,
    blobWrites: summary.blobWrites,
    prototypes: summary.prototypesPublished,
    screensArchived: summary.screensArchived,
    driftFlagged: summary.driftFlagged,
    requestCount: client.requestCount,
  };
}

/**
 * The stream row for a file being published one page at a time.
 *
 * Creates it when nobody has published this file before, which is the ordinary
 * first run now that the plugin's only whole-file button is gone. What it will
 * not do is stamp `lastModified`: that is the nightly run's change gate, and a
 * page publish has looked at exactly one page of the file.
 *
 * Leaving the gate open means the next full sync still visits this file and
 * picks up every page nobody pressed the button on.
 *
 * Membership of the documentation project is what makes something publishable
 * at all, and a page id proves nothing about it — the plugin runs in whatever
 * file the designer has open, including their team's working files. So a file
 * with no live stream row is checked against the project listing before it is
 * allowed to create one. A file that already has one has been checked; if it
 * has since left the project, the nightly run archives it.
 */
async function adoptStream(
  client: FigmaClient,
  fileKey: string,
  fileName: string,
) {
  const [existing] = await db
    .select()
    .from(streams)
    .where(eq(streams.fileKey, fileKey));

  if (!existing || existing.archivedAt != null) {
    const env = figmaEnv();
    const project = await client.getProjectFiles(env.projectId);
    if (!project.files.some((f) => f.key === fileKey)) {
      throw new PublishError(
        `“${fileName}” isn't in the documentation project, so there is nothing ` +
          `to publish. Move the file into it first.`,
        404,
      );
    }
  }

  if (existing) {
    const [updated] = await db
      .update(streams)
      .set({
        name: fileName,
        lastSyncedAt: new Date(),
        syncStatus: "ok",
        syncError: null,
        archivedAt: null,
      })
      .where(eq(streams.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(streams)
    .values({
      fileKey,
      name: fileName,
      slug: await uniqueStreamSlug(slugify(fileName), fileKey),
      lastModified: null,
      lastSyncedAt: new Date(),
      syncStatus: "ok",
    })
    .returning();

  return created;
}

interface PublishPageInput {
  client: FigmaClient;
  stream: typeof streams.$inferSelect;
  page: ExtractedPage;
  sourceByNodeId: Map<string, SourceLink>;
  /**
   * Whether `page.position` is authoritative. Only a walk of the whole file
   * knows what number a page is; a single-page publish does not.
   */
  reposition: boolean;
  allowMassArchive?: boolean;
  summary: SyncSummary;
  log: (message: string) => void;
}

/**
 * Write one page: its flow row, its prototypes, its screens, and whatever it
 * has stopped containing.
 *
 * Shared by the two publish paths — a whole file, and one page — so a flow
 * published on its own lands as exactly the rows a full sync would have given
 * it. Everything that differs between the two is decided by the caller and
 * arrives here already resolved.
 */
async function publishPage(input: PublishPageInput): Promise<{
  flow: typeof flows.$inferSelect;
  created: boolean;
}> {
  const { client, stream, page, sourceByNodeId, summary, log } = input;
  const env = figmaEnv();

  const found = findPageFrames(page.node, env.ignorePattern);
  if (found.length === 0) {
    log(`        "${page.name}": no frames found — check DOCS_IGNORE_PATTERN`);
  }

  const extracted = found.map(({ frame, position }) =>
    extractFrame(frame, position),
  );
  const frameByNodeId = new Map(found.map(({ frame }) => [frame.id, frame]));

  // Free — the starting points ride along on the CANVAS already fetched.
  const pagePrototypes = findPagePrototypes(page.node, env.ignorePattern);

  const { flow, created } = await resolveFlow(
    stream.id,
    page,
    input.reposition,
  );
  summary.flowsPublished++;
  log(
    `        flow "${flow.name}": ${extracted.length} frame(s), ` +
      `${pagePrototypes.length} prototype(s)`,
  );

  await replacePrototypes(flow.id, pagePrototypes);
  summary.prototypesPublished += pagePrototypes.length;

  const renderedUrls = await renderFrames(
    client,
    stream.fileKey,
    extracted,
    frameByNodeId,
    log,
  );

  const existingScreens = await db
    .select()
    .from(screens)
    .where(eq(screens.flowId, flow.id));
  const screenByNodeId = new Map(existingScreens.map((s) => [s.nodeId, s]));

  for (const frame of extracted) {
    const { blobWritten } = await publishFrame({
      flowId: flow.id,
      fileKey: stream.fileKey,
      streamSlug: stream.slug,
      frame,
      node: frameByNodeId.get(frame.nodeId),
      prior: screenByNodeId.get(frame.nodeId),
      renderUrl: renderedUrls.get(frame.nodeId),
      source: sourceByNodeId.get(frame.nodeId),
      log,
    });

    if (blobWritten) summary.blobWrites++;
    summary.screensRendered++;
  }

  // Reconcile within this flow. The page is a complete unit, so anything not
  // on it any more has genuinely gone.
  const liveNodeIds = extracted.map((f) => f.nodeId);
  const toArchive = existingScreens.filter(
    (s) => s.archivedAt == null && !liveNodeIds.includes(s.nodeId),
  );
  const liveBefore = existingScreens.filter((s) => s.archivedAt == null).length;

  if (
    toArchive.length > 0 &&
    liveBefore >= MASS_ARCHIVE_MIN &&
    toArchive.length / liveBefore > MASS_ARCHIVE_RATIO &&
    !input.allowMassArchive
  ) {
    throw new PublishError(
      `Refusing to archive ${toArchive.length} of ${liveBefore} live screens in ` +
        `“${flow.name}”. That usually means a moved page or a partial API ` +
        `response, not a bulk unpublish. Re-run the sync with ` +
        `--allow-mass-archive if this is intended.`,
      409,
    );
  }

  if (toArchive.length > 0) {
    await db
      .update(screens)
      .set({ archivedAt: new Date() })
      .where(
        inArray(
          screens.id,
          toArchive.map((s) => s.id),
        ),
      );
    summary.screensArchived += toArchive.length;
    log(`        archived ${toArchive.length} screen(s)`);
  }

  return { flow, created };
}

/**
 * The flow row for a page, matched on the page's node id.
 *
 * The name is not the identity: renaming "Domestic Transfer" to "Transfer
 * (domestic)" must move the flow, not replace it and orphan every screen id
 * under it.
 *
 * Rows migration 0007 rebuilt from the old `section` strings have no page id to
 * match on, so they are adopted by name once and stamped. After that first
 * sync, the name-matching branch never fires again.
 */
async function resolveFlow(
  streamId: string,
  page: ExtractedPage,
  reposition: boolean,
): Promise<{ flow: typeof flows.$inferSelect; created: boolean }> {
  const [byPageId] = await db
    .select()
    .from(flows)
    .where(and(eq(flows.streamId, streamId), eq(flows.pageId, page.pageId)));

  const [legacy] = byPageId
    ? []
    : await db
        .select()
        .from(flows)
        .where(
          and(
            eq(flows.streamId, streamId),
            isNull(flows.pageId),
            eq(flows.name, page.name),
          ),
        );

  const existing = byPageId ?? legacy;

  if (existing) {
    const [updated] = await db
      .update(flows)
      .set({
        pageId: page.pageId,
        name: page.name,
        slug: await uniqueFlowSlug(streamId, slugify(page.name), {
          pageId: page.pageId,
          flowId: existing.id,
        }),
        position: reposition ? page.position : existing.position,
        lastSyncedAt: new Date(),
        archivedAt: null,
      })
      .where(eq(flows.id, existing.id))
      .returning();

    return { flow: updated, created: false };
  }

  const [flow] = await db
    .insert(flows)
    .values({
      streamId,
      pageId: page.pageId,
      name: page.name,
      slug: await uniqueFlowSlug(streamId, slugify(page.name), {
        pageId: page.pageId,
        flowId: null,
      }),
      position: page.position,
      lastSyncedAt: new Date(),
    })
    .returning();

  return { flow, created: true };
}

/**
 * Replaced wholesale rather than upserted: a starting point that was moved or
 * unpinned in Figma has to disappear here, and there are only ever a handful of
 * rows per page.
 */
async function replacePrototypes(
  flowId: string,
  found: ExtractedPrototype[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(flowPrototypes).where(eq(flowPrototypes.flowId, flowId));
    if (found.length > 0) {
      await tx.insert(flowPrototypes).values(
        found.map((p) => ({
          flowId,
          nodeId: p.nodeId,
          screenNodeId: p.screenNodeId,
          name: p.name,
          position: p.position,
        })),
      );
    }
  });
}

/**
 * Render every frame on a page. Frames that would exceed the 32MP ceiling at 2x
 * are rendered at 1x instead of being allowed to fail.
 */
async function renderFrames(
  client: FigmaClient,
  fileKey: string,
  frames: ExtractedFrame[],
  nodes: Map<string, FigmaNode>,
  log: (message: string) => void,
): Promise<Map<string, string>> {
  const renderedUrls = new Map<string, string>();

  for (const [scale, nodeIds] of groupByScale(frames, nodes)) {
    for (const chunk of chunked(nodeIds, IMAGE_CHUNK_SIZE)) {
      const { images } = await client.getImages(fileKey, chunk, scale);
      for (const [nodeId, url] of Object.entries(images)) {
        // A null here is a per-node render failure. Keeping the existing row
        // is strictly better than blanking a screen that was fine yesterday.
        if (!url) {
          log(`        WARN render failed for ${nodeId}`);
          continue;
        }
        renderedUrls.set(nodeId, url);
      }
    }
  }

  return renderedUrls;
}

/** Where a newly documented page goes: after everything already in the stream. */
async function nextFlowPosition(streamId: string): Promise<number> {
  const [row] = await db
    .select({ highest: sql<number | null>`max(${flows.position})` })
    .from(flows)
    .where(eq(flows.streamId, streamId));

  return (row?.highest ?? -1) + 1;
}

/**
 * Companion to `formatSyncSummary`, in the same voice: what is true of the site
 * now, in the order the designer who pressed the button cares about it.
 */
export function formatPageSyncSummary(summary: PageSyncSummary): string {
  const parts: string[] = [];

  parts.push(
    summary.created
      ? `Published “${summary.flowName}” to ${summary.streamName} for the first ` +
        `time, with ${plural(summary.screensPublished, "screen")}.`
      : `Republished “${summary.flowName}” — ${plural(summary.screensPublished, "screen")}.`,
  );

  if (summary.screensPublished > 0) {
    const identical = Math.max(0, summary.screensPublished - summary.blobWrites);
    parts.push(
      summary.blobWrites === 0
        ? "Every image was already identical, so none were re-uploaded."
        : identical === 0
          ? `${plural(summary.blobWrites, "image")} uploaded.`
          : `${plural(summary.blobWrites, "image")} changed and ${summary.blobWrites === 1 ? "was" : "were"} re-uploaded; the other ${identical} were identical.`,
    );
  }

  if (summary.prototypes > 0) {
    parts.push(
      summary.prototypes === 1
        ? "Its prototype is playable on the site."
        : `${summary.prototypes} prototypes on this page are playable on the site.`,
    );
  }

  if (summary.screensArchived > 0) {
    parts.push(
      `${plural(summary.screensArchived, "screen")} no longer on this page, ` +
        `now hidden from the site.`,
    );
  }

  if (summary.driftFlagged > 0) {
    parts.push(
      `${plural(summary.driftFlagged, "screen")} no longer match the source ` +
        `design they were copied from — flagged for review.`,
    );
  }

  parts.push(
    "The other pages in this file were left alone; publish each one you " +
      "changed, or wait for the nightly sync.",
  );

  parts.push(`${plural(summary.requestCount, "Figma API request")} used.`);

  return parts.join(" ");
}

// --- Publishing one selected screen -----------------------------------------

export interface ScreenSyncOptions {
  fileKey: string;
  nodeId: string;
  /**
   * Figma page the frame sits on. The plugin sends it because
   * `/v1/files/:key/nodes` returns the requested subtree without its ancestors,
   * so the flow it belongs to is not recoverable here.
   */
  pageId?: string;
  onLog?: (message: string) => void;
}

export interface ScreenSyncSummary {
  screenName: string;
  flowName: string;
  /** The frame was not documented before this run. */
  created: boolean;
  imageChanged: boolean;
  hotspots: number;
  driftFlagged: number;
  requestCount: number;
}

/**
 * Publish a single frame, leaving the rest of its page untouched.
 *
 * Three Figma requests regardless of how large the page is — the node, its dev
 * resources, its render — against the three-plus and whole-page payload a page
 * publish costs. The saving that matters is not the request count but the
 * render loop: one image downloaded, hashed and uploaded instead of every
 * screen in the flow.
 *
 * What it deliberately does not do, because none of it can be decided from one
 * node in isolation:
 *
 * - **Archive anything.** A page publish archives screens Figma no longer
 *   lists; here the "live" set is one frame, so the same reconciliation would
 *   archive the entire flow.
 * - **Republish prototypes.** Starting points are a per-page fact, read off the
 *   CANVAS node.
 * - **Reorder.** See `position` below.
 */
export async function syncScreen(
  options: ScreenSyncOptions,
): Promise<ScreenSyncSummary> {
  const log = options.onLog ?? (() => {});
  const env = figmaEnv();
  const client = new FigmaClient({ onLog: log });

  const { nodes } = await client.getFileNodes(options.fileKey, [options.nodeId]);
  const node = nodes[options.nodeId]?.document;

  if (!node) {
    throw new PublishError("That frame is no longer in this file.", 404);
  }

  // The plugin already refuses to send anything but a top-level frame. Its
  // parentage cannot be re-checked here — `/nodes` returns no ancestors — but
  // the rules that *are* checkable are, so a stale or hand-made request cannot
  // publish something a page publish would then archive on its next run.
  if (node.type !== "FRAME") {
    throw new PublishError(
      `“${node.name}” is a ${node.type}, not a frame. Only top-level frames ` +
        "are documented screens.",
      400,
    );
  }
  if (isHidden(node)) {
    throw new PublishError(
      `“${node.name}” is hidden in Figma, so it is not published.`,
      400,
    );
  }
  if (env.ignorePattern.test(node.name.trim())) {
    throw new PublishError(
      `“${node.name}” matches the ignore prefix, so it stays unpublished.`,
      400,
    );
  }

  // The flow has to exist already. That precondition is what lets this path
  // skip the page fetch and the ordering — and it is honest: a page nobody has
  // published has no row to hang a screen off, and its prototypes and frame
  // order have never been read.
  const flow = await findPublishedFlow(options);
  const [stream] = await db
    .select()
    .from(streams)
    .where(eq(streams.id, flow.streamId));

  log(`  screen  ${options.nodeId} in "${flow.name}"`);

  const [prior] = await db
    .select()
    .from(screens)
    .where(and(eq(screens.flowId, flow.id), eq(screens.nodeId, options.nodeId)));

  // Ordering is a whole-page fact: `findPageFrames` numbers frames by walking
  // the canvas, and a node fetched on its own cannot know where it sits among
  // its siblings. An existing screen keeps the position it was given; a new one
  // goes last until the page is published properly.
  const position = prior?.position ?? (await nextScreenPosition(flow.id));
  const frame = extractFrame(node, position);

  const source = await readSourceLink(client, options, prior, log);

  const { images } = await client.getImages(
    options.fileKey,
    [options.nodeId],
    scaleFor(node),
  );
  const renderUrl = images[options.nodeId] ?? undefined;
  if (!renderUrl) log(`        WARN render failed for ${frame.name}`);

  const { screenId, blobWritten } = await publishFrame({
    flowId: flow.id,
    fileKey: options.fileKey,
    streamSlug: stream.slug,
    frame,
    node,
    prior,
    renderUrl,
    source,
    log,
  });

  // Costs one more request only when this screen was copied from somewhere, and
  // republishing is exactly when its badge stops being trustworthy.
  const driftFlagged = await checkDrift(client, log, { screenIds: [screenId] });

  return {
    screenName: frame.name,
    flowName: flow.name,
    created: prior == null,
    imageChanged: blobWritten,
    hotspots: frame.hotspots.length,
    driftFlagged,
    requestCount: client.requestCount,
  };
}

/**
 * The flow a single-screen publish belongs to.
 *
 * By page id when the plugin sent one, which is always; a screen already
 * documented can also find its own flow, which covers a request made before the
 * plugin knew to send the page.
 */
async function findPublishedFlow(options: ScreenSyncOptions) {
  const unpublished = new PublishError(
    "This page has not been published yet. Use “Publish this page” once, " +
      "then single screens can be published on their own.",
    404,
  );

  if (options.pageId) {
    const [flow] = await db
      .select()
      .from(flows)
      .innerJoin(streams, eq(streams.id, flows.streamId))
      .where(
        and(
          eq(streams.fileKey, options.fileKey),
          eq(flows.pageId, options.pageId),
          isNull(flows.archivedAt),
        ),
      );

    if (!flow) throw unpublished;
    return flow.flows;
  }

  const [existing] = await db
    .select()
    .from(flows)
    .innerJoin(screens, eq(screens.flowId, flows.id))
    .innerJoin(streams, eq(streams.id, flows.streamId))
    .where(
      and(
        eq(streams.fileKey, options.fileKey),
        eq(screens.nodeId, options.nodeId),
        isNull(flows.archivedAt),
      ),
    );

  if (!existing) throw unpublished;
  return existing.flows;
}

/**
 * Every Dev Resource on a file, indexed by the node it is attached to.
 *
 * Absent scope or absent links must not fail the publish: a token without
 * `file_dev_resources:read` still produces a perfectly good catalogue, minus
 * the drift badges.
 */
async function readSourceLinks(
  client: FigmaClient,
  fileKey: string,
  summary: SyncSummary,
  log: (message: string) => void,
): Promise<Map<string, SourceLink>> {
  const sourceByNodeId = new Map<string, SourceLink>();

  try {
    const { dev_resources } = await client.getDevResources(fileKey);
    for (const resource of dev_resources) {
      const parsed = parseFigmaUrl(resource.url);
      if (!parsed) continue;
      sourceByNodeId.set(resource.node_id, { url: resource.url, ...parsed });
    }
    log(`        ${sourceByNodeId.size} source link(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`        WARN could not read dev resources: ${message}`);
    summary.errors.push(`dev_resources — ${message}`);
  }

  return sourceByNodeId;
}

/**
 * The screen's Dev Resource link, falling back to what is already stored.
 *
 * A page publish nulls these fields when the dev-resources call fails, because
 * it cannot tell "no link" from "could not ask". Here there is a stored answer
 * to keep, and keeping yesterday's link beats erasing it over one failed
 * request. A call that succeeds and returns nothing still clears the link —
 * that is a designer removing it, not a failure.
 */
async function readSourceLink(
  client: FigmaClient,
  options: ScreenSyncOptions,
  prior: typeof screens.$inferSelect | undefined,
  log: (message: string) => void,
): Promise<SourceLink | undefined> {
  try {
    const { dev_resources } = await client.getDevResources(options.fileKey);
    const resource = dev_resources.find((r) => r.node_id === options.nodeId);
    if (!resource) return undefined;

    const parsed = parseFigmaUrl(resource.url);
    return parsed ? { url: resource.url, ...parsed } : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`        WARN could not read dev resources: ${message}`);

    return prior?.sourceFileKey && prior.sourceNodeId && prior.sourceUrl
      ? {
          url: prior.sourceUrl,
          fileKey: prior.sourceFileKey,
          nodeId: prior.sourceNodeId,
        }
      : undefined;
  }
}

/** Where a newly documented screen goes: after everything already in the flow. */
async function nextScreenPosition(flowId: string): Promise<number> {
  const [row] = await db
    .select({ highest: sql<number | null>`max(${screens.position})` })
    .from(screens)
    .where(eq(screens.flowId, flowId));

  return (row?.highest ?? -1) + 1;
}

/**
 * Companion to `formatSyncSummary`, in the same voice: what is true of the site
 * now, in the order the designer who pressed the button cares about it.
 */
export function formatScreenSyncSummary(summary: ScreenSyncSummary): string {
  const parts: string[] = [];

  parts.push(
    summary.created
      ? `Added “${summary.screenName}” to ${summary.flowName}. A newly ` +
        `documented screen sits last in the flow until the whole page is published.`
      : `Republished “${summary.screenName}”.`,
  );

  parts.push(
    summary.imageChanged
      ? "Its image changed and was re-uploaded."
      : "Its image was already identical, so nothing was re-uploaded.",
  );

  if (summary.hotspots > 0) {
    parts.push(`${plural(summary.hotspots, "tappable region")} mapped.`);
  }

  if (summary.driftFlagged > 0) {
    parts.push(
      "It no longer matches the source design it was copied from — flagged " +
        "for review.",
    );
  }

  parts.push(
    "The rest of the page was left alone; screens added, removed or reordered " +
      "elsewhere still need a page publish.",
  );

  parts.push(`${plural(summary.requestCount, "Figma API request")} used.`);

  return parts.join(" ");
}

/** A Figma URL attached to a documented frame as a Dev Resource. */
interface SourceLink {
  url: string;
  fileKey: string;
  nodeId: string;
}

interface PublishFrameInput {
  flowId: string;
  fileKey: string;
  /** Only cosmetic in the deep link Figma is handed. */
  streamSlug: string;
  frame: ExtractedFrame;
  /** The raw node, for its bounding box. Absent means no stored dimensions. */
  node: FigmaNode | undefined;
  prior: typeof screens.$inferSelect | undefined;
  /** Figma's temporary render URL. Absent when the render failed. */
  renderUrl: string | undefined;
  source: SourceLink | undefined;
  log: (message: string) => void;
}

/**
 * Write one screen: upload the render when its bytes changed, then replace the
 * row and both overlay sets in a single transaction.
 *
 * Shared by the two publish paths — a whole page, and one selected frame — so a
 * screen published on its own lands as exactly the row it would have got from a
 * page sync. Everything that differs between the two paths is decided by the
 * caller and arrives here already resolved.
 */
async function publishFrame(
  input: PublishFrameInput,
): Promise<{ screenId: string; blobWritten: boolean }> {
  const { frame, node, prior, source, log } = input;
  const box = node?.absoluteBoundingBox;
  const scale = scaleFor(node);

  let imageUrl = prior?.imageUrl ?? null;
  let imageHash = prior?.imageHash ?? null;
  let blobWritten = false;

  if (input.renderUrl) {
    const response = await fetch(input.renderUrl);
    if (!response.ok) {
      log(`        WARN download failed for ${frame.name}`);
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      const hash = sha256(bytes);

      if (hash === prior?.imageHash && prior.imageUrl) {
        // Byte-identical render. Skipping the write is what keeps storage
        // and operation costs flat across nightly runs.
        imageUrl = prior.imageUrl;
      } else {
        const pathname = `screens/${input.fileKey}/${frame.nodeId.replaceAll(":", "-")}-${hash.slice(0, 8)}.png`;
        const blob = await put(pathname, bytes, {
          access: "public",
          token: blobToken(),
          contentType: "image/png",
          addRandomSuffix: false,
          // The pathname is content-addressed, so an "overwrite" can only
          // ever write identical bytes. This makes a re-sync after a
          // database reset idempotent instead of erroring.
          allowOverwrite: true,
        });
        blobWritten = true;

        if (prior?.imageUrl && prior.imageUrl !== blob.url) {
          // Deletes are free and this pathname is unique to this screen.
          await del(prior.imageUrl, { token: blobToken() }).catch(() => {});
        }
        imageUrl = blob.url;
      }
      imageHash = hash;
    }
  }

  const values = {
    flowId: input.flowId,
    nodeId: frame.nodeId,
    name: frame.name,
    slug: slugify(frame.name),
    description: frame.description,
    imageUrl,
    imageWidth: box ? Math.round(box.width * scale) : null,
    imageHeight: box ? Math.round(box.height * scale) : null,
    imageHash,
    figmaUrl: figmaUrl(input.fileKey, input.streamSlug, frame.nodeId),
    sourceFileKey: source?.fileKey ?? null,
    sourceNodeId: source?.nodeId ?? null,
    sourceUrl: source?.url ?? null,
    textContent: frame.textContent,
    navigates: frame.navigates,
    position: frame.position,
    archivedAt: null,
    updatedAt: new Date(),
  };

  const screenId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(screens)
      .values(values)
      .onConflictDoUpdate({
        target: [screens.flowId, screens.nodeId],
        set: values,
      })
      .returning({ id: screens.id });

    // Both sets are replaced wholesale in the same transaction as the screen,
    // so no overlay box can ever describe a different render than the image
    // it is drawn over.
    await tx.delete(screenTexts).where(eq(screenTexts.screenId, row.id));
    if (frame.texts.length > 0) {
      await tx.insert(screenTexts).values(
        frame.texts.map((t) => ({
          screenId: row.id,
          nodeId: t.nodeId,
          content: t.content,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
        })),
      );
    }

    await tx.delete(screenHotspots).where(eq(screenHotspots.screenId, row.id));
    if (frame.hotspots.length > 0) {
      await tx.insert(screenHotspots).values(
        frame.hotspots.map((h) => ({
          screenId: row.id,
          nodeId: h.nodeId,
          name: h.name,
          x: h.x,
          y: h.y,
          w: h.w,
          h: h.h,
          trigger: h.trigger,
          destinationNodeId: h.destinationNodeId,
        })),
      );
    }

    return row.id;
  });

  return { screenId, blobWritten };
}

/** Frames too large to render at 2x fall back to 1x rather than failing. */
function scaleFor(node: FigmaNode | undefined): number {
  const box = node?.absoluteBoundingBox;
  if (!box) return 2;
  return box.width * box.height * 4 > MAX_MEGAPIXELS ? 1 : 2;
}

function groupByScale(
  frames: ExtractedFrame[],
  nodes: Map<string, FigmaNode>,
): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const frame of frames) {
    const scale = scaleFor(nodes.get(frame.nodeId));
    const list = groups.get(scale) ?? [];
    list.push(frame.nodeId);
    groups.set(scale, list);
  }
  return groups;
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/** Stream slugs are public anchors, so two files with the same name must not collide. */
async function uniqueStreamSlug(base: string, fileKey: string): Promise<string> {
  const clash = await db
    .select({ fileKey: streams.fileKey })
    .from(streams)
    .where(eq(streams.slug, base))
    .limit(1);
  if (clash.length === 0 || clash[0].fileKey === fileKey) return base;
  return `${base}-${fileKey.slice(0, 6).toLowerCase()}`;
}

/**
 * The same within one stream, where two pages can easily be named alike —
 * "Onboarding" under two products is normal, "Onboarding" twice in one file is
 * a designer's mistake we still must not crash on.
 *
 * The tie-break is the page's own id rather than anything random: the slug ends
 * up in a link people share, so publishing the same page twice has to produce
 * the same one both times.
 */
async function uniqueFlowSlug(
  streamId: string,
  base: string,
  page: { pageId: string; flowId: string | null },
): Promise<string> {
  const clash = await db
    .select({ id: flows.id })
    .from(flows)
    .where(and(eq(flows.streamId, streamId), eq(flows.slug, base)))
    .limit(1);

  if (clash.length === 0 || clash[0].id === page.flowId) return base;
  return `${base}-${page.pageId.replaceAll(":", "-")}`;
}
