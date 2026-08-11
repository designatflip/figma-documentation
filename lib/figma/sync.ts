import { del, put } from "@vercel/blob";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  flowPrototypes,
  flows,
  screenHotspots,
  screens,
  screenTexts,
} from "@/db/schema";
import { blobToken, figmaEnv } from "@/lib/env";
import { FigmaClient } from "./client";
import { checkDrift } from "./drift";
import {
  type ExtractedFrame,
  extractFrame,
  figmaUrl,
  findPrototypeFlows,
  findScreenFrames,
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

export interface SyncOptions {
  /** Re-sync files whose `last_modified` is unchanged. */
  force?: boolean;
  /** Resolve and report everything, write nothing. */
  dryRun?: boolean;
  allowMassArchive?: boolean;
  /** Limit the run to one flow file. */
  onlyFileKey?: string;
  /** Skip the drift pass (it is the slowest stage). */
  skipDrift?: boolean;
  onLog?: (message: string) => void;
}

export interface SyncSummary {
  flowsChecked: number;
  flowsSkipped: number;
  flowsSynced: number;
  screensRendered: number;
  blobWrites: number;
  prototypesPublished: number;
  screensArchived: number;
  driftFlagged: number;
  requestCount: number;
  errors: string[];
  /** Populated on dry runs for the CLI to print. */
  preview: FlowPreview[];
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

  if (summary.flowsSynced === 0) {
    parts.push(nothingPublished(summary));
  } else {
    parts.push(published(summary));
    // Nothing was rendered, so there is no image story to tell — `published`
    // has already explained why.
    if (summary.screensRendered > 0) parts.push(images(summary));
    // Only worth a sentence when there is one. Most files are never
    // prototyped, and "0 prototypes" would read as something having failed.
    if (summary.prototypesPublished > 0) parts.push(prototypes(summary));
  }

  if (summary.screensArchived > 0) {
    parts.push(
      `${plural(summary.screensArchived, "screen")} no longer in Figma, ` +
        `now hidden from the site.`,
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
  if (summary.flowsChecked === 0) {
    return "Nothing to publish — no Figma files matched.";
  }
  return summary.flowsChecked === 1
    ? "Nothing to publish — this file has not changed in Figma since it was last published."
    : `Nothing to publish — none of the ${summary.flowsChecked} files have changed in Figma since they were last published.`;
}

function published(summary: SyncSummary): string {
  const scope =
    summary.flowsSynced === 1 ? "" : ` from ${summary.flowsSynced} files`;

  if (summary.screensRendered === 0) {
    return (
      `Published${scope}, but found no frames to document. ` +
      `Frames are skipped when their name matches the ignore prefix.`
    );
  }

  const also =
    summary.flowsSkipped > 0
      ? ` ${plural(summary.flowsSkipped, "other file")} had not changed and ` +
        `${summary.flowsSkipped === 1 ? "was" : "were"} left alone.`
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
  fileKey: string;
  name: string;
  changed: boolean;
  /** Prototype starting points, by the screen each one opens on. */
  prototypes: { name: string; startsOn: string }[];
  frames: {
    nodeId: string;
    name: string;
    section: string;
    description: string | null;
    textSample: string[];
    /** Names of the layers found wired up, so the overlay is checkable dry. */
    hotspots: string[];
    sourceUrl: string | null;
  }[];
}

export async function syncProject(
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const log = options.onLog ?? (() => {});
  const env = figmaEnv();
  const client = new FigmaClient({ onLog: log });

  const summary: SyncSummary = {
    flowsChecked: 0,
    flowsSkipped: 0,
    flowsSynced: 0,
    screensRendered: 0,
    blobWrites: 0,
    prototypesPublished: 0,
    screensArchived: 0,
    driftFlagged: 0,
    requestCount: 0,
    errors: [],
    preview: [],
  };

  // 1. Discover + change gate. One request returns every file in the project
  //    along with its last_modified, so unchanged flows cost nothing further.
  const project = await client.getProjectFiles(env.projectId);
  log(`Project "${project.name}": ${project.files.length} file(s)`);

  let candidates = project.files.filter(
    (f) => !env.ignorePattern.test(f.name.trim()),
  );
  if (options.onlyFileKey) {
    candidates = candidates.filter((f) => f.key === options.onlyFileKey);
  }

  const existingFlows = await db.select().from(flows);
  const flowByKey = new Map(existingFlows.map((f) => [f.fileKey, f]));

  for (const file of candidates) {
    summary.flowsChecked++;
    const existing = flowByKey.get(file.key);
    const remoteModified = new Date(file.last_modified);
    const unchanged =
      existing?.lastModified != null &&
      existing.lastModified.getTime() === remoteModified.getTime() &&
      existing.archivedAt == null;

    if (unchanged && !options.force) {
      summary.flowsSkipped++;
      log(`  skip  ${file.name} (unchanged)`);
      continue;
    }

    try {
      await syncFlowFile(client, file, remoteModified, options, summary, log);
      summary.flowsSynced++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${file.name}: ${message}`);
      log(`  ERROR ${file.name}: ${message}`);
      if (!options.dryRun) {
        await db
          .update(flows)
          .set({
            syncStatus: "error",
            syncError: message,
            // The flow row is upserted with the new `last_modified` *before*
            // rendering, so a failure after that point would leave the change
            // gate believing this file is done — and the retry would skip it
            // until Figma next touched the file. Clearing the gate makes a
            // failed sync retry, which is what anyone pressing Publish again
            // in the plugin already assumes happens.
            lastModified: null,
          })
          .where(eq(flows.fileKey, file.key));
      }
    }
  }

  // Flow files that left the project entirely.
  if (!options.dryRun) {
    const liveKeys = candidates.map((f) => f.key);
    const archivedFlows = await db
      .update(flows)
      .set({ archivedAt: new Date() })
      .where(
        and(
          isNull(flows.archivedAt),
          liveKeys.length > 0
            ? notInArray(flows.fileKey, liveKeys)
            : sql`true`,
        ),
      )
      .returning({ id: flows.id, name: flows.name });

    for (const flow of archivedFlows) {
      log(`  archived flow "${flow.name}" (no longer in project)`);
      const result = await db
        .update(screens)
        .set({ archivedAt: new Date() })
        .where(and(eq(screens.flowId, flow.id), isNull(screens.archivedAt)))
        .returning({ id: screens.id });
      summary.screensArchived += result.length;
    }
  }

  if (!options.skipDrift && !options.dryRun) {
    summary.driftFlagged = await checkDrift(client, log);
  }

  summary.requestCount = client.requestCount;
  return summary;
}

async function syncFlowFile(
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
  const found = findScreenFrames(fileData.document, env.ignorePattern);

  if (found.length === 0) {
    log(`        no frames found — check DOCS_IGNORE_PATTERN`);
  }

  const extracted = found.map(({ page, frame, position }) =>
    extractFrame(page.name, frame, position),
  );
  const frameByNodeId = new Map(found.map(({ frame }) => [frame.id, frame]));

  // Free — the starting points ride along in the tree already fetched above.
  const prototypeFlows = findPrototypeFlows(fileData.document, env.ignorePattern);
  if (prototypeFlows.length > 0) {
    log(`        ${prototypeFlows.length} prototype starting point(s)`);
  }

  // 3. Source links. Absent scope or absent links must not fail the file.
  const sourceByNodeId = new Map<
    string,
    { url: string; fileKey: string; nodeId: string }
  >();
  try {
    const { dev_resources } = await client.getDevResources(file.key);
    for (const resource of dev_resources) {
      const parsed = parseFigmaUrl(resource.url);
      if (!parsed) continue;
      sourceByNodeId.set(resource.node_id, { url: resource.url, ...parsed });
    }
    log(`        ${sourceByNodeId.size} source link(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`        WARN could not read dev resources: ${message}`);
    summary.errors.push(`${file.name}: dev_resources — ${message}`);
  }

  const flowSlug = slugify(file.name);

  if (options.dryRun) {
    summary.preview.push({
      fileKey: file.key,
      name: file.name,
      changed: true,
      prototypes: prototypeFlows.map((p) => ({
        name: p.name,
        startsOn: frameByNodeId.get(p.screenNodeId)?.name.trim() ?? p.screenNodeId,
      })),
      frames: extracted.map((f) => ({
        nodeId: f.nodeId,
        name: f.name,
        section: f.section,
        description: f.description,
        textSample: f.texts.slice(0, 8).map((t) => t.content),
        hotspots: f.hotspots.map((h) => h.name),
        sourceUrl: sourceByNodeId.get(f.nodeId)?.url ?? null,
      })),
    });
    summary.screensRendered += extracted.length;
    return;
  }

  const [flow] = await db
    .insert(flows)
    .values({
      fileKey: file.key,
      name: file.name,
      slug: await uniqueFlowSlug(flowSlug, file.key),
      thumbnailUrl: file.thumbnail_url ?? null,
      lastModified: remoteModified,
      lastSyncedAt: new Date(),
      syncStatus: "ok",
      syncError: null,
      archivedAt: null,
    })
    .onConflictDoUpdate({
      target: flows.fileKey,
      set: {
        name: file.name,
        thumbnailUrl: file.thumbnail_url ?? null,
        lastModified: remoteModified,
        lastSyncedAt: new Date(),
        syncStatus: "ok",
        syncError: null,
        // Republishing must be as cheap as publishing.
        archivedAt: null,
      },
    })
    .returning();

  // Replaced wholesale rather than upserted: a starting point that was moved
  // or unpinned in Figma has to disappear here, and there are only ever a
  // handful of rows per flow.
  await db.transaction(async (tx) => {
    await tx.delete(flowPrototypes).where(eq(flowPrototypes.flowId, flow.id));
    if (prototypeFlows.length > 0) {
      await tx.insert(flowPrototypes).values(
        prototypeFlows.map((p) => ({
          flowId: flow.id,
          nodeId: p.nodeId,
          screenNodeId: p.screenNodeId,
          name: p.name,
          section: p.section,
          position: p.position,
        })),
      );
    }
  });
  summary.prototypesPublished += prototypeFlows.length;

  // 4/5. Render. Frames that would exceed the 32MP ceiling at 2x are rendered
  // at 1x instead of being allowed to fail.
  const scaleGroups = groupByScale(extracted, frameByNodeId);
  const renderedUrls = new Map<string, string>();

  for (const [scale, nodeIds] of scaleGroups) {
    for (const chunk of chunked(nodeIds, IMAGE_CHUNK_SIZE)) {
      const { images } = await client.getImages(file.key, chunk, scale);
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

  const existingScreens = await db
    .select()
    .from(screens)
    .where(eq(screens.flowId, flow.id));
  const screenByNodeId = new Map(existingScreens.map((s) => [s.nodeId, s]));

  for (const frame of extracted) {
    const { blobWritten } = await publishFrame({
      flowId: flow.id,
      fileKey: file.key,
      flowSlug,
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

  // 9. Reconcile within this flow.
  const liveNodeIds = extracted.map((f) => f.nodeId);
  const toArchive = existingScreens.filter(
    (s) => s.archivedAt == null && !liveNodeIds.includes(s.nodeId),
  );
  const liveBefore = existingScreens.filter((s) => s.archivedAt == null).length;

  if (
    toArchive.length > 0 &&
    liveBefore > 0 &&
    toArchive.length / liveBefore > MASS_ARCHIVE_RATIO &&
    !options.allowMassArchive
  ) {
    throw new Error(
      `Refusing to archive ${toArchive.length} of ${liveBefore} live screens in "${file.name}". ` +
        `That usually means a moved file or a partial API response, not a bulk unpublish. ` +
        `Re-run with --allow-mass-archive if this is intended.`,
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
}

// --- Publishing one selected screen ----------------------------------------

export interface ScreenSyncOptions {
  fileKey: string;
  nodeId: string;
  /**
   * Figma page the frame sits on, which becomes `screens.section`. The plugin
   * sends it because `/v1/files/:key/nodes` returns the requested subtree
   * without its ancestors, so it cannot be recovered here.
   */
  section?: string;
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
 * A refusal the designer can act on, as opposed to a sync that broke.
 *
 * Carries the status the route should answer with, so the wording lives next to
 * the check that produced it rather than being re-derived from a string.
 */
export class ScreenPublishError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ScreenPublishError";
  }
}

/**
 * Publish a single frame, leaving the rest of its file untouched.
 *
 * Three Figma requests regardless of how large the file is — the node, its dev
 * resources, its render — against the four-plus and full-document payload a
 * file publish costs. The saving that matters is not the request count but the
 * render loop: one image downloaded, hashed and uploaded instead of every
 * screen in the flow.
 *
 * What it deliberately does not do, because none of it can be decided from one
 * node in isolation:
 *
 * - **Archive anything.** A file publish archives screens Figma no longer
 *   lists; here the "live" set is one frame, so the same reconciliation would
 *   archive the entire flow.
 * - **Touch `flows.lastModified`.** That column is the change gate in
 *   `syncProject`. Stamping it would make the next full publish skip the file
 *   and silently strand every other frame edited in the same session.
 * - **Republish prototypes.** Starting points are a per-page fact, read off the
 *   CANVAS nodes of the whole document.
 * - **Reorder.** See `position` below.
 */
export async function syncScreen(
  options: ScreenSyncOptions,
): Promise<ScreenSyncSummary> {
  const log = options.onLog ?? (() => {});
  const env = figmaEnv();
  const client = new FigmaClient({ onLog: log });

  // The flow has to exist already. That precondition is what lets this path
  // skip the project listing and the slug allocation — and it is honest: a file
  // nobody has published has no row to hang a screen off, and its ordering and
  // prototypes have never been read.
  const [flow] = await db
    .select()
    .from(flows)
    .where(eq(flows.fileKey, options.fileKey));

  if (!flow || flow.archivedAt != null) {
    throw new ScreenPublishError(
      "This file has not been published yet. Use “Publish this file” once, " +
        "then single screens can be published on their own.",
      404,
    );
  }

  log(`  screen  ${options.nodeId} in "${flow.name}"`);

  const { nodes } = await client.getFileNodes(options.fileKey, [options.nodeId]);
  const node = nodes[options.nodeId]?.document;

  if (!node) {
    throw new ScreenPublishError(
      "That frame is no longer in this file.",
      404,
    );
  }

  // The plugin already refuses to send anything but a top-level frame. Its
  // parentage cannot be re-checked here — `/nodes` returns no ancestors — but
  // the rules that *are* checkable are, so a stale or hand-made request cannot
  // publish something a full sync would then archive on its next run.
  if (node.type !== "FRAME") {
    throw new ScreenPublishError(
      `“${node.name}” is a ${node.type}, not a frame. Only top-level frames ` +
        "are documented screens.",
      400,
    );
  }
  if (isHidden(node)) {
    throw new ScreenPublishError(
      `“${node.name}” is hidden in Figma, so it is not published.`,
      400,
    );
  }
  if (env.ignorePattern.test(node.name.trim())) {
    throw new ScreenPublishError(
      `“${node.name}” matches the ignore prefix, so it stays unpublished.`,
      400,
    );
  }

  const [prior] = await db
    .select()
    .from(screens)
    .where(
      and(eq(screens.flowId, flow.id), eq(screens.nodeId, options.nodeId)),
    );

  // Ordering is a whole-document fact: `findScreenFrames` numbers frames by
  // walking every page in turn, and a node fetched on its own cannot know where
  // it sits among its siblings. An existing screen keeps the position it was
  // given; a new one goes last until a full publish files it properly.
  const position = prior?.position ?? (await nextScreenPosition(flow.id));
  const section = options.section?.trim() || prior?.section || "";
  const frame = extractFrame(section, node, position);

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
    flowSlug: flow.slug,
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
 * The screen's Dev Resource link, falling back to what is already stored.
 *
 * A file publish nulls these fields when the dev-resources call fails, because
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
        `documented screen sits last in the flow until the whole file is published.`
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
    "The rest of the file was left alone; screens added, removed or reordered " +
      "elsewhere still need a full publish.",
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
  flowSlug: string;
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
 * Shared by the two publish paths — a whole file, and one selected frame — so a
 * screen published on its own lands as exactly the row it would have got from a
 * full sync. Everything that differs between the two paths is decided by the
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
    section: frame.section,
    description: frame.description,
    imageUrl,
    imageWidth: box ? Math.round(box.width * scale) : null,
    imageHeight: box ? Math.round(box.height * scale) : null,
    imageHash,
    figmaUrl: figmaUrl(input.fileKey, input.flowSlug, frame.nodeId),
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

/** Flow slugs are public URLs, so two files with the same name must not collide. */
async function uniqueFlowSlug(base: string, fileKey: string): Promise<string> {
  const clash = await db
    .select({ fileKey: flows.fileKey })
    .from(flows)
    .where(eq(flows.slug, base))
    .limit(1);
  if (clash.length === 0 || clash[0].fileKey === fileKey) return base;
  return `${base}-${fileKey.slice(0, 6).toLowerCase()}`;
}
